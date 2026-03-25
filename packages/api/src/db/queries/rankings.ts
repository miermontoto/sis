import { sql } from 'drizzle-orm';
import type { Db, EntityType, Sort } from './helpers.js';
import { getRangeStart, entityJoins, entityGroupCol, entityWhereCol } from './helpers.js';

/** Rankings: posición de una entidad en 4 rangos fijos (week, month, thisYear, all) */
export function computeRankings(db: Db, entityType: EntityType, entityId: string, sort: Sort): Record<string, number | null> {
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;
  const ranges = ['week', 'month', 'thisYear', 'all'] as const;
  const rankings: Record<string, number | null> = {};

  for (const r of ranges) {
    const rs = getRangeStart(r);
    const wr = rs ? sql`AND lh.played_at >= ${rs}` : sql``;
    const groupCol = entityGroupCol(entityType);
    const whereEntity = entityWhereCol(entityType, entityId);
    const join = entityJoins(entityType);

    const row = db.all(sql`
      SELECT count(*) + 1 as rank FROM (
        SELECT ${groupCol} as eid, ${metric} as val
        FROM listening_history lh
        ${join}
        JOIN tracks t ON t.spotify_id = lh.track_id
        WHERE 1=1 ${wr}
        GROUP BY eid
        HAVING val > (
          SELECT coalesce(${metric}, 0)
          FROM listening_history lh
          ${join}
          JOIN tracks t ON t.spotify_id = lh.track_id
          WHERE ${whereEntity} ${wr}
        )
      )
    `)[0] as { rank: number } | undefined;

    const hasPlays = db.all(sql`
      SELECT 1 FROM listening_history lh
      ${join}
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE ${whereEntity} ${wr}
      LIMIT 1
    `).length > 0;

    rankings[r] = hasPlays ? (row?.rank ?? 1) : null;
  }
  return rankings;
}
