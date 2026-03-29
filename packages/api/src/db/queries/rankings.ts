import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort } from './helpers.js';
import { getRangeStart, entityJoins, entityGroupCol, mergeRulesJoin, userFilter } from './helpers.js';

export interface RankingHistoryPoint {
  period: string;
  rank: number;
}

/** Rankings: posición de una entidad en 4 rangos fijos (week, month, thisYear, all).
 *  Optimizado: un solo scan de listening_history con CASE para los 4 rangos,
 *  luego cálculo de posición en JS. */
export function computeRankings(db: Db, entityType: EntityType, entityId: string, sort: Sort, userId: number): Record<string, number | null> {
  const join = entityJoins(entityType);
  const groupCol = entityGroupCol(entityType, userId);
  const uf = userFilter(userId);

  const weekStart = getRangeStart('week')!;
  const monthStart = getRangeStart('month')!;
  const yearStart = getRangeStart('thisYear')!;

  const metric = sort === 'plays'
    ? { all: sql`count(*)`, week: sql`sum(CASE WHEN lh.played_at >= ${weekStart} THEN 1 ELSE 0 END)`,
        month: sql`sum(CASE WHEN lh.played_at >= ${monthStart} THEN 1 ELSE 0 END)`,
        thisYear: sql`sum(CASE WHEN lh.played_at >= ${yearStart} THEN 1 ELSE 0 END)` }
    : { all: sql`sum(t.duration_ms)`, week: sql`sum(CASE WHEN lh.played_at >= ${weekStart} THEN t.duration_ms ELSE 0 END)`,
        month: sql`sum(CASE WHEN lh.played_at >= ${monthStart} THEN t.duration_ms ELSE 0 END)`,
        thisYear: sql`sum(CASE WHEN lh.played_at >= ${yearStart} THEN t.duration_ms ELSE 0 END)` };

  const albumJoin = entityType === 'album' ? mergeRulesJoin(userId) : sql``;

  const rows = db.all(sql`
    SELECT ${groupCol} as eid,
           ${metric.all} as val_all,
           ${metric.week} as val_week,
           ${metric.month} as val_month,
           ${metric.thisYear} as val_year
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${albumJoin}
    WHERE 1=1 ${uf}
    GROUP BY eid
  `) as { eid: string; val_all: number; val_week: number; val_month: number; val_year: number }[];

  const me = rows.find(r => r.eid === entityId);
  if (!me) return { week: null, month: null, thisYear: null, all: null };

  return {
    week: me.val_week > 0 ? rows.filter(r => r.val_week > me.val_week).length + 1 : null,
    month: me.val_month > 0 ? rows.filter(r => r.val_month > me.val_month).length + 1 : null,
    thisYear: me.val_year > 0 ? rows.filter(r => r.val_year > me.val_year).length + 1 : null,
    all: rows.filter(r => r.val_all > me.val_all).length + 1,
  };
}

/** Historial de ranking: posición acumulada de una entidad mes a mes. */
export function getRankingHistory(db: Db, entityType: EntityType, entityId: string, sort: Sort, userId: number): RankingHistoryPoint[] {
  const join = entityJoins(entityType);
  const groupCol = entityGroupCol(entityType, userId);
  const albumJoin = entityType === 'album' ? mergeRulesJoin(userId) : sql``;
  const uf = userFilter(userId);

  const rows = db.all(sql`
    SELECT strftime('%Y-%m', lh.played_at) as period,
           ${groupCol} as eid,
           count(*) as plays,
           sum(t.duration_ms) as total_ms
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${albumJoin}
    WHERE 1=1 ${uf}
    GROUP BY period, eid
    ORDER BY period
  `) as { period: string; eid: string; plays: number; total_ms: number }[];

  if (rows.length === 0) return [];

  // acumular totales por entidad
  const cumulative = new Map<string, number>();
  const periods = [...new Set(rows.map(r => r.period))].sort();

  const result: RankingHistoryPoint[] = [];
  let rowIdx = 0;

  for (const period of periods) {
    // sumar incrementos de este periodo
    while (rowIdx < rows.length && rows[rowIdx].period === period) {
      const r = rows[rowIdx];
      const prev = cumulative.get(r.eid) || 0;
      cumulative.set(r.eid, prev + (sort === 'plays' ? r.plays : r.total_ms));
      rowIdx++;
    }

    const myVal = cumulative.get(entityId);
    if (myVal == null) continue;

    // contar cuántos tienen más que yo
    let higher = 0;
    for (const [, val] of cumulative) {
      if (val > myVal) higher++;
    }
    result.push({ period, rank: higher + 1 });
  }

  return result;
}
