import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort } from './helpers.js';
import type { RankingHistoryPoint, RankingHistoryPointWithCrossovers } from '@sis/shared';
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

interface ProjectionTarget {
  entityId: string;
  extraPlays: number;
  extraMs: number;
}

const DEFAULT_RANK_LIMITS: Record<string, number> = { thisYear: 50, all: 200 };

interface ScoreRow { eid: string; val_all: number; val_year: number; pre_all: number; pre_year: number }

/** Ranking proyectado batch: 1 scan de entity_scores, N targets resueltos in-memory.
 *  Solo calcula YTD y All. Cuando sessionStart se pasa, "current" es el rank pre-sesión
 *  y "projected" es el rank post-sesión (incluyendo el track en curso vía extra). */
export function computeProjectedRankingsBatch(
  db: Db, entityType: EntityType, targets: ProjectionTarget[],
  sort: Sort, userId: number, sessionStart?: string | null,
  rankLimits?: Record<string, number>
): Map<string, Record<string, { current: number | null; projected: number | null; displaced: string[] }>> {
  if (targets.length === 0) return new Map();

  const uf = userFilter(userId);
  const yearStart = getRangeStart('thisYear')!;
  const hasSession = !!sessionStart;

  let scores: ScoreRow[];

  if (entityType === 'artist') {
    const mrJoin = entityMergeJoin('artist', userId);
    const valExpr = sort === 'plays' ? sql`1` : sql.raw('duration_ms');
    const preAllExpr = hasSession ? sql`sum(CASE WHEN played_at < ${sessionStart} THEN ${valExpr} ELSE 0 END)` : sql`sum(${valExpr})`;
    const preYearExpr = hasSession ? sql`sum(CASE WHEN played_at >= ${yearStart} AND played_at < ${sessionStart} THEN ${valExpr} ELSE 0 END)` : sql`sum(CASE WHEN played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END)`;
    scores = db.all(sql`
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
  } else {
    const groupCol = entityGroupCol(entityType, userId);
    const valExpr = sort === 'plays' ? sql`1` : playDuration();
    const preAllExpr = hasSession ? sql`sum(CASE WHEN lh.played_at < ${sessionStart} THEN ${valExpr} ELSE 0 END)` : sql`sum(${valExpr})`;
    const preYearExpr = hasSession ? sql`sum(CASE WHEN lh.played_at >= ${yearStart} AND lh.played_at < ${sessionStart} THEN ${valExpr} ELSE 0 END)` : sql`sum(CASE WHEN lh.played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END)`;

    scores = db.all(sql`
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
