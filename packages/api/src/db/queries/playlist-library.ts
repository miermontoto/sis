import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type { PlaylistPresenceItem } from '@sis/shared';

export interface LibraryPlaylistRow {
  id: number;
  spotify_id: string;
  name: string;
  image_url: string | null;
  owner_name: string | null;
  is_owned: number;
  is_algorithmic: number;
  track_count: number;
  last_synced_at: string | null;
  created_at: string;
}

/** Playlists del usuario (metadata ligera, sin stats pesados) */
export function getLibraryPlaylists(db: Db, userId: number, limit: number, offset: number): { items: LibraryPlaylistRow[]; total: number } {
  const items = db.all(sql`
    SELECT id, spotify_id, name, image_url, owner_name,
           is_owned, is_algorithmic, track_count,
           last_synced_at, created_at
    FROM spotify_playlists sp
    WHERE sp.user_id = ${userId}
      AND EXISTS (SELECT 1 FROM spotify_playlist_tracks spt WHERE spt.playlist_id = sp.id)
    ORDER BY sp.created_at ASC
    LIMIT ${limit} OFFSET ${offset}
  `) as LibraryPlaylistRow[];

  const totalRow = db.all(sql`
    SELECT COUNT(*) as count FROM spotify_playlists sp
    WHERE sp.user_id = ${userId}
      AND EXISTS (SELECT 1 FROM spotify_playlist_tracks spt WHERE spt.playlist_id = sp.id)
  `)[0] as { count: number };

  return { items, total: totalRow.count };
}

export interface PlaylistTrackStatRow {
  track_id: string;
  position: number;
  added_at: string | null;
  play_count: number;
  total_ms: number;
  last_played: string | null;
}

/** Stats por track de una playlist */
export function getPlaylistTrackStats(db: Db, playlistId: number, userId: number): PlaylistTrackStatRow[] {
  return db.all(sql`
    SELECT
      spt.track_id,
      spt.position,
      spt.added_at,
      COALESCE(stats.play_count, 0) as play_count,
      COALESCE(stats.total_ms, 0) as total_ms,
      stats.last_played
    FROM spotify_playlist_tracks spt
    LEFT JOIN (
      SELECT lh.track_id, COUNT(*) as play_count, SUM(t.duration_ms) as total_ms, MAX(lh.played_at) as last_played
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId}
      GROUP BY lh.track_id
    ) stats ON stats.track_id = spt.track_id
    WHERE spt.playlist_id = ${playlistId}
    ORDER BY play_count DESC, spt.position ASC
  `) as PlaylistTrackStatRow[];
}

export interface PlaylistGenreRow {
  genre: string;
  play_count: number;
}

/** Distribución de géneros de una playlist (basado en artistas de los tracks) */
export function getPlaylistGenres(db: Db, playlistId: number, limit = 20): PlaylistGenreRow[] {
  return db.all(sql`
    SELECT genre.value as genre, COUNT(*) as play_count
    FROM spotify_playlist_tracks spt
    JOIN track_artists ta ON ta.track_id = spt.track_id
    JOIN artists a ON a.spotify_id = ta.artist_id
    JOIN json_each(a.genres) genre
    WHERE spt.playlist_id = ${playlistId}
    GROUP BY genre.value
    ORDER BY play_count DESC
    LIMIT ${limit}
  `) as PlaylistGenreRow[];
}

export interface PlaylistSeriesRow {
  period: string;
  play_count: number;
  total_ms: number;
}

/** Serie temporal de escuchas para una playlist */
export function getPlaylistSeries(db: Db, playlistId: number, userId: number, granularity = 'month'): PlaylistSeriesRow[] {
  const dateTrunc = granularity === 'month'
    ? sql`strftime('%Y-%m', lh.played_at)`
    : granularity === 'week'
    ? sql`strftime('%Y-W%W', lh.played_at)`
    : sql`date(lh.played_at)`;

  return db.all(sql`
    SELECT ${dateTrunc} as period, COUNT(*) as play_count, SUM(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.user_id = ${userId}
      AND lh.track_id IN (SELECT track_id FROM spotify_playlist_tracks WHERE playlist_id = ${playlistId})
    GROUP BY period
    ORDER BY period ASC
  `) as PlaylistSeriesRow[];
}

/** En qué playlists aparece un track */
export function getTrackPlaylistPresence(db: Db, trackId: string, userId: number): PlaylistPresenceItem[] {
  return db.all(sql`
    SELECT sp.id, sp.spotify_id as spotifyId, sp.name, sp.image_url as imageUrl
    FROM spotify_playlist_tracks spt
    JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
    WHERE spt.track_id = ${trackId}
    ORDER BY sp.name ASC
  `) as PlaylistPresenceItem[];
}

/** En qué playlists aparece un artista (por tracks, position 0) */
export function getArtistPlaylistPresence(db: Db, artistId: string, userId: number): PlaylistPresenceItem[] {
  return db.all(sql`
    SELECT DISTINCT sp.id, sp.spotify_id as spotifyId, sp.name, sp.image_url as imageUrl
    FROM spotify_playlist_tracks spt
    JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
    JOIN track_artists ta ON ta.track_id = spt.track_id AND ta.artist_id = ${artistId}
    ORDER BY sp.name ASC
  `) as PlaylistPresenceItem[];
}

/** En qué playlists aparece un álbum (por tracks) */
export function getAlbumPlaylistPresence(db: Db, albumId: string, userId: number): PlaylistPresenceItem[] {
  return db.all(sql`
    SELECT DISTINCT sp.id, sp.spotify_id as spotifyId, sp.name, sp.image_url as imageUrl
    FROM spotify_playlist_tracks spt
    JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
    JOIN tracks t ON t.spotify_id = spt.track_id AND t.album_id = ${albumId}
    ORDER BY sp.name ASC
  `) as PlaylistPresenceItem[];
}
