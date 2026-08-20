import { inArray } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { dbRead } from '../../db/read-pool.js';
import { tracks } from '../../db/schema.js';
import { insertLocalPlay } from '../../services/ingestion.js';
import { DEFAULT_PAGE_LIMIT, MANUAL_SCROBBLE_MAX } from '../../constants.js';
import { deleteHistoryEntries } from '../../db/queries/index.js';
import { getUserStreaksCached } from '../../services/social.js';
import { statsRouter, parseParams } from './_shared.js';

const insights = statsRouter();

insights.get('/listening-time', async (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  const granularity = c.req.query('granularity') || 'day';

  return c.json(await dbRead('getGlobalSeries', rangeStart, granularity, rangeEnd, userId));
});

insights.get('/history', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 100);
  const offset = (page - 1) * limit;
  const userId = c.get('userId');

  const rawTrackId = c.req.query('track');
  const rawAlbumId = c.req.query('album');
  const rawArtistId = c.req.query('artist');

  const [trackIds, albumIds, artistIds] = await Promise.all([
    rawTrackId ? dbRead('resolveEntityIds', 'track', rawTrackId, userId) : Promise.resolve(undefined),
    rawAlbumId ? dbRead('resolveEntityIds', 'album', rawAlbumId, userId) : Promise.resolve(undefined),
    rawArtistId ? dbRead('resolveEntityIds', 'artist', rawArtistId, userId) : Promise.resolve(undefined),
  ]);

  const tzRaw = c.req.query('tz');
  const tzOffsetMinutes = tzRaw != null ? Number.parseInt(tzRaw) : 0;
  const { items: rows, total } = await dbRead('getHistoryPage', userId, limit, offset, {
    date: c.req.query('date'),
    trackIds,
    albumIds,
    artistIds,
    tzOffsetMinutes: Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0,
  });

  const trackMap = await dbRead('enrichTracksBatch', rows.map(r => r.track_id));
  const items = rows.map((row) => ({
    id: row.id,
    playedAt: row.played_at,
    contextType: null,
    track: trackMap.get(row.track_id) ?? null,
  }));

  return c.json({ items, page, limit, total, hasMore: offset + limit < total });
});

insights.delete('/history', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const body = await c.req.json<{ ids: number[] }>();

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: 'ids array required' }, 400);
  }
  if (body.ids.length > 5000) {
    return c.json({ error: 'max 5000 entries per request' }, 400);
  }

  const deleted = deleteHistoryEntries(db, userId, body.ids);
  return c.json({ deleted });
});

// scrobbles manuales: inserta plays a mano (un track o un álbum entero). el cliente
// resuelve los timestamps (para un álbum los encadena por duración de cada track);
// aquí solo se valida, se rellena la duración por defecto y se inserta reusando
// insertLocalPlay (dedup de 30s del mismo track + UNIQUE(user, played_at))
insights.post('/history', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const body = await c.req.json<{ scrobbles: { trackId: string; playedAt: string; durationPlayedMs?: number }[] }>();

  if (!Array.isArray(body.scrobbles) || body.scrobbles.length === 0) {
    return c.json({ error: 'scrobbles array required' }, 400);
  }
  if (body.scrobbles.length > MANUAL_SCROBBLE_MAX) {
    return c.json({ error: `max ${MANUAL_SCROBBLE_MAX} scrobbles per request` }, 400);
  }

  // normalizar: validar trackId, parsear played_at a ISO UTC canónico
  const normalized: { trackId: string; playedAt: string; durationPlayedMs?: number }[] = [];
  for (const s of body.scrobbles) {
    if (!s || typeof s.trackId !== 'string' || !s.trackId) {
      return c.json({ error: 'each scrobble needs a trackId' }, 400);
    }
    const ts = new Date(s.playedAt);
    if (Number.isNaN(ts.getTime())) {
      return c.json({ error: `invalid playedAt: ${s.playedAt}` }, 400);
    }
    normalized.push({
      trackId: s.trackId,
      playedAt: ts.toISOString(),
      durationPlayedMs: typeof s.durationPlayedMs === 'number' && s.durationPlayedMs >= 0 ? Math.floor(s.durationPlayedMs) : undefined,
    });
  }

  // resolver duración real de cada track: sirve de default (scrobble = escucha
  // completa) y valida que el track existe antes de insertar (evita fallo de FK)
  const ids = [...new Set(normalized.map(s => s.trackId))];
  const rows = db.select({ spotifyId: tracks.spotifyId, durationMs: tracks.durationMs })
    .from(tracks)
    .where(inArray(tracks.spotifyId, ids))
    .all();
  const durById = new Map(rows.map(r => [r.spotifyId, r.durationMs]));

  const missing = ids.filter(id => !durById.has(id));
  if (missing.length > 0) {
    return c.json({ error: 'unknown track(s)', missing }, 400);
  }

  let inserted = 0;
  for (const s of normalized) {
    const trackDur = durById.get(s.trackId) ?? null;
    // duración explícita capada al largo real; sin ella, se usa el largo del track
    const dur = s.durationPlayedMs != null
      ? (trackDur ? Math.min(s.durationPlayedMs, trackDur) : s.durationPlayedMs)
      : trackDur ?? undefined;
    if (insertLocalPlay(s.trackId, s.playedAt, userId, dur)) inserted++;
  }

  return c.json({ inserted, total: normalized.length, duplicates: normalized.length - inserted });
});

insights.get('/discovery', async (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  const granularity = c.req.query('granularity') || 'month';
  const type = c.req.query('type') || 'track';

  return c.json(await dbRead('getDiscoverySeries', type, granularity, rangeStart, rangeEnd, userId));
});

insights.get('/heatmap', async (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  return c.json(await dbRead('getHeatmap', rangeStart, rangeEnd, userId));
});

insights.get('/monthly-distribution', async (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  return c.json(await dbRead('getMonthlyDistribution', rangeStart, rangeEnd, userId));
});

insights.get('/streaks', async (c) => {
  const userId = c.get('userId');
  // cálculo en getUserStreaks (queries/social.ts), servido desde la cache SWR de compare
  return c.json(await getUserStreaksCached(userId));
});

export default insights;
