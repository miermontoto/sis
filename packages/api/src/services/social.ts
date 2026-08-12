import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { dbRead } from '../db/read-pool.js';
import { getRangeStart } from '../db/queries/index.js';
import { SOCIAL_NOW_PLAYING_STALE_MS, PROFILE_TOP_LIMIT, TIME_RANGES } from '../constants.js';
import type { TimeRange } from '../constants.js';
import type { SocialNowPlaying, ProfileResponse } from '@sis/shared';
import type { User } from './user-manager.js';

// OJO: user_settings.user_id almacena el SPOTIFY ID (string), no users.id.
// Toda comparación de visibilidad debe hacerse contra users.spotify_id.

// subquery reutilizable: spotify_ids de usuarios con visibilidad social oculta
export function hiddenSpotifyIdsSubquery(): SQL {
  return sql`SELECT us.user_id FROM user_settings us WHERE us.key = 'socialVisibility' AND us.value = 'hidden'`;
}

// ¿tiene este usuario la visibilidad social oculta?
export function isUserHidden(spotifyId: string): boolean {
  const db = getDb();
  const row = db.get(sql`
    SELECT 1 FROM user_settings
    WHERE user_id = ${spotifyId} AND key = 'socialVisibility' AND value = 'hidden'
  `);
  return !!row;
}

// now-playing reducido de un usuario para superficies sociales (perfil, feed).
// Lee polling_state con umbral de staleness; null si no hay nada sonando.
export function getSocialNowPlaying(userId: number): SocialNowPlaying | null {
  const db = getDb();
  const staleThreshold = new Date(Date.now() - SOCIAL_NOW_PLAYING_STALE_MS).toISOString();

  const row = db.get(sql`
    SELECT
      t.name AS trackName,
      a.image_url AS albumImageUrl,
      (SELECT GROUP_CONCAT(a2.name, ', ')
       FROM track_artists ta2
       JOIN artists a2 ON a2.spotify_id = ta2.artist_id
       WHERE ta2.track_id = t.spotify_id
       ORDER BY ta2.position) AS artistNames
    FROM polling_state ps
    JOIN tracks t ON t.spotify_id = ps.last_currently_playing_track_id
    LEFT JOIN albums a ON a.spotify_id = t.album_id
    WHERE ps.user_id = ${userId}
      AND ps.is_playing = 1
      AND ps.last_currently_playing_at > ${staleThreshold}
  `) as { trackName: string; albumImageUrl: string | null; artistNames: string | null } | undefined;

  if (!row?.trackName) return null;
  return {
    name: row.trackName,
    artists: row.artistNames || '',
    albumImageUrl: row.albumImageUrl,
  };
}

// valida un range recibido por query param; fallback a 'month'
export function parseTimeRange(raw: string | undefined | null, fallback: TimeRange = 'month'): TimeRange {
  return raw && raw in TIME_RANGES ? (raw as TimeRange) : fallback;
}

// base pública para construir URLs absolutas (origen del redirect URI de spotify)
export function publicBase(): string {
  const redirect = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/auth/callback';
  return new URL(redirect).origin;
}

// campos de rank-change estáticos: los perfiles no calculan periodo anterior
const NO_RANK_CHANGE = { rankChange: null, previousRank: null, isNew: false };

/** Construye la vista de perfil de un usuario (resumen + tops + now playing).
 *  Compartido entre el endpoint autenticado y los share links públicos.
 *  El resumen es SIEMPRE all-time; el range sólo afecta a los tops. */
export async function buildProfile(target: User, range: TimeRange): Promise<ProfileResponse> {
  const rangeStart = getRangeStart(range);

  const [summary, artistRows, trackRows, albumRows] = await Promise.all([
    dbRead('getProfileSummary', target.id, null, null),
    dbRead('getTopEntities', 'artist', rangeStart, 'time', PROFILE_TOP_LIMIT, null, target.id),
    dbRead('getTopEntities', 'track', rangeStart, 'time', PROFILE_TOP_LIMIT, null, target.id),
    dbRead('getTopEntities', 'album', rangeStart, 'time', PROFILE_TOP_LIMIT, null, target.id),
  ]);

  const [topArtists, topTracks, topAlbums] = await Promise.all([
    Promise.all(artistRows.map(row => dbRead('formatTopArtistRow', row))),
    dbRead('formatTopTrackRows', trackRows),
    Promise.all(albumRows.map(row => dbRead('formatTopAlbumRow', row))),
  ]);

  return {
    summary: {
      spotifyId: target.spotifyId,
      displayName: target.displayName,
      imageUrl: target.imageUrl,
      totalPlays: summary.play_count,
      totalMs: summary.total_ms,
      distinctArtists: summary.distinct_artists,
      distinctTracks: summary.distinct_tracks,
      distinctAlbums: summary.distinct_albums,
      firstPlayedAt: summary.first_played,
    },
    range,
    topArtists: topArtists.map(a => ({ ...a, ...NO_RANK_CHANGE })),
    topTracks: topTracks.map(t => ({ ...t, ...NO_RANK_CHANGE })),
    topAlbums: topAlbums.map(a => ({ ...a, ...NO_RANK_CHANGE })),
    nowPlaying: getSocialNowPlaying(target.id),
  };
}
