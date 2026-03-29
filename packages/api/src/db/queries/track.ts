import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import { rangeWhere, userFilter } from './helpers.js';

/** Desglose por álbum (en qué álbumes se escuchó un track) */
export function getTrackAlbumBreakdown(db: Db, trackId: string, rangeStart: string | null, rangeEnd: string | null | undefined, userId: number) {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);

  return db.all(sql`
    SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.track_id = ${trackId} ${wr} ${uf}
      AND t.album_id IS NOT NULL
    GROUP BY t.album_id
    ORDER BY play_count DESC
  `) as { album_id: string; play_count: number; total_ms: number }[];
}
