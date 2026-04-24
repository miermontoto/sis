import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { pollingState, tracks, artists, trackArtists, albums } from '../db/schema.js';
import { spotifyFetch, spotifyFetchRaw } from '../services/spotify-client.js';
import type { AppVariables } from '../app.js';
import type { SpotifyDevice, PlayContextRequest } from '@sis/shared';

const nowPlaying = new Hono<{ Variables: AppVariables }>();

// retorna el track actual desde polling_state (sin llamada a spotify)
nowPlaying.get('/', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const state = userId
    ? db.select().from(pollingState).where(eq(pollingState.userId, userId)).get()
    : null;

  if (!state?.lastCurrentlyPlayingTrackId) {
    return c.json({ playing: false, isPlaying: false });
  }

  // verificar que no es data obsoleta (>2 min sin actualización)
  const staleThresholdMs = 2 * 60_000;
  if (state.lastCurrentlyPlayingAt) {
    const lastUpdate = new Date(state.lastCurrentlyPlayingAt).getTime();
    if (Date.now() - lastUpdate > staleThresholdMs) {
      return c.json({ playing: false, isPlaying: false });
    }
  }

  const track = db.select().from(tracks).where(eq(tracks.spotifyId, state.lastCurrentlyPlayingTrackId)).get();
  if (!track) return c.json({ playing: false, isPlaying: false });

  const album = track.albumId
    ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
    : null;

  const trackArtistRows = db
    .select({ artistId: trackArtists.artistId, position: trackArtists.position })
    .from(trackArtists)
    .where(eq(trackArtists.trackId, track.spotifyId))
    .all();

  const artistList = trackArtistRows
    .sort((a, b) => a.position - b.position)
    .map(ta => db.select().from(artists).where(eq(artists.spotifyId, ta.artistId)).get())
    .filter(Boolean);

  // is_playing es columna manual, leer con raw SQL
  const isPlayingRow = db.all(sql`SELECT is_playing FROM polling_state WHERE user_id = ${userId}`)[0] as { is_playing: number } | undefined;

  return c.json({
    playing: true,
    isPlaying: !!(isPlayingRow?.is_playing),
    track: {
      id: track.spotifyId,
      name: track.name,
      durationMs: track.durationMs,
      album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl } : null,
      artists: artistList.map(a => ({ id: a!.spotifyId, name: a!.name })),
    },
    updatedAt: state.lastCurrentlyPlayingAt,
  });
});

// lectura en vivo desde Spotify (no cache) — usado tras acciones de playback
nowPlaying.get('/live', async (c) => {
  const userId = c.get('userId');
  const data = await spotifyFetch<any>('/me/player/currently-playing', { userId });

  if (!data?.item || data.currently_playing_type !== 'track') {
    return c.json({ playing: false, isPlaying: false });
  }

  const item = data.item;
  return c.json({
    playing: true,
    isPlaying: !!data.is_playing,
    track: {
      id: item.id,
      name: item.name,
      durationMs: item.duration_ms,
      album: item.album ? {
        id: item.album.id,
        name: item.album.name,
        imageUrl: item.album.images?.[0]?.url ?? null,
      } : null,
      artists: (item.artists ?? []).map((a: any) => ({ id: a.id, name: a.name })),
    },
    updatedAt: new Date().toISOString(),
  });
});

// --- controles de reproducción ---

nowPlaying.put('/play', async (c) => {
  const userId = c.get('userId');
  await spotifyFetch('/me/player/play', { userId, method: 'PUT' });
  const db = getDb();
  db.run(sql`UPDATE polling_state SET is_playing = 1 WHERE user_id = ${userId}`);
  return c.json({ success: true });
});

nowPlaying.put('/pause', async (c) => {
  const userId = c.get('userId');
  await spotifyFetch('/me/player/pause', { userId, method: 'PUT' });
  const db = getDb();
  db.run(sql`UPDATE polling_state SET is_playing = 0 WHERE user_id = ${userId}`);
  return c.json({ success: true });
});

nowPlaying.post('/next', async (c) => {
  const userId = c.get('userId');
  await spotifyFetch('/me/player/next', { userId, method: 'POST' });
  return c.json({ success: true });
});

nowPlaying.post('/previous', async (c) => {
  const userId = c.get('userId');
  await spotifyFetch('/me/player/previous', { userId, method: 'POST' });
  return c.json({ success: true });
});

// --- reproducir contenido específico (track/album/artist) ---

nowPlaying.put('/play-context', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<PlayContextRequest>();

  const spotifyBody: Record<string, unknown> = {};
  if (body.context_uri) spotifyBody.context_uri = body.context_uri;
  if (body.uris) spotifyBody.uris = body.uris;

  const endpoint = body.device_id
    ? `/me/player/play?device_id=${body.device_id}`
    : '/me/player/play';

  const res = await spotifyFetchRaw(endpoint, {
    userId,
    method: 'PUT',
    body: Object.keys(spotifyBody).length > 0 ? spotifyBody : undefined,
  });

  if (!res) return c.json({ success: false, error: 'rate_limited' });

  if (res.status === 404) {
    const text = await res.text();
    if (text.includes('NO_ACTIVE_DEVICE')) {
      return c.json({ success: false, error: 'no_active_device' });
    }
    return c.json({ success: false, error: 'not_found' });
  }

  if (res.status === 204 || res.ok) {
    const db = getDb();
    db.run(sql`UPDATE polling_state SET is_playing = 1 WHERE user_id = ${userId}`);
    return c.json({ success: true });
  }

  return c.json({ success: false, error: 'spotify_error' });
});

// --- dispositivos Spotify Connect ---

nowPlaying.get('/devices', async (c) => {
  const userId = c.get('userId');
  const data = await spotifyFetch<{ devices: SpotifyDevice[] }>('/me/player/devices', { userId });
  return c.json({ devices: data?.devices ?? [] });
});

nowPlaying.put('/device', async (c) => {
  const userId = c.get('userId');
  const { device_id, play } = await c.req.json<{ device_id: string; play?: boolean }>();
  await spotifyFetch('/me/player', {
    userId,
    method: 'PUT',
    body: { device_ids: [device_id], play: play ?? true },
  });
  return c.json({ success: true });
});

export default nowPlaying;
