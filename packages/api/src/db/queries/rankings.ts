import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort } from './helpers.js';
import type { RankingHistoryPoint, RankingHistoryPointWithCrossovers, RecentRankChange, RecentRankChangeItem } from '@sis/shared';
import { getRangeStart, entityGroupCol, entityMergeJoin, resolvedEntityId, userFilter, resolvedPlayJoins, albumNullFilter, playDuration } from './helpers.js';
import { fetchEntityMetadata } from './charts.js';

/** Rankings: posición de una entidad en 4 rangos fijos (week, month, thisYear, all).
 *  Optimizado: 1 scan con CASE para los 4 rangos + COUNT del target en la misma query. */
export function computeRankings(db: Db, entityType: EntityType, entityId: string, sort: Sort, userId: number): Record<string, number | null> {
  const uf = userFilter(userId);
  const weekStart = getRangeStart('week')!;
  const monthStart = getRangeStart('month')!;
  const yearStart = getRangeStart('thisYear')!;

  // artistas: dedupe por play para evitar doble count cuando un track tiene 2 artists mergeados al mismo target
  if (entityType === 'artist') {
    const mrJoin = entityMergeJoin('artist', userId);
    const valExpr = sort === 'plays' ? sql`1` : sql.raw('duration_ms');

    const result = db.all(sql`
      WITH plays_dedup AS (
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, lh.played_at as played_at, ${playDuration()} as duration_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.user_id = ${userId}
      ),
      entity_scores AS (
        SELECT eid,
               sum(${valExpr}) as val_all,
               sum(CASE WHEN played_at >= ${weekStart} THEN ${valExpr} ELSE 0 END) as val_week,
               sum(CASE WHEN played_at >= ${monthStart} THEN ${valExpr} ELSE 0 END) as val_month,
               sum(CASE WHEN played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END) as val_year
        FROM plays_dedup
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

  // album ó track: resolvedPlayJoins maneja toda la cadena de merges
  const groupCol = entityGroupCol(entityType, userId);
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
  const groupCol = entityGroupCol(entityType, userId);
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

interface ProjectionTarget {
  entityId: string;
  extraPlays: number;
  extraMs: number;
}

const DEFAULT_RANK_LIMITS: Record<string, number> = { thisYear: 50, all: 200 };

interface ScoreRow { eid: string; val_all: number; val_year: number; pre_all: number; pre_year: number }

/** Scan único de scores por entidad (YTD + All): val_* = score actual, pre_* = score
 *  antes de `cutoff` (o el total si cutoff es null). Base compartida entre proyecciones
 *  de sesión (cutoff = inicio de sesión) y cambios recientes (cutoff = hace N días). */
function scanPrePostScores(db: Db, entityType: EntityType, sort: Sort, userId: number, cutoff: string | null): ScoreRow[] {
  const uf = userFilter(userId);
  const yearStart = getRangeStart('thisYear')!;

  if (entityType === 'artist') {
    const mrJoin = entityMergeJoin('artist', userId);
    const valExpr = sort === 'plays' ? sql`1` : sql.raw('duration_ms');
    const preAllExpr = cutoff ? sql`sum(CASE WHEN played_at < ${cutoff} THEN ${valExpr} ELSE 0 END)` : sql`sum(${valExpr})`;
    const preYearExpr = cutoff ? sql`sum(CASE WHEN played_at >= ${yearStart} AND played_at < ${cutoff} THEN ${valExpr} ELSE 0 END)` : sql`sum(CASE WHEN played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END)`;
    return db.all(sql`
      WITH plays_dedup AS (
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, lh.played_at as played_at, ${playDuration()} as duration_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.user_id = ${userId}
      )
      SELECT eid,
             sum(${valExpr}) as val_all,
             sum(CASE WHEN played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END) as val_year,
             ${preAllExpr} as pre_all,
             ${preYearExpr} as pre_year
      FROM plays_dedup
      GROUP BY eid
    `) as ScoreRow[];
  }

  const groupCol = entityGroupCol(entityType, userId);
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
    WHERE 1=1 ${uf} ${albumNullFilter(entityType)}
    GROUP BY eid
  `) as ScoreRow[];
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

  const scores = scanPrePostScores(db, entityType, sort, userId, sessionStart ?? null);

  const results = new Map<string, Record<string, { current: number | null; projected: number | null; displaced: string[] }>>();
  const ranges = ['thisYear', 'all'] as const;
  const valKeys = { thisYear: 'val_year', all: 'val_all' } as const;
  const preKeys = { thisYear: 'pre_year', all: 'pre_all' } as const;

  for (const target of targets) {
    const extra = sort === 'plays' ? target.extraPlays : target.extraMs;
    const my = scores.find(s => s.eid === target.entityId);
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
  const metaMap = fetchEntityMetadata(db, entityType, [...new Set([...ordered.map(([eid]) => eid), ...displacedIds])]);

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
export function getRankingHistory(db: Db, entityType: EntityType, entityId: string, sort: Sort, userId: number): RankingHistoryPoint[] {
  const uf = userFilter(userId);

  let rows: { period: string; eid: string; val: number }[];

  if (entityType === 'artist') {
    const mrJoin = entityMergeJoin('artist', userId);
    const metricCol = sort === 'plays' ? sql`count(*)` : sql`sum(duration_ms)`;

    rows = db.all(sql`
      WITH plays_dedup AS (
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, lh.played_at as played_at, ${playDuration()} as duration_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.user_id = ${userId}
      )
      SELECT strftime('%Y-%m', played_at) as period, eid, ${metricCol} as val
      FROM plays_dedup
      GROUP BY period, eid
      ORDER BY period
    `) as { period: string; eid: string; val: number }[];
  } else {
    const groupCol = entityGroupCol(entityType, userId);
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
  const uf = userFilter(userId);

  let rows: { period: string; eid: string; val: number }[];

  if (entityType === 'artist') {
    const mrJoin = entityMergeJoin('artist', userId);
    const metricCol = sort === 'plays' ? sql`count(*)` : sql`sum(duration_ms)`;

    rows = db.all(sql`
      WITH plays_dedup AS (
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, lh.played_at as played_at, ${playDuration()} as duration_ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN track_artists ta ON ta.track_id = lh.track_id
        ${mrJoin}
        WHERE lh.user_id = ${userId}
      )
      SELECT strftime('%Y-%m', played_at) as period, eid, ${metricCol} as val
      FROM plays_dedup
      GROUP BY period, eid
      ORDER BY period
    `) as { period: string; eid: string; val: number }[];
  } else {
    const groupCol = entityGroupCol(entityType, userId);
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
    const metaMap = fetchEntityMetadata(db, entityType, [...crossoverEids]);
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
