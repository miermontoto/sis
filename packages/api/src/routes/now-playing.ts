import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { pollingState, tracks, artists, trackArtists, albums } from '../db/schema.js';

const nowPlaying = new Hono();

// retorna el track actual desde polling_state (sin llamada a spotify)
nowPlaying.get('/', (c) => {
  const db = getDb();
  const state = db.select().from(pollingState).where(eq(pollingState.id, 1)).get();

  if (!state?.lastCurrentlyPlayingTrackId) {
    return c.json({ playing: false });
  }

  // verificar que no es data obsoleta (>2 min sin actualización)
  const staleThresholdMs = 2 * 60_000;
  if (state.lastCurrentlyPlayingAt) {
    const lastUpdate = new Date(state.lastCurrentlyPlayingAt).getTime();
    if (Date.now() - lastUpdate > staleThresholdMs) {
      return c.json({ playing: false });
    }
  }

  const track = db.select().from(tracks).where(eq(tracks.spotifyId, state.lastCurrentlyPlayingTrackId)).get();
  if (!track) return c.json({ playing: false });

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

  return c.json({
    playing: true,
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

export default nowPlaying;
