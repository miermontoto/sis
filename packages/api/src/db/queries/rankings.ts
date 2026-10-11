import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort } from './helpers.js';
import type { RankingHistoryPoint, RankingHistoryPointWithCrossovers, RankingsWithHistory, RecentRankChange, RecentRankChangeItem } from '@sis/shared';
import { getRangeStart, entityGroupCol, userFilter, resolvedPlayJoins, albumNullFilter, playDuration, artistPerTrackScores } from './helpers.js';
import { fetchEntityMetadata } from './charts.js';

/** Rankings: posición de una entidad en 4 rangos fijos (week, month, thisYear, all).
 *  Optimizado: 1 scan con CASE para los 4 rangos + COUNT del target en la misma query. */
export function computeRankings(db: Db, entityType: EntityType, entityId: string, sort: Sort, userId: number): Record<string, number | null> {
  const uf = userFilter(userId);
  const weekStart = getRangeStart('week')!;
  const monthStart = getRangeStart('month')!;
  const yearStart = getRangeStart('thisYear')!;

  // artistas: un play cuenta una vez por artista aunque dos créditos de su track resuelvan
  // al mismo target (dedup por track, ver artistPerTrackScores)
  if (entityType === 'artist') {
    const valExpr = sort === 'plays' ? sql`1` : playDuration();

    const result = db.all(sql`
      WITH entity_scores AS (${artistPerTrackScores(userId, {
        val_all: valExpr,
        val_week: sql`CASE WHEN lh.played_at >= ${weekStart} THEN ${valExpr} ELSE 0 END`,
        val_month: sql`CASE WHEN lh.played_at >= ${monthStart} THEN ${valExpr} ELSE 0 END`,
        val_year: sql`CASE WHEN lh.played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END`,
      })}),
      target AS (
        SELECT val_all, val_week, val_month, val_year FROM entity_scores WHERE eid = ${entityId}
      )
      SELECT
        (SELECT val_week FROM target) as my_week,
        (SELECT val_month FROM target) as my_month,
        (SELECT val_year FROM target) as my_year,
        (SELECT val_all FROM target) as my_all,
        sum(CASE WHEN val_week > (SELECT val_week FROM target) THEN 1 ELSE 0 END) as rank_week,
        sum(CASE WHEN val_month > (SELECT val_month FROM target) THEN 1 ELSE 0 END) as rank_month,
        sum(CASE WHEN val_year > (SELECT val_year FROM target) THEN 1 ELSE 0 END) as rank_year,
        sum(CASE WHEN val_all > (SELECT val_all FROM target) THEN 1 ELSE 0 END) as rank_all
      FROM entity_scores
    `)[0] as { my_week: number; my_month: number; my_year: number; my_all: number; rank_week: number; rank_month: number; rank_year: number; rank_all: number } | undefined;

    if (!result || !result.my_all) return { week: null, month: null, thisYear: null, all: null };

    return {
      week: result.my_week > 0 ? result.rank_week + 1 : null,
      month: result.my_month > 0 ? result.rank_month + 1 : null,
      thisYear: result.my_year > 0 ? result.rank_year + 1 : null,
      all: result.rank_all + 1,
    };
  }

  // album ó track: resolvedPlayJoins maneja toda la cadena de merges
  const groupCol = entityGroupCol(entityType);
  const valExpr = sort === 'plays' ? sql`1` : playDuration();

  const result = db.all(sql`
    WITH entity_scores AS (
      SELECT ${groupCol} as eid,
             sum(${valExpr}) as val_all,
             sum(CASE WHEN lh.played_at >= ${weekStart} THEN ${valExpr} ELSE 0 END) as val_week,
             sum(CASE WHEN lh.played_at >= ${monthStart} THEN ${valExpr} ELSE 0 END) as val_month,
             sum(CASE WHEN lh.played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END) as val_year
      FROM listening_history lh
      ${resolvedPlayJoins(entityType, userId)}
      WHERE 1=1 ${uf} ${albumNullFilter(entityType)}
      GROUP BY eid
    ),
    target AS (
      SELECT val_all, val_week, val_month, val_year FROM entity_scores WHERE eid = ${entityId}
    )
    SELECT
      (SELECT val_week FROM target) as my_week,
      (SELECT val_month FROM target) as my_month,
      (SELECT val_year FROM target) as my_year,
      (SELECT val_all FROM target) as my_all,
      sum(CASE WHEN val_week > (SELECT val_week FROM target) THEN 1 ELSE 0 END) as rank_week,
      sum(CASE WHEN val_month > (SELECT val_month FROM target) THEN 1 ELSE 0 END) as rank_month,
      sum(CASE WHEN val_year > (SELECT val_year FROM target) THEN 1 ELSE 0 END) as rank_year,
      sum(CASE WHEN val_all > (SELECT val_all FROM target) THEN 1 ELSE 0 END) as rank_all
    FROM entity_scores
  `)[0] as { my_week: number; my_month: number; my_year: number; my_all: number; rank_week: number; rank_month: number; rank_year: number; rank_all: number } | undefined;

  if (!result || !result.my_all) return { week: null, month: null, thisYear: null, all: null };

  return {
    week: result.my_week > 0 ? result.rank_week + 1 : null,
    month: result.my_month > 0 ? result.rank_month + 1 : null,
    thisYear: result.my_year > 0 ? result.rank_year + 1 : null,
    all: result.rank_all + 1,
  };
}

/** Ranking all-time de un lote de tracks/albums en una sola pasada: mismo criterio
 *  de empates que computeRankings (RANK comparte posición) pero solo rango 'all'.
 *  Agrupa por el mismo resolvedEntityId que las queries de listado, así que las keys
 *  coinciden con los ids canónicos que ya tiene el frontend. Entidades sin plays o
 *  más allá del top-200 (DEFAULT_RANK_LIMITS.all) no aparecen en el resultado. */
export function computeRankingsBatch(db: Db, entityType: 'track' | 'album', entityIds: string[], sort: Sort, userId: number): Record<string, number> {
  if (entityIds.length === 0) return {};

  const uf = userFilter(userId);
  const groupCol = entityGroupCol(entityType);
  const valExpr = sort === 'plays' ? sql`1` : playDuration();
  const idList = sql.join(entityIds.map(id => sql`${id}`), sql`, `);

  const rows = db.all(sql`
    WITH entity_scores AS (
      SELECT ${groupCol} as eid, sum(${valExpr}) as val
      FROM listening_history lh
      ${resolvedPlayJoins(entityType, userId)}
      WHERE 1=1 ${uf} ${albumNullFilter(entityType)}
      GROUP BY eid
    ),
    ranked AS (
      SELECT eid, RANK() OVER (ORDER BY val DESC) as rnk FROM entity_scores
    )
    SELECT eid, rnk FROM ranked WHERE eid IN (${idList}) AND rnk <= ${DEFAULT_RANK_LIMITS.all}
  `) as { eid: string; rnk: number }[];

  return Object.fromEntries(rows.map(r => [r.eid, r.rnk]));
}

export interface ProjectionTarget {
  entityId: string;
  extraPlays: number;
  extraMs: number;
}

const DEFAULT_RANK_LIMITS: Record<string, number> = { thisYear: 50, all: 200 };

export interface ScoreRow { eid: string; val_all: number; val_year: number; pre_all: number; pre_year: number }

/** Ventana opcional de plays: `since` incluido, `before` excluido. */
interface PlayBounds { since?: string; before?: string }

/** Scan único de scores por entidad (YTD + All): val_* = score actual, pre_* = score
 *  antes de `cutoff` (o el total si cutoff es null). Base compartida entre proyecciones
 *  de sesión (cutoff = inicio de sesión) y cambios recientes (cutoff = hace N días).
 *  `bounds` restringe los plays escaneados (va por idx (user_id, played_at)). */
function scanPrePostScores(db: Db, entityType: EntityType, sort: Sort, userId: number, cutoff: string | null, bounds: PlayBounds = {}): ScoreRow[] {
  const uf = userFilter(userId);
  const yearStart = getRangeStart('thisYear')!;
  const playWindow = sql`${bounds.since ? sql`AND lh.played_at >= ${bounds.since}` : sql``} ${bounds.before ? sql`AND lh.played_at < ${bounds.before}` : sql``}`;

  if (entityType === 'artist') {
    const valExpr = sort === 'plays' ? sql`1` : playDuration();
    const inYear = sql`CASE WHEN lh.played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END`;
    return db.all(artistPerTrackScores(userId, {
      val_all: valExpr,
      val_year: inYear,
      pre_all: cutoff ? sql`CASE WHEN lh.played_at < ${cutoff} THEN ${valExpr} ELSE 0 END` : valExpr,
      pre_year: cutoff ? sql`CASE WHEN lh.played_at >= ${yearStart} AND lh.played_at < ${cutoff} THEN ${valExpr} ELSE 0 END` : inYear,
    }, { where: playWindow, restrictPairs: bounds.since !== undefined })) as ScoreRow[];
  }

  const groupCol = entityGroupCol(entityType);
  const valExpr = sort === 'plays' ? sql`1` : playDuration();
  const preAllExpr = cutoff ? sql`sum(CASE WHEN lh.played_at < ${cutoff} THEN ${valExpr} ELSE 0 END)` : sql`sum(${valExpr})`;
  const preYearExpr = cutoff ? sql`sum(CASE WHEN lh.played_at >= ${yearStart} AND lh.played_at < ${cutoff} THEN ${valExpr} ELSE 0 END)` : sql`sum(CASE WHEN lh.played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END)`;

  return db.all(sql`
    SELECT ${groupCol} as eid,
           sum(${valExpr}) as val_all,
           sum(CASE WHEN lh.played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END) as val_year,
           ${preAllExpr} as pre_all,
           ${preYearExpr} as pre_year
    FROM listening_history lh
    ${resolvedPlayJoins(entityType, userId)}
    WHERE 1=1 ${uf} ${albumNullFilter(entityType)} ${playWindow}
    GROUP BY eid
  `) as ScoreRow[];
}

/** Totales por entidad (all + YTD) de una ventana de plays: lo mínimo que viaja del
 *  worker al main thread para las proyecciones de sesión. */
export interface ProjectionScoreRow { eid: string; all: number; year: number }

function scanWindowScores(db: Db, entityType: EntityType, sort: Sort, userId: number, bounds: PlayBounds): ProjectionScoreRow[] {
  return scanPrePostScores(db, entityType, sort, userId, null, bounds)
    .map(r => ({ eid: r.eid, all: r.val_all, year: r.val_year }));
}

/** Base pre-sesión de las proyecciones: plays ANTERIORES al inicio de la sesión. Es un
 *  escaneo del historial entero (~0.8-1.7s por tipo), pero no cambia durante la sesión:
 *  la cachea services/projection-cache.ts. Dos funciones (base y delta) y no una con
 *  parámetros porque el pool clasifica light/heavy por nombre de función. */
export function scanProjectionBase(db: Db, entityType: EntityType, sort: Sort, userId: number, sessionStart: string): ProjectionScoreRow[] {
  return scanWindowScores(db, entityType, sort, userId, { before: sessionStart });
}

/** Delta de la sesión: sólo sus plays, por idx (user_id, played_at) — milisegundos. */
export function scanProjectionDelta(db: Db, entityType: EntityType, sort: Sort, userId: number, sessionStart: string): ProjectionScoreRow[] {
  return scanWindowScores(db, entityType, sort, userId, { since: sessionStart });
}

/** Ranking proyectado batch: 1 scan de entity_scores, N targets resueltos in-memory.
 *  Solo calcula YTD y All. Cuando sessionStart se pasa, "current" es el rank pre-sesión
 *  y "projected" es el rank post-sesión (incluyendo el track en curso vía extra). */
export function computeProjectedRankingsBatch(
  db: Db, entityType: EntityType, targets: ProjectionTarget[],
  sort: Sort, userId: number, sessionStart?: string | null,
  rankLimits?: Record<string, number>
): Map<string, Record<string, { current: number | null; projected: number | null; displaced: string[] }>> {
  if (targets.length === 0) return new Map();
  return projectRankings(scanPrePostScores(db, entityType, sort, userId, sessionStart ?? null), targets, sort, rankLimits);
}

/** Parte pura de computeProjectedRankingsBatch: ranks pre (pre_*) y post (val_*) de
 *  cada target sobre los scores ya escaneados. La usa también el main thread con la
 *  base cacheada + el delta de la sesión (services/projection-cache.ts). */
export function projectRankings(
  scores: ScoreRow[], targets: ProjectionTarget[], sort: Sort, rankLimits?: Record<string, number>,
): Map<string, Record<string, { current: number | null; projected: number | null; displaced: string[] }>> {
  const results = new Map<string, Record<string, { current: number | null; projected: number | null; displaced: string[] }>>();
  const byId = new Map(scores.map(s => [s.eid, s]));
  const ranges = ['thisYear', 'all'] as const;
  const valKeys = { thisYear: 'val_year', all: 'val_all' } as const;
  const preKeys = { thisYear: 'pre_year', all: 'pre_all' } as const;

  for (const target of targets) {
    const extra = sort === 'plays' ? target.extraPlays : target.extraMs;
    const my = byId.get(target.entityId);
    const out: Record<string, { current: number | null; projected: number | null; displaced: string[] }> = {};

    for (const range of ranges) {
      const vk = valKeys[range];
      const pk = preKeys[range];
      const myVal = my?.[vk] ?? 0;
      const preVal = my?.[pk] ?? 0;
      const projVal = myVal + extra;

      if (preVal === 0 && projVal === 0) {
        out[range] = { current: null, projected: null, displaced: [] };
        continue;
      }

      let currentAbove = 0;
      let projectedAbove = 0;
      const displacedIds: { eid: string; val: number }[] = [];
      for (const s of scores) {
        if (s.eid === target.entityId) continue;
        if (s[pk] > preVal) currentAbove++;
        if (s[vk] > projVal) projectedAbove++;
        // was above target pre-session, now at/below post-session → displaced
        if (s[pk] > preVal && s[vk] <= projVal) displacedIds.push({ eid: s.eid, val: s[vk] });
      }

      const current = preVal > 0 || range === 'all' ? currentAbove + 1 : null;
      const projected = (myVal > 0 || extra > 0) ? projectedAbove + 1 : null;

      const rankLimit = (rankLimits ?? DEFAULT_RANK_LIMITS)[range] ?? 100;
      if (current !== null && current > rankLimit && (projected === null || projected > rankLimit)) {
        out[range] = { current: null, projected: null, displaced: [] };
        continue;
      }

      displacedIds.sort((a, b) => b.val - a.val);
      out[range] = { current, projected, displaced: displacedIds.slice(0, CROSSOVER_LIMIT).map(d => d.eid) };
    }

    results.set(target.entityId, out);
  }

  return results;
}

// ranking competition (empates comparten puesto, semántica count-greater de computeRankings)
// sobre las filas con score > 0 de una clave dada
function buildRankMap(scores: ScoreRow[], key: 'val_all' | 'val_year' | 'pre_all' | 'pre_year'): Map<string, number> {
  const ranked = scores.filter(s => s[key] > 0).sort((a, b) => b[key] - a[key]);
  const map = new Map<string, number>();
  let rank = 0;
  let prevVal = Infinity;
  ranked.forEach((s, i) => {
    if (s[key] < prevVal) { rank = i + 1; prevVal = s[key]; }
    map.set(s.eid, rank);
  });
  return map;
}

/** Cambios de posición recientes: ranking actual vs ranking de hace `days` días,
 *  recomputado desde listening_history (sin snapshots — "permanente en el tiempo").
 *  Solo subidas (mismo diseño que las proyecciones de sesión), con las entidades
 *  desplazadas de cada cambio. Respeta los rankLimits del usuario (los de la
 *  session card); mejor posición vigente primero. */
export function getRecentRankChanges(
  db: Db, entityType: EntityType, days: number, sort: Sort, userId: number, limit: number,
  rankLimits?: Record<string, number>
): RecentRankChangeItem[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const scores = scanPrePostScores(db, entityType, sort, userId, cutoff);
  if (scores.length === 0) return [];

  const ranges = [
    { range: 'thisYear', now: 'val_year', pre: 'pre_year' },
    { range: 'all', now: 'val_all', pre: 'pre_all' },
  ] as const;

  const changesByEntity = new Map<string, RecentRankChange[]>();

  for (const { range, now, pre } of ranges) {
    const nowRanks = buildRankMap(scores, now);
    const preRanks = buildRankMap(scores, pre);
    const rankLimit = (rankLimits ?? DEFAULT_RANK_LIMITS)[range] ?? DEFAULT_RANK_LIMITS[range];

    for (const [eid, currentRank] of nowRanks) {
      if (currentRank > rankLimit) continue;
      const previousRank = preRanks.get(eid) ?? null;
      // solo subidas: entrada nueva o mejora de posición
      if (previousRank !== null && previousRank <= currentRank) continue;
      const list = changesByEntity.get(eid) ?? [];
      list.push({ range, previousRank, currentRank, delta: previousRank === null ? null : previousRank - currentRank, displaced: [] });
      changesByEntity.set(eid, list);
    }
  }

  if (changesByEntity.size === 0) return [];

  // mejor posición vigente primero; el cap se aplica antes de resolver metadata
  const ordered = [...changesByEntity.entries()]
    .sort((a, b) => Math.min(...a[1].map(c => c.currentRank)) - Math.min(...b[1].map(c => c.currentRank)))
    .slice(0, limit);

  // desplazados por cambio: estaban por encima antes del cutoff y ahora al nivel o por
  // debajo (mismo criterio por valor que computeProjectedRankingsBatch), solo para las
  // entidades devueltas — coste O(items × scores) en memoria
  const scoreByEid = new Map(scores.map(s => [s.eid, s]));
  const displacedIds = new Set<string>();
  for (const [entityId, changes] of ordered) {
    const my = scoreByEid.get(entityId);
    if (!my) continue;
    for (const change of changes) {
      const { now, pre } = ranges.find(r => r.range === change.range)!;
      const passed: { eid: string; val: number }[] = [];
      for (const s of scores) {
        if (s.eid === entityId) continue;
        if (s[pre] > my[pre] && s[now] <= my[now]) passed.push({ eid: s.eid, val: s[now] });
      }
      passed.sort((a, b) => b.val - a.val);
      change.displaced = passed.slice(0, CROSSOVER_LIMIT).map(d => ({ id: d.eid, name: '', imageUrl: null, artistName: null }));
      for (const d of change.displaced) displacedIds.add(d.id);
    }
  }

  // una sola resolución de metadata para entidades devueltas + desplazadas
  const metaMap = fetchEntityMetadata(db, entityType, [...new Set([...ordered.map(([eid]) => eid), ...displacedIds])], userId);

  return ordered.map(([entityId, changes]) => {
    const meta = metaMap.get(entityId);
    for (const change of changes) {
      for (const d of change.displaced) {
        const dMeta = metaMap.get(d.id);
        if (dMeta) { d.name = dMeta.name; d.imageUrl = dMeta.imageUrl; d.artistName = dMeta.artistName; }
      }
    }
    return {
      entityId,
      entityType,
      name: meta?.name ?? '',
      imageUrl: meta?.imageUrl ?? null,
      artistName: meta?.artistName ?? null,
      changes,
    };
  });
}

/** Wrapper single-entity para compatibilidad */
export function computeProjectedRankings(
  db: Db, entityType: EntityType, entityId: string,
  extraPlays: number, extraMs: number,
  sort: Sort, userId: number
): Record<string, { current: number | null; projected: number | null; displaced: string[] }> {
  const results = computeProjectedRankingsBatch(db, entityType, [{ entityId, extraPlays, extraMs }], sort, userId);
  const nil = { current: null, projected: null, displaced: [] };
  return results.get(entityId) ?? { thisYear: nil, all: nil };
}

/** Historial de ranking: posición acumulada de una entidad mes a mes.
 *  Optimizado: acumula mes a mes y calcula rank con COUNT. */
type MonthlyRow = { period: string; eid: string; val: number };

/** Valor de cada entidad por mes (UTC), todo el historial: la base de los historiales de
 *  ranking y de las posiciones YTD/All de getRankingsWithHistory. */
function monthlyEntityRows(db: Db, entityType: EntityType, sort: Sort, userId: number): MonthlyRow[] {
  const uf = userFilter(userId);
  let rows: MonthlyRow[];

  if (entityType === 'artist') {
    // orden explícito (periodo, entidad): es el que daba el GROUP BY y del que dependen
    // los empates de los crossovers
    rows = db.all(sql`
      ${artistPerTrackScores(userId, { val: sort === 'plays' ? sql`1` : playDuration() }, { bucket: sql`strftime('%Y-%m', lh.played_at)` })}
      ORDER BY 1, 2
    `) as { period: string; eid: string; val: number }[];
  } else {
    const groupCol = entityGroupCol(entityType);
    const metricCol = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;

    rows = db.all(sql`
      SELECT strftime('%Y-%m', lh.played_at) as period,
             ${groupCol} as eid,
             ${metricCol} as val
      FROM listening_history lh
      ${resolvedPlayJoins(entityType, userId)}
      WHERE 1=1 ${uf} ${albumNullFilter(entityType)}
      GROUP BY period, eid
      ORDER BY period
    `) as { period: string; eid: string; val: number }[];
  }

  return rows;
}

export function getRankingHistory(db: Db, entityType: EntityType, entityId: string, sort: Sort, userId: number): RankingHistoryPoint[] {
  const rows = monthlyEntityRows(db, entityType, sort, userId);

  if (rows.length === 0) return [];

  const cumulative = new Map<string, number>();
  const periods = [...new Set(rows.map(r => r.period))].sort();

  const result: RankingHistoryPoint[] = [];
  let rowIdx = 0;

  for (const period of periods) {
    while (rowIdx < rows.length && rows[rowIdx].period === period) {
      const r = rows[rowIdx];
      cumulative.set(r.eid, (cumulative.get(r.eid) || 0) + r.val);
      rowIdx++;
    }

    const myVal = cumulative.get(entityId);
    if (myVal == null) continue;

    let higher = 0;
    for (const [, val] of cumulative) {
      if (val > myVal) higher++;
    }
    result.push({ period, rank: higher + 1 });
  }

  return result;
}

const CROSSOVER_LIMIT = 10;

export function getRankingHistoryWithCrossovers(db: Db, entityType: EntityType, entityId: string, sort: Sort, userId: number): RankingHistoryPointWithCrossovers[] {
  return crossoverHistory(db, entityType, entityId, userId, monthlyEntityRows(db, entityType, sort, userId));
}

// historial acumulado mes a mes con los cruces de cada mes, sobre las filas mensuales
function crossoverHistory(db: Db, entityType: EntityType, entityId: string, userId: number, rows: MonthlyRow[]): RankingHistoryPointWithCrossovers[] {

  if (rows.length === 0) return [];

  const cumulative = new Map<string, number>();
  const periods = [...new Set(rows.map(r => r.period))].sort();

  const result: RankingHistoryPointWithCrossovers[] = [];
  const crossoverEids = new Set<string>();
  let rowIdx = 0;
  let prevMyVal: number | undefined;

  for (const period of periods) {
    const periodDelta = new Map<string, number>();
    while (rowIdx < rows.length && rows[rowIdx].period === period) {
      const r = rows[rowIdx];
      periodDelta.set(r.eid, (periodDelta.get(r.eid) || 0) + r.val);
      cumulative.set(r.eid, (cumulative.get(r.eid) || 0) + r.val);
      rowIdx++;
    }

    const myVal = cumulative.get(entityId);
    if (myVal == null) continue;

    let higher = 0;
    const surpassedByIds: { eid: string; val: number }[] = [];
    const surpassedIds: { eid: string; val: number }[] = [];

    for (const [eid, val] of cumulative) {
      if (val > myVal) higher++;

      if (eid === entityId || prevMyVal == null) continue;

      const prevVal = val - (periodDelta.get(eid) || 0);
      // entity was at or below target, now above → surpassed us
      if (prevVal <= prevMyVal && val > myVal) surpassedByIds.push({ eid, val });
      // entity was at or above target, now below → we surpassed them
      if (prevVal >= prevMyVal && val < myVal) surpassedIds.push({ eid, val });
    }

    const rank = higher + 1;
    const point: RankingHistoryPointWithCrossovers = { period, rank };

    if (rank <= 200 && (surpassedByIds.length > 0 || surpassedIds.length > 0)) {
      // sort by proximity to target's value
      surpassedByIds.sort((a, b) => a.val - b.val);
      surpassedIds.sort((a, b) => b.val - a.val);

      const sbSlice = surpassedByIds.slice(0, CROSSOVER_LIMIT);
      const sSlice = surpassedIds.slice(0, CROSSOVER_LIMIT);

      for (const e of sbSlice) crossoverEids.add(e.eid);
      for (const e of sSlice) crossoverEids.add(e.eid);

      point.crossovers = {
        surpassedBy: sbSlice.map(e => ({ id: e.eid, name: '', imageUrl: null, artistName: null })),
        surpassed: sSlice.map(e => ({ id: e.eid, name: '', imageUrl: null, artistName: null })),
      };
    }

    result.push(point);
    prevMyVal = myVal;
  }

  // batch-resolve metadata for all crossover entities
  if (crossoverEids.size > 0) {
    const metaMap = fetchEntityMetadata(db, entityType, [...crossoverEids], userId);
    for (const point of result) {
      if (!point.crossovers) continue;
      for (const e of point.crossovers.surpassedBy) {
        const meta = metaMap.get(e.id);
        if (meta) { e.name = meta.name; e.imageUrl = meta.imageUrl; e.artistName = meta.artistName; }
      }
      for (const e of point.crossovers.surpassed) {
        const meta = metaMap.get(e.id);
        if (meta) { e.name = meta.name; e.imageUrl = meta.imageUrl; e.artistName = meta.artistName; }
      }
    }
  }

  return result;
}

/** Posiciones (7D, 30D, YTD, All) e historial mensual con cruces de UNA entidad, en un
 *  solo escaneo del historial: RankingBadges pedía /rankings y /ranking-history por
 *  separado y cada uno recorría el historial entero. YTD y All salen de las mismas filas
 *  mensuales (los meses son UTC, igual que el inicio de año de getRangeStart); 7D y 30D
 *  son ventanas rodantes y salen de una query acotada a los últimos 30 días. Mismos
 *  valores que computeRankings: posición = entidades con más valor + 1, null sin valor. */
export function getRankingsWithHistory(db: Db, entityType: EntityType, entityId: string, sort: Sort, userId: number): RankingsWithHistory {
  const rows = monthlyEntityRows(db, entityType, sort, userId);
  const history = crossoverHistory(db, entityType, entityId, userId, rows);

  const yearKey = getRangeStart('thisYear')!.slice(0, 7);
  const total = new Map<string, number>();
  const ytd = new Map<string, number>();
  for (const r of rows) {
    total.set(r.eid, (total.get(r.eid) ?? 0) + r.val);
    if (r.period >= yearKey) ytd.set(r.eid, (ytd.get(r.eid) ?? 0) + r.val);
  }

  const weekStart = getRangeStart('week')!;
  const monthStart = getRangeStart('month')!;
  const valExpr = sort === 'plays' ? sql`1` : playDuration();
  const inWeek = sql`CASE WHEN lh.played_at >= ${weekStart} THEN ${valExpr} ELSE 0 END`;
  const recent = (entityType === 'artist'
    ? db.all(artistPerTrackScores(userId, { val_week: inWeek, val_month: valExpr }, { where: sql`AND lh.played_at >= ${monthStart}`, restrictPairs: true }))
    : db.all(sql`
        SELECT ${entityGroupCol(entityType)} as eid, sum(${inWeek}) as val_week, sum(${valExpr}) as val_month
        FROM listening_history lh
        ${resolvedPlayJoins(entityType, userId)}
        WHERE 1=1 ${userFilter(userId)} ${albumNullFilter(entityType)} AND lh.played_at >= ${monthStart}
        GROUP BY eid
      `)) as { eid: string; val_week: number | null; val_month: number | null }[];
  const week = new Map(recent.map(r => [r.eid, r.val_week ?? 0]));
  const month = new Map(recent.map(r => [r.eid, r.val_month ?? 0]));

  // posición = cuántas entidades valen más + 1; sin valor propio, sin posición
  const rankIn = (values: Map<string, number>): number | null => {
    const mine = values.get(entityId) ?? 0;
    if (!(mine > 0)) return null;
    let higher = 0;
    for (const v of values.values()) if (v > mine) higher++;
    return higher + 1;
  };

  const all = total.get(entityId) ?? 0;
  if (!all) return { rankings: { week: null, month: null, thisYear: null, all: null }, history };
  let higherAll = 0;
  for (const v of total.values()) if (v > all) higherAll++;
  return {
    rankings: { week: rankIn(week), month: rankIn(month), thisYear: rankIn(ytd), all: higherAll + 1 },
    history,
  };
}
