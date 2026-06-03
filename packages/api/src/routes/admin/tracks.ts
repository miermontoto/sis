import { eq } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { tracks } from '../../db/schema.js';
import { spotifyFetch } from '../../services/spotify-client.js';
import { adminRouter } from './_shared.js';

const tracksRoute = adminRouter();

tracksRoute.patch('/track/:id', async (c) => {
  const trackId = decodeURIComponent(c.req.param('id'));
  const { durationMs } = await c.req.json<{ durationMs: number }>();

  if (typeof durationMs !== 'number' || durationMs < 0) {
    return c.json({ error: 'durationMs debe ser un número >= 0' }, 400);
  }

  const db = getDb();
  const existing = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
  if (!existing) return c.json({ error: 'track no encontrado' }, 404);

  db.update(tracks).set({ durationMs }).where(eq(tracks.spotifyId, trackId)).run();
  return c.json({ success: true, durationMs });
});

tracksRoute.post('/track/:id/refresh-duration', async (c) => {
  const trackId = decodeURIComponent(c.req.param('id'));
  const userId = c.get('userId');

  const db = getDb();
  const existing = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
  if (!existing) return c.json({ error: 'track no encontrado' }, 404);

  const data = await spotifyFetch<{ duration_ms: number }>(`/tracks/${trackId}`, { userId });
  if (!data) return c.json({ error: 'no se pudo obtener datos de Spotify' }, 502);

  const newMs = data.duration_ms;
  const changed = existing.durationMs !== newMs;
  if (changed) {
    db.update(tracks).set({ durationMs: newMs }).where(eq(tracks.spotifyId, trackId)).run();
  }
  return c.json({ success: true, durationMs: newMs, changed });
});

export default tracksRoute;
