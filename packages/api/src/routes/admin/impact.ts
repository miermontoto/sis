// impacto de un conjunto de merges propuestos sobre el ranking all-time del usuario.
//
// Se calcula sobre la lista completa de entidades con reproducciones (ya resuelta por los
// merges existentes), se suman en memoria los pares propuestos y se vuelve a ordenar. Lo
// que se reporta son los TARGETS: al desaparecer un duplicado, todo lo que queda por debajo
// sube un puesto, así que contar "posiciones que cambian" daría un número enorme y sin
// información. El movimiento con significado es el de la entidad que acumula las escuchas.
import { dbRead } from '../../db/read-pool.js';
import { getRangeStart } from '../../db/queries/index.js';
import { IMPACT_TOP_THRESHOLD, IMPACT_BIGGEST_MOVERS } from '../../constants.js';
import type { EntityType, RankingMetric, MergeImpact, MergeImpactItem } from '@sis/shared';

// tope defensivo: el ranking completo de tracks del usuario más pesado ronda las decenas
// de miles de filas, muy por debajo de esto
const RANKING_LIMIT = 200_000;

// El ranking base cuesta 0,6-1,3 s (y mucho más en frío) y el preview se recalcula en cada
// clic del usuario sobre la MISMA base. Dos medidas:
//   1. va por dbRead, o sea por el pool de workers: en prod no bloquea el event loop, que
//      es lo que hacía que toda la UI se quedara esperando mientras se recalculaba.
//   2. se memoiza por (usuario, tipo, métrica). Sólo cambia al tocar historial o reglas, y
//      los endpoints de merge llaman a invalidateRankingCache.
// Se guarda la PROMESA, no las filas: si llegan varios clics seguidos en frío, todos
// esperan al mismo cálculo en vez de lanzar uno cada uno.
const RANKING_CACHE_TTL_MS = 5 * 60_000;

type AggregateRow = { entity_id: string; play_count: number; total_ms: number };
interface CachedRanking { rows: Promise<AggregateRow[]>; at: number }

const rankingCache = new Map<string, CachedRanking>();

export function invalidateRankingCache(userId?: number): void {
  if (userId === undefined) return rankingCache.clear();
  for (const key of rankingCache.keys()) {
    if (key.startsWith(`${userId}:`)) rankingCache.delete(key);
  }
}

function baseRanking(userId: number, entityType: EntityType, sort: 'time' | 'plays'): Promise<AggregateRow[]> {
  const key = `${userId}:${entityType}:${sort}`;
  const hit = rankingCache.get(key);
  if (hit && Date.now() - hit.at < RANKING_CACHE_TTL_MS) return hit.rows;

  const rows = dbRead('getTopEntities', entityType, getRangeStart('all'), sort, RANKING_LIMIT, null, userId)
    .catch(err => { rankingCache.delete(key); throw err; }); // un fallo no se cachea

  rankingCache.set(key, { rows, at: Date.now() });
  // podar lo caducado: el mapa es pequeño (tipos × métricas × usuarios) pero no debe crecer
  for (const [k, v] of rankingCache) {
    if (Date.now() - v.at >= RANKING_CACHE_TTL_MS) rankingCache.delete(k);
  }
  return rows;
}

export async function computeMergeImpact(
  userId: number,
  entityType: EntityType,
  pairs: { sourceId: string; targetId: string }[],
  metric: RankingMetric,
): Promise<MergeImpact> {
  const sort = metric === 'plays' ? 'plays' : 'time';
  // NO mutar: `rows` es el array memoizado y se comparte entre llamadas
  const rows = await baseRanking(userId, entityType, sort);

  const valueOf = (r: { play_count: number; total_ms: number }) => metric === 'plays' ? r.play_count : r.total_ms;

  const rankBefore = new Map<string, number>();
  rows.forEach((r, i) => rankBefore.set(r.entity_id, i + 1));

  // resolver cadenas por si llegan pares encadenados (A→B, B→C ⇒ A→C)
  const finalTarget = (id: string, seen = new Set<string>()): string => {
    const next = pairs.find(p => p.sourceId === id)?.targetId;
    if (!next || seen.has(next)) return id;
    seen.add(next);
    return finalTarget(next, seen);
  };

  const totals = new Map(rows.map(r => [r.entity_id, { play_count: r.play_count, total_ms: r.total_ms }]));
  const removed = new Set<string>();
  const touched = new Set<string>();

  for (const p of pairs) {
    const target = finalTarget(p.targetId);
    const src = totals.get(p.sourceId);
    if (target === p.sourceId) continue; // ciclo: no se puede fusionar consigo mismo
    touched.add(target);
    removed.add(p.sourceId);
    if (!src) continue; // source sin reproducciones: no mueve el ranking
    const tgt = totals.get(target) ?? { play_count: 0, total_ms: 0 };
    totals.set(target, {
      play_count: tgt.play_count + src.play_count,
      total_ms: tgt.total_ms + src.total_ms,
    });
  }

  const after = [...totals.entries()]
    .filter(([id]) => !removed.has(id))
    .map(([id, v]) => ({ id, value: valueOf(v) }))
    .sort((a, b) => b.value - a.value);

  const rankAfter = new Map<string, number>();
  after.forEach((r, i) => rankAfter.set(r.id, i + 1));

  // un id que sea target de un par y source de otro desaparece del ranking: no se reporta
  // como movimiento (los pares del scan vienen normalizados, pero la API es pública)
  const items: MergeImpactItem[] = [...touched].filter(id => !removed.has(id)).map(id => {
    const before = rankBefore.get(id) ?? null;
    const t = totals.get(id) ?? { play_count: 0, total_ms: 0 };
    const originalRow = rows[(before ?? 0) - 1];
    return {
      id,
      rankBefore: before,
      rankAfter: rankAfter.get(id) ?? null,
      valueBefore: originalRow ? valueOf(originalRow) : 0,
      valueAfter: valueOf(t),
    };
  });

  const improved = items.filter(i => i.rankAfter !== null && (i.rankBefore === null || i.rankAfter < i.rankBefore));
  const enteredTop = improved.filter(i =>
    i.rankAfter! <= IMPACT_TOP_THRESHOLD && (i.rankBefore === null || i.rankBefore > IMPACT_TOP_THRESHOLD)
  ).length;

  const biggest = [...improved]
    .sort((a, b) => ((b.rankBefore ?? Infinity) - b.rankAfter!) - ((a.rankBefore ?? Infinity) - a.rankAfter!))
    .slice(0, IMPACT_BIGGEST_MOVERS);

  return {
    entityType,
    metric,
    topThreshold: IMPACT_TOP_THRESHOLD,
    items,
    movedCount: improved.length,
    enteredTop,
    biggest,
  };
}
