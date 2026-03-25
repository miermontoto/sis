import { sql } from 'drizzle-orm';
import type { Db, Sort } from './helpers.js';
import { rangeWhere } from './helpers.js';

/** Artistas principales de un álbum (position=0 únicamente) */
export function getAlbumArtists(db: Db, albumId: string) {
  return db.all(sql`
    SELECT DISTINCT ta.artist_id, a.name, a.image_url
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE t.album_id = ${albumId}
    ORDER BY ta.position ASC
  `) as { artist_id: string; name: string; image_url: string | null }[];
}

/** Tracks de un álbum con play counts */
export function getAlbumTracks(db: Db, albumId: string, rangeStart: string | null, sort: Sort) {
  const wr = rangeWhere(rangeStart);

  return db.all(sql`
    SELECT t.spotify_id as track_id, t.name, t.duration_ms, t.track_number,
           coalesce(s.play_count, 0) as play_count, coalesce(s.total_ms, 0) as total_ms
    FROM tracks t
    LEFT JOIN (
      SELECT lh.track_id, count(*) as play_count, sum(tr.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks tr ON tr.spotify_id = lh.track_id
      WHERE tr.album_id = ${albumId} ${wr}
      GROUP BY lh.track_id
    ) s ON s.track_id = t.spotify_id
    WHERE t.album_id = ${albumId}
    ORDER BY ${sort === 'plays' ? sql`play_count` : sql`total_ms`} DESC, t.track_number ASC
  `) as { track_id: string; name: string; duration_ms: number; track_number: number | null; play_count: number; total_ms: number }[];
}
