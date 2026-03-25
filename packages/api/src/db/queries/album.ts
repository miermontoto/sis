import { sql } from 'drizzle-orm';
import type { Db, Sort, SqlChunk } from './helpers.js';
import { rangeWhere } from './helpers.js';

/** Resolver IDs de álbum: el target + todos sus sources mergeados */
export function resolveAlbumIds(db: Db, albumId: string): string[] {
  const sources = db.all(sql`
    SELECT source_id FROM merge_rules WHERE entity_type = 'album' AND target_id = ${albumId}
  `) as { source_id: string }[];
  return [albumId, ...sources.map(r => r.source_id)];
}

// helper: WHERE con IDs pre-resueltos
function albumIdIn(ids: string[], tableAlias = 't') {
  const col = sql.raw(`${tableAlias}.album_id`);
  if (ids.length === 1) return sql`${col} = ${ids[0]}`;
  // construir IN (...) con placeholders
  const placeholders = sql.join(ids.map(id => sql`${id}`), sql`, `);
  return sql`${col} IN (${placeholders})`;
}

/** Artistas principales de un álbum (position=0 únicamente), incluye mergeados */
export function getAlbumArtists(db: Db, albumId: string, ids?: string[]) {
  const albumIds = ids ?? resolveAlbumIds(db, albumId);
  return db.all(sql`
    SELECT ta.artist_id, a.name, a.image_url
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE ${albumIdIn(albumIds)}
    GROUP BY ta.artist_id
    ORDER BY MIN(ta.position) ASC
  `) as { artist_id: string; name: string; image_url: string | null }[];
}

/** Tracks de un álbum con play counts, incluye mergeados */
export function getAlbumTracks(db: Db, albumId: string, rangeStart: string | null, sort: Sort, ids?: string[]) {
  const albumIds = ids ?? resolveAlbumIds(db, albumId);
  const wr = rangeWhere(rangeStart);

  return db.all(sql`
    SELECT t.spotify_id as track_id, t.name, t.duration_ms, t.track_number,
           coalesce(s.play_count, 0) as play_count, coalesce(s.total_ms, 0) as total_ms
    FROM tracks t
    LEFT JOIN (
      SELECT lh.track_id, count(*) as play_count, sum(tr.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks tr ON tr.spotify_id = lh.track_id
      WHERE ${albumIdIn(albumIds, 'tr')} ${wr}
      GROUP BY lh.track_id
    ) s ON s.track_id = t.spotify_id
    WHERE ${albumIdIn(albumIds)}
    ORDER BY ${sort === 'plays' ? sql`play_count` : sql`total_ms`} DESC, t.track_number ASC
  `) as { track_id: string; name: string; duration_ms: number; track_number: number | null; play_count: number; total_ms: number }[];
}
