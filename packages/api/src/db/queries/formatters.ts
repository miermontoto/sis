import { eq } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type { FormattedArtist, FormattedAlbum } from '@sis/shared';
import { artists, albums } from '../schema.js';
import { enrichTracksBatch } from './track.js';

// --- formatters para filas de top-* endpoints ---

/** Buscar y formatear un artista por spotifyId */
export function lookupArtist(db: Db, spotifyId: string): FormattedArtist | null {
  const artist = db.select().from(artists).where(eq(artists.spotifyId, spotifyId)).get();
  if (!artist) return null;
  return { name: artist.name, imageUrl: artist.imageUrl, genres: artist.genres as string[] };
}

/** Buscar y formatear un álbum por spotifyId */
export function lookupAlbum(db: Db, spotifyId: string): FormattedAlbum | null {
  const album = db.select().from(albums).where(eq(albums.spotifyId, spotifyId)).get();
  if (!album) return null;
  return { name: album.name, imageUrl: album.imageUrl, releaseDate: album.releaseDate, albumType: album.albumType };
}

/** Formatear múltiples filas de top-tracks en batch (2 queries en vez de N*5) */
export function formatTopTrackRows(db: Db, rows: { entity_id: string; play_count: number; total_ms: number }[]) {
  const trackMap = enrichTracksBatch(db, rows.map(r => r.entity_id));
  return rows.map(row => {
    const trackInfo = trackMap.get(row.entity_id);
    return {
      trackId: row.entity_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      track: trackInfo ? {
        name: trackInfo.name,
        durationMs: trackInfo.durationMs,
        album: trackInfo.album,
        artists: trackInfo.artists,
      } : null,
    };
  });
}

/** Formatear fila de top-artists */
export function formatTopArtistRow(db: Db, row: { entity_id: string; play_count: number; total_ms: number }) {
  return {
    artistId: row.entity_id,
    playCount: row.play_count,
    totalMs: row.total_ms,
    artist: lookupArtist(db, row.entity_id),
  };
}

/** Formatear fila de top-albums */
export function formatTopAlbumRow(db: Db, row: { entity_id: string; play_count: number; total_ms: number }) {
  return {
    albumId: row.entity_id,
    playCount: row.play_count,
    totalMs: row.total_ms,
    album: lookupAlbum(db, row.entity_id),
  };
}

/** Formatear múltiples recent plays en batch */
export function formatRecentPlays(db: Db, rows: { id: number; played_at: string; track_id: string }[]) {
  const trackMap = enrichTracksBatch(db, rows.map(r => r.track_id));
  return rows.map(row => ({
    id: row.id,
    playedAt: row.played_at,
    track: trackMap.get(row.track_id) ?? null,
  }));
}

/** Formatear múltiples artist top-tracks en batch */
export function formatArtistTrackRows(db: Db, rows: { track_id: string; play_count: number; total_ms: number }[]) {
  const trackMap = enrichTracksBatch(db, rows.map(r => r.track_id));
  return rows.map(row => {
    const trackInfo = trackMap.get(row.track_id);
    return {
      trackId: row.track_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      track: trackInfo ? {
        name: trackInfo.name,
        durationMs: trackInfo.durationMs,
        album: trackInfo.album,
        artists: trackInfo.artists,
      } : null,
    };
  });
}

/** Formatear fila de artist top-albums */
export function formatArtistAlbumRow(db: Db, row: { album_id: string; play_count: number; total_ms: number }) {
  return {
    albumId: row.album_id,
    playCount: row.play_count,
    totalMs: row.total_ms,
    album: lookupAlbum(db, row.album_id),
  };
}
