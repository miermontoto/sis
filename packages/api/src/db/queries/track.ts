import { sql, eq, inArray } from 'drizzle-orm';
import type { Db } from './helpers.js';
import { rangeWhere, userFilter, playDuration } from './helpers.js';
import { tracks, albums, artists, trackArtists } from '../schema.js';
import { deriveVersion } from '../../services/versions.js';
import type { TrackVersion } from '@sis/shared';

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
    SELECT t.album_id, count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${trackFilter} ${wr} ${uf}
      AND t.album_id IS NOT NULL
    GROUP BY t.album_id
    ORDER BY play_count DESC
  `) as { album_id: string; play_count: number; total_ms: number }[];
}

/** Otras versiones del mismo tema (live, remix, remaster...) que el usuario ha escuchado.
 *  Agrupa por artista principal (position=0, misma clave que dedup) + título base normalizado.
 *  Devuelve todas las versiones del cluster (incluida la actual, marcada isCurrent) ordenadas por
 *  plays; vacío si no hay ninguna otra versión. Siempre all-time (la página de track es all-time). */
export function getTrackVersions(db: Db, trackId: string, userId: number): TrackVersion[] {
  // artista principal + nombre/álbum del track actual
  const current = db.get(sql`
    SELECT (SELECT MIN(artist_id) FROM track_artists WHERE track_id = t.spotify_id AND position = 0) as artist_id,
           t.name as name, t.duration_ms as duration_ms,
           al.spotify_id as album_id, al.name as album_name, al.image_url as album_image
    FROM tracks t
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    WHERE t.spotify_id = ${trackId}
  `) as { artist_id: string | null; name: string; duration_ms: number; album_id: string | null; album_name: string | null; album_image: string | null } | undefined;
  if (!current || !current.artist_id) return [];

  const currentBase = deriveVersion(current.name).base;

  // todos los tracks reproducidos por el usuario cuyo artista principal coincide, con sus stats
  const rows = db.all(sql`
    SELECT t.spotify_id, t.name, t.duration_ms,
           al.spotify_id as album_id, al.name as album_name, al.image_url as album_image,
           count(*) as play_count, sum(${playDuration()}) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    WHERE lh.user_id = ${userId}
      AND t.spotify_id IN (
        SELECT track_id FROM track_artists WHERE artist_id = ${current.artist_id} AND position = 0
      )
    GROUP BY t.spotify_id
  `) as { spotify_id: string; name: string; duration_ms: number; album_id: string | null; album_name: string | null; album_image: string | null; play_count: number; total_ms: number | null }[];

  const toVersion = (r: typeof rows[number]): TrackVersion => {
    const v = deriveVersion(r.name);
    return {
      trackId: r.spotify_id,
      name: r.name,
      qualifier: v.qualifier,
      tag: v.tag,
      playCount: r.play_count,
      totalMs: r.total_ms ?? 0,
      durationMs: r.duration_ms,
      album: r.album_id ? { id: r.album_id, name: r.album_name ?? '', imageUrl: r.album_image } : null,
      isCurrent: r.spotify_id === trackId,
    };
  };

  const members = rows.filter(r => deriveVersion(r.name).base === currentBase).map(toVersion);

  // si el track actual no tiene plays del usuario no aparece en rows: añadirlo con stats a 0
  if (!members.some(m => m.isCurrent)) {
    const v = deriveVersion(current.name);
    members.push({
      trackId, name: current.name, qualifier: v.qualifier, tag: v.tag,
      playCount: 0, totalMs: 0, durationMs: current.duration_ms,
      album: current.album_id ? { id: current.album_id, name: current.album_name ?? '', imageUrl: current.album_image } : null,
      isCurrent: true,
    });
  }

  // solo tiene sentido mostrar la sección si existe al menos otra versión
  if (members.filter(m => !m.isCurrent).length === 0) return [];

  members.sort((a, b) => b.playCount - a.playCount || b.totalMs - a.totalMs);
  return members;
}
