import { sql, eq, inArray } from 'drizzle-orm';
import type { Db } from './helpers.js';
import { rangeWhere, userFilter } from './helpers.js';
import { tracks, albums, artists, trackArtists } from '../schema.js';

export interface EnrichedTrack {
  id: string;
  name: string;
  durationMs: number;
  album: { id: string; name: string; imageUrl: string | null } | null;
  artists: { id: string; name: string }[];
}

/** Enriquecer track con metadata completa (álbum + artistas) — versión single (legacy) */
export function enrichTrack(db: Db, trackId: string): EnrichedTrack | null {
  const batch = enrichTracksBatch(db, [trackId]);
  return batch.get(trackId) ?? null;
}

/** Enriquecer múltiples tracks en batch — 2 queries en vez de N*5 */
export function enrichTracksBatch(db: Db, trackIds: string[]): Map<string, EnrichedTrack> {
  const result = new Map<string, EnrichedTrack>();
  if (trackIds.length === 0) return result;

  const uniqueIds = [...new Set(trackIds)];

  // 1. Tracks + álbumes en una sola query
  const trackRows = db.all(sql`
    SELECT t.spotify_id, t.name, t.duration_ms, t.album_id,
           al.spotify_id as al_id, al.name as al_name, al.image_url as al_image
    FROM tracks t
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    WHERE t.spotify_id IN (${sql.join(uniqueIds.map(id => sql`${id}`), sql`, `)})
  `) as { spotify_id: string; name: string; duration_ms: number; album_id: string | null; al_id: string | null; al_name: string | null; al_image: string | null }[];

  // 2. Artistas de todos los tracks en una sola query
  const artistRows = db.all(sql`
    SELECT ta.track_id, ta.position, a.spotify_id as artist_id, a.name as artist_name
    FROM track_artists ta
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE ta.track_id IN (${sql.join(uniqueIds.map(id => sql`${id}`), sql`, `)})
    ORDER BY ta.track_id, ta.position
  `) as { track_id: string; position: number; artist_id: string; artist_name: string }[];

  // agrupar artistas por track
  const artistsByTrack = new Map<string, { id: string; name: string }[]>();
  for (const row of artistRows) {
    if (!artistsByTrack.has(row.track_id)) artistsByTrack.set(row.track_id, []);
    artistsByTrack.get(row.track_id)!.push({ id: row.artist_id, name: row.artist_name });
  }

  for (const row of trackRows) {
    result.set(row.spotify_id, {
      id: row.spotify_id,
      name: row.name,
      durationMs: row.duration_ms,
      album: row.al_id ? { id: row.al_id, name: row.al_name!, imageUrl: row.al_image } : null,
      artists: artistsByTrack.get(row.spotify_id) ?? [],
    });
  }

  return result;
}

/** Desglose por álbum (en qué álbumes se escuchó un track). Usa IDs pre-resueltos para incluir merges. */
export function getTrackAlbumBreakdown(db: Db, trackId: string, rangeStart: string | null, rangeEnd: string | null | undefined, userId: number, trackIds?: string[]) {
  const wr = rangeWhere(rangeStart, rangeEnd);
  const uf = userFilter(userId);
  const ids = trackIds ?? [trackId];
  const trackFilter = ids.length === 1
    ? sql`lh.track_id = ${ids[0]}`
    : sql`lh.track_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`;

  return db.all(sql`
    SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${trackFilter} ${wr} ${uf}
      AND t.album_id IS NOT NULL
    GROUP BY t.album_id
    ORDER BY play_count DESC
  `) as { album_id: string; play_count: number; total_ms: number }[];
}
