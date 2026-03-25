import { sql } from 'drizzle-orm';
import type { Db, Sort } from './helpers.js';
import { rangeWhere, orderByCol } from './helpers.js';

/** Top tracks de un artista */
export function getArtistTopTracks(db: Db, artistId: string, rangeStart: string | null, sort: Sort, limit: number) {
  const wr = rangeWhere(rangeStart);
  const ob = orderByCol(sort);

  return db.all(sql`
    SELECT lh.track_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ta.artist_id = ${artistId} ${wr}
    GROUP BY lh.track_id
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as { track_id: string; play_count: number; total_ms: number }[];
}

/** Top álbumes de un artista (solo donde es artista principal, position=0) */
export function getArtistTopAlbums(db: Db, artistId: string, rangeStart: string | null, sort: Sort, limit: number) {
  const wr = rangeWhere(rangeStart);
  const ob = orderByCol(sort);

  return db.all(sql`
    SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ta.artist_id = ${artistId} AND t.album_id IS NOT NULL ${wr}
      AND t.album_id IN (
        SELECT DISTINCT t2.album_id FROM tracks t2
        JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id
        WHERE ta2.artist_id = ${artistId} AND ta2.position = 0
      )
    GROUP BY t.album_id
    ORDER BY ${ob} DESC
    LIMIT ${limit}
  `) as { album_id: string; play_count: number; total_ms: number }[];
}
