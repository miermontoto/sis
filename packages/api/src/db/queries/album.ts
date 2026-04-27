import { sql } from 'drizzle-orm';
import type { Db, Sort } from './helpers.js';
import { rangeWhere, userFilter, albumIdIn, entityMergeJoin, resolvedEntityId } from './helpers.js';

/** Artistas principales de un álbum. Usa artist_ids de Spotify si están disponibles, sino heurística por track artists */
export function getAlbumArtists(db: Db, albumId: string, ids?: string[]) {
  const albumIds = ids ?? [albumId];

  // intentar usar artist_ids almacenados del album (datos de spotify)
  const album = db.all(sql`
    SELECT artist_ids FROM albums WHERE spotify_id = ${albumId}
  `)[0] as { artist_ids: string | string[] | null } | undefined;

  if (album?.artist_ids) {
    const parsed = typeof album.artist_ids === 'string'
      ? JSON.parse(album.artist_ids)
      : album.artist_ids;
    const artistIdList: string[] = Array.isArray(parsed) ? parsed : [];

    if (artistIdList.length > 0) {
      const placeholders = sql.join(artistIdList.map(id => sql`${id}`), sql`, `);
      return db.all(sql`
        SELECT a.spotify_id as artist_id, a.name, a.image_url
        FROM artists a
        WHERE a.spotify_id IN (${placeholders})
      `) as { artist_id: string; name: string; image_url: string | null }[];
    }
  }

  // fallback: heurística — position=0 artists presentes en >50% de los tracks
  const totalRow = db.all(sql`
    SELECT count(*) as total FROM tracks t WHERE ${albumIdIn(albumIds)}
  `)[0] as { total: number };
  const threshold = Math.max(1, Math.floor(totalRow.total * 0.5));

  return db.all(sql`
    SELECT ta.artist_id, a.name, a.image_url, count(DISTINCT t.spotify_id) as track_count
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE ${albumIdIn(albumIds)}
    GROUP BY ta.artist_id
    HAVING track_count >= ${threshold}
    ORDER BY track_count DESC, MIN(ta.position) ASC
  `) as { artist_id: string; name: string; image_url: string | null }[];
}

/** Tracks de un álbum con play counts (merge-aware: agrupa plays por track canónico, excluye tracks source) */
export function getAlbumTracks(db: Db, albumId: string, rangeStart: string | null, sort: Sort, ids: string[] | undefined, rangeEnd: string | null | undefined, userId: number) {
  const albumIds = ids ?? [albumId];
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);
  const trackMrJoin = entityMergeJoin('track', userId);

  return db.all(sql`
    SELECT t.spotify_id as track_id, t.name, t.duration_ms, t.track_number, t.disc_number,
           coalesce(s.play_count, 0) as play_count, coalesce(s.total_ms, 0) as total_ms
    FROM tracks t
    LEFT JOIN (
      SELECT ${resolvedEntityId('track', userId)} as resolved_track_id, count(*) as play_count, sum(tr.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks tr ON tr.spotify_id = lh.track_id
      ${trackMrJoin}
      WHERE ${albumIdIn(albumIds, 'tr')} ${wr} ${uf}
      GROUP BY resolved_track_id
    ) s ON s.resolved_track_id = t.spotify_id
    WHERE ${albumIdIn(albumIds)}
      AND t.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'track' AND user_id = ${userId})
    ORDER BY ${sort === 'natural' ? sql`COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, t.name ASC` : sort === 'plays' ? sql`play_count DESC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC` : sql`total_ms DESC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC`}
  `) as { track_id: string; name: string; duration_ms: number; track_number: number | null; disc_number: number | null; play_count: number; total_ms: number }[];
}
