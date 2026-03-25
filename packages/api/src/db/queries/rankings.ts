import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort } from './helpers.js';
import { getRangeStart, entityJoins, entityGroupCol } from './helpers.js';

/** Rankings: posición de una entidad en 4 rangos fijos (week, month, thisYear, all).
 *  Optimizado: un solo scan de listening_history con CASE para los 4 rangos,
 *  luego cálculo de posición en JS. */
export function computeRankings(db: Db, entityType: EntityType, entityId: string, sort: Sort): Record<string, number | null> {
  const join = entityJoins(entityType);
  const groupCol = entityGroupCol(entityType);

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

  const rows = db.all(sql`
    SELECT ${groupCol} as eid,
           ${metric.all} as val_all,
           ${metric.week} as val_week,
           ${metric.month} as val_month,
           ${metric.thisYear} as val_year
    FROM listening_history lh
    ${join}
    JOIN tracks t ON t.spotify_id = lh.track_id
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
