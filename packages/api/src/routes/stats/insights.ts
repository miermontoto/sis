import { getDb } from '../../db/connection.js';
import { dbRead } from '../../db/read-pool.js';
import { DEFAULT_PAGE_LIMIT } from '../../constants.js';
import { deleteHistoryEntries } from '../../db/queries/index.js';
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
    rawTrackId ? dbRead<string[]>('resolveEntityIds', 'track', rawTrackId, userId) : Promise.resolve(undefined),
    rawAlbumId ? dbRead<string[]>('resolveEntityIds', 'album', rawAlbumId, userId) : Promise.resolve(undefined),
    rawArtistId ? dbRead<string[]>('resolveEntityIds', 'artist', rawArtistId, userId) : Promise.resolve(undefined),
  ]);

  const tzRaw = c.req.query('tz');
  const tzOffsetMinutes = tzRaw != null ? Number.parseInt(tzRaw) : 0;
  const { items: rows, total } = await dbRead<{ items: { id: number; played_at: string; track_id: string }[]; total: number }>('getHistoryPage', userId, limit, offset, {
    date: c.req.query('date'),
    trackIds,
    albumIds,
    artistIds,
    tzOffsetMinutes: Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0,
  });

  const trackMap = await dbRead<Map<string, any>>('enrichTracksBatch', rows.map(r => r.track_id));
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
  // cálculo movido a getUserStreaks (queries/social.ts) para reusarlo en compare
  return c.json(await dbRead('getUserStreaks', userId));
});

export default insights;
