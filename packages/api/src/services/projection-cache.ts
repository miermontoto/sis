// Proyecciones de ranking de la sesión (session card), sin escanear el historial entero
// en cada cambio de tema. Antes GET /stats/projected-rankings corría tres GROUP BY sobre
// todo el historial (~3.1s) en el main thread en cada cambio de tema de cada cliente
// abierto: 211 congelaciones del servidor entero en 5.7 días en prod.
//
// Los scores pre-sesión sólo dependen de los plays anteriores al inicio de la sesión,
// así que se escanean una vez por sesión (la base, cacheada aquí) y en cada llamada sólo
// se suman los plays de la sesión (el delta, milisegundos por idx (user_id, played_at)).
// Base y delta salen del mismo builder SQL (scanPrePostScores), así que el filtro de
// merge_rules por usuario, la sustitución por colecciones y los créditos corregidos son
// los mismos que en el escaneo completo.
import type { CrossoverEntity, ProjectedRankingsResponse, ProjectionResult, RankingMetric } from '@sis/shared';
import { dbRead } from '../db/read-pool.js';
import { projectRankings, type ProjectionScoreRow, type ScoreRow } from '../db/queries/rankings.js';
import type { ProjectionEntityType, ProjectionSession } from '../db/queries/projections.js';
import { getRangeStart } from '../db/queries/helpers.js';
import { readRankLimits } from './recent-changes-cache.js';
import { PROJECTION_BASE_TTL_MS } from '../constants.js';

interface CachedBase { fingerprint: string; at: number; rows: Promise<ProjectionScoreRow[]> }

// por `${userId}:${tipo}:${métrica}`: sólo la base de la sesión vigente
const bases = new Map<string, CachedBase>();
// sube con cada mutación que cambia a qué entidad cuenta un play (merges, colecciones,
// créditos): la base agrupada con las reglas viejas deja de valer aunque nada más cambie
const resolutionGen = new Map<number, number>();
// una computación por usuario y métrica: cada cliente abierto (escritorio y móvil) pide
// la suya en el mismo cambio de tema
const inFlight = new Map<string, Promise<ProjectedRankingsResponse>>();

const ENTITY_ORDER: Record<string, number> = { artist: 0, album: 1, track: 2 };

/** Tira la base de un usuario. La llaman las mutaciones que cambian la resolución de
 *  plays a entidades: merges, colecciones y créditos corregidos. */
export function invalidateProjectionBase(userId: number) {
  resolutionGen.set(userId, (resolutionGen.get(userId) ?? 0) + 1);
  for (const key of bases.keys()) {
    if (key.startsWith(`${userId}:`)) bases.delete(key);
  }
}

function getBase(userId: number, type: ProjectionEntityType, sort: RankingMetric, session: ProjectionSession & { sessionStart: string }): Promise<ProjectionScoreRow[]> {
  const key = `${userId}:${type}:${sort}`;
  // la base vale mientras no cambien la sesión, el número de plays previos (scrobble
  // atrasado, import, dedup que borra), el año en curso ni la resolución de entidades
  const fingerprint = [session.sessionStart, session.preCount, getRangeStart('thisYear'), resolutionGen.get(userId) ?? 0].join('|');
  const hit = bases.get(key);
  if (hit && hit.fingerprint === fingerprint && Date.now() - hit.at < PROJECTION_BASE_TTL_MS) return hit.rows;

  const rows: Promise<ProjectionScoreRow[]> = dbRead('scanProjectionBase', type, sort, userId, session.sessionStart)
    .catch(err => {
      // un fallo no se cachea
      if (bases.get(key)?.rows === rows) bases.delete(key);
      throw err;
    });
  bases.set(key, { fingerprint, at: Date.now(), rows });
  return rows;
}

// base + delta → la forma que espera projectRankings (pre_* = antes de la sesión,
// val_* = con ella). Las entidades nuevas en la sesión van al final: sin score previo
// nunca son "desplazadas", así que no alteran el orden de los empates de crossover
function mergeScores(base: ProjectionScoreRow[], delta: ProjectionScoreRow[]): ScoreRow[] {
  const pending = new Map(delta.map(d => [d.eid, d]));
  const merged = base.map(b => {
    const d = pending.get(b.eid);
    if (d) pending.delete(b.eid);
    return { eid: b.eid, pre_all: b.all, pre_year: b.year, val_all: b.all + (d?.all ?? 0), val_year: b.year + (d?.year ?? 0) };
  });
  for (const d of pending.values()) merged.push({ eid: d.eid, pre_all: 0, pre_year: 0, val_all: d.all, val_year: d.year });
  return merged;
}

export function getProjectedRankings(userId: number, spotifyId: string, sort: RankingMetric): Promise<ProjectedRankingsResponse> {
  const key = `${userId}:${sort}`;
  const running = inFlight.get(key);
  if (running) return running;
  const p = computeProjections(userId, spotifyId, sort).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

const PROJECTION_TYPES: ProjectionEntityType[] = ['track', 'album', 'artist'];

async function computeProjections(userId: number, spotifyId: string, sort: RankingMetric): Promise<ProjectedRankingsResponse> {
  const rankLimits = readRankLimits(spotifyId);
  const session = await dbRead('getProjectionSession', userId);
  const response: ProjectedRankingsResponse = {
    nowPlaying: [],
    session: [],
    sessionTrackCount: session.sessionTrackCount,
    sessionTotalMs: session.sessionTotalMs,
    sessionStartedAt: session.sessionStart,
  };
  const { sessionStart } = session;
  if (!sessionStart || session.sessionTrackCount === 0) return response;
  const live = { ...session, sessionStart };

  // de una en una: en frío son escaneos completos (~0.8-1.7s cada uno) y en paralelo
  // ocuparían tres de los cuatro workers en cada inicio de sesión
  const baseByType = new Map<ProjectionEntityType, ProjectionScoreRow[]>();
  for (const type of PROJECTION_TYPES) baseByType.set(type, await getBase(userId, type, sort, live));
  const deltas = await Promise.all(PROJECTION_TYPES.map(type => dbRead('scanProjectionDelta', type, sort, userId, sessionStart)));

  // las entidades de la sesión son las filas del delta: ids ya resueltos (canónico del
  // merge, `collection:N`, créditos del usuario), los mismos con los que agrupan los
  // scores. Pre-sesión como "current", post-sesión como "projected"
  const ranked = PROJECTION_TYPES.map((type, i) => {
    const targets = deltas[i].map(d => ({ entityId: d.eid, extraPlays: 0, extraMs: 0 }));
    const ranks = projectRankings(mergeScores(baseByType.get(type)!, deltas[i]), targets, sort, rankLimits);
    const changed = targets.flatMap(({ entityId }) => {
      const changes = Object.entries(ranks.get(entityId) ?? {})
        .filter(([, v]) => v.current !== null && v.projected !== null && v.current !== v.projected);
      return changes.length > 0 ? [{ entityId, changes }] : [];
    });
    return { type, changed };
  });

  // nombre e imagen de lo que se pinta (las entidades que cambian y sus desplazadas),
  // un lote por tipo
  const metaByType = new Map(await Promise.all(ranked.map(async ({ type, changed }) => {
    const ids = new Set<string>();
    for (const { entityId, changes } of changed) {
      ids.add(entityId);
      for (const [, v] of changes) v.displaced.forEach(id => ids.add(id));
    }
    const metaMap = ids.size > 0 ? await dbRead('fetchEntityMetadata', type, [...ids], userId) : new Map();
    return [type, metaMap] as const;
  })));

  const results = ranked.flatMap(({ type, changed }) => {
    const metaMap = metaByType.get(type);
    return changed.map(({ entityId, changes }): ProjectionResult => {
      const meta = metaMap?.get(entityId);
      return {
        entityId,
        entityType: type,
        entityName: meta?.name ?? '',
        imageUrl: meta?.imageUrl ?? null,
        changes: changes.map(([range, v]) => ({
          range,
          currentRank: v.current!,
          projectedRank: v.projected!,
          delta: v.current! - v.projected!,
          displaced: v.displaced.map(id => {
            const d = metaMap?.get(id);
            return { id, name: d?.name ?? '', imageUrl: d?.imageUrl ?? null, artistName: d?.artistName ?? null } satisfies CrossoverEntity;
          }),
        })),
      };
    });
  });

  results.sort((a, b) => {
    const typeA = ENTITY_ORDER[a.entityType] ?? 3;
    const typeB = ENTITY_ORDER[b.entityType] ?? 3;
    if (typeA !== typeB) return typeA - typeB;
    const bestRankA = Math.min(...a.changes.map(ch => ch.projectedRank));
    const bestRankB = Math.min(...b.changes.map(ch => ch.projectedRank));
    return bestRankA - bestRankB;
  });

  return { ...response, session: results };
}
