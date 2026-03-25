import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { pollingState, tracks, artists, trackArtists, albums } from '../db/schema.js';
import { spotifyFetch } from '../services/spotify-client.js';

const nowPlaying = new Hono();

// retorna el track actual desde polling_state (sin llamada a spotify)
nowPlaying.get('/', (c) => {
  const db = getDb();
  const state = db.select().from(pollingState).where(eq(pollingState.id, 1)).get();

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
  const isPlayingRow = db.all(sql`SELECT is_playing FROM polling_state WHERE id = 1`)[0] as { is_playing: number } | undefined;

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
  const data = await spotifyFetch<any>('/me/player/currently-playing');

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
  await spotifyFetch('/me/player/play', { method: 'PUT' });
  // actualizar estado local
  const db = getDb();
  db.run(sql`UPDATE polling_state SET is_playing = 1 WHERE id = 1`);
  return c.json({ success: true });
});

nowPlaying.put('/pause', async (c) => {
  await spotifyFetch('/me/player/pause', { method: 'PUT' });
  const db = getDb();
  db.run(sql`UPDATE polling_state SET is_playing = 0 WHERE id = 1`);
  return c.json({ success: true });
});

nowPlaying.post('/next', async (c) => {
  await spotifyFetch('/me/player/next', { method: 'POST' });
  return c.json({ success: true });
});

nowPlaying.post('/previous', async (c) => {
  await spotifyFetch('/me/player/previous', { method: 'POST' });
  return c.json({ success: true });
});

export default nowPlaying;
