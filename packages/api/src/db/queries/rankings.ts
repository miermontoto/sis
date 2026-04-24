import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort } from './helpers.js';
import type { RankingHistoryPoint } from '@sis/shared';
import { getRangeStart, entityJoins, entityGroupCol, entityMergeJoin, resolvedEntityId, userFilter } from './helpers.js';

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
    const valExpr = sort === 'plays' ? sql`1` : sql`duration_ms`;

    const result = db.all(sql`
      WITH plays_dedup AS (
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, lh.played_at as played_at, t.duration_ms as duration_ms
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

  // album ó track: incluir merge join para que COALESCE tenga efecto
  const join = entityJoins(entityType, userId);
  const groupCol = entityGroupCol(entityType, userId);
  const extraMergeJoin = entityMergeJoin(entityType, userId);
  const albumFilter = entityType === 'album' ? sql`AND t.album_id IS NOT NULL` : sql``;

  const valExpr = sort === 'plays' ? sql`1` : sql`t.duration_ms`;

  // un solo scan: agrupa por entidad, calcula scores en 4 rangos
  // luego cuenta cuántas tienen score mayor que el target
  const result = db.all(sql`
    WITH entity_scores AS (
      SELECT ${groupCol} as eid,
             sum(${valExpr}) as val_all,
             sum(CASE WHEN lh.played_at >= ${weekStart} THEN ${valExpr} ELSE 0 END) as val_week,
             sum(CASE WHEN lh.played_at >= ${monthStart} THEN ${valExpr} ELSE 0 END) as val_month,
             sum(CASE WHEN lh.played_at >= ${yearStart} THEN ${valExpr} ELSE 0 END) as val_year
      FROM listening_history lh
      ${join}
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${extraMergeJoin}
      WHERE 1=1 ${uf} ${albumFilter}
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
        SELECT DISTINCT ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, lh.played_at as played_at, t.duration_ms as duration_ms
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
    const join = entityJoins(entityType, userId);
    const groupCol = entityGroupCol(entityType, userId);
    const extraMergeJoin = entityMergeJoin(entityType, userId);
    const albumFilter = entityType === 'album' ? sql`AND t.album_id IS NOT NULL` : sql``;
    const metricCol = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;

    // un solo scan: obtener totales mensuales por entidad
    rows = db.all(sql`
      SELECT strftime('%Y-%m', lh.played_at) as period,
             ${groupCol} as eid,
             ${metricCol} as val
      FROM listening_history lh
      ${join}
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${extraMergeJoin}
      WHERE 1=1 ${uf} ${albumFilter}
      GROUP BY period, eid
      ORDER BY period
    `) as { period: string; eid: string; val: number }[];
  }

  if (rows.length === 0) return [];

  // acumular totales por entidad y calcular rank solo en meses donde el target tiene datos
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
