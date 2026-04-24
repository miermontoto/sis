import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { dbRead } from '../db/read-pool.js';
import { DEFAULT_PAGE_LIMIT, CHART_SIZE, RECORDS_LIMIT } from '../constants.js';
import { getCachedRecords, getEntityAccolades } from '../services/records-cache.js';
import type { TimeRange } from '../constants.js';
import { getRangeStart, getPreviousPeriodRange, getPreviousPeriodRangeCustom, deleteHistoryEntries } from '../db/queries/index.js';
import type { AppVariables } from '../app.js';

const stats = new Hono<{ Variables: AppVariables }>();

// helpers: parseo de query params comunes
import type { WeekStartOption, RankingMetric, Granularity, EntityType } from '@sis/shared';
type WeekStart = WeekStartOption;
type Sort = RankingMetric;

/** Convertir param plural ('tracks') a EntityType singular ('track') */
function toEntityType(plural: string): EntityType {
  if (plural === 'tracks') return 'track';
  if (plural === 'albums') return 'album';
  return 'artist';
}

function parseWeekStart(c: any): WeekStart {
  const ws = c.req.query('weekStart');
  return ws === 'sunday' ? 'sunday' : ws === 'friday' ? 'friday' : 'monday';
}

function parseSort(c: any): Sort {
  return c.req.query('sort') === 'plays' ? 'plays' : 'time';
}

function periodMatchesGranularity(period: string, granularity: 'week' | 'month' | 'year'): boolean {
  if (granularity === 'year') return /^\d{4}$/.test(period);
  if (granularity === 'month') return /^\d{4}-\d{2}$/.test(period);
  return /^\d{4}-W\d{2}$/.test(period);
}


function parseParams(c: any) {
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 200);
  const sort = (c.req.query('sort') === 'plays' ? 'plays' : 'time') as Sort;

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  if (startDate && endDate) {
    const rangeStart = startDate + 'T00:00:00.000Z';
    const rangeEnd = endDate + 'T23:59:59.999Z';
    const customDays = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    return { range: 'custom' as const, limit, rangeStart, rangeEnd, sort, customDays };
  }

  const range = (c.req.query('range') || 'month') as TimeRange;
  const rangeStart = getRangeStart(range);
  return { range, limit, rangeStart, rangeEnd: null as string | null, sort, customDays: undefined as number | undefined };
}

// helper: calcular rank changes entre periodo actual y anterior
function buildRankChangeMap(prevRows: { entity_id: string }[]) {
  const map = new Map<string, number>();
  prevRows.forEach((r, i) => map.set(r.entity_id, i + 1));
  return map;
}

function rankChangeFields(prev: ReturnType<typeof getPreviousPeriodRange>, prevRankMap: Map<string, number>, entityId: string, currentRank: number) {
  const previousRank = prevRankMap.get(entityId) ?? null;
  return {
    rankChange: prev === null ? null : previousRank === null ? null : previousRank - currentRank,
    previousRank,
    isNew: prev !== null && previousRank === null,
  };
}

// helper genérico: top-* endpoint con rank changes
async function handleTopEntities(c: any, entityType: EntityType, formatFn: string, batchFormatFn?: string) {
  const { range, limit, rangeStart, rangeEnd, sort } = parseParams(c);
  const userId = c.get('userId');

  const rows = await dbRead<{ entity_id: string; play_count: number; total_ms: number }[]>('getTopEntities', entityType, rangeStart, sort, limit, rangeEnd, userId);

  const prev = range === 'custom' && rangeStart && rangeEnd
    ? getPreviousPeriodRangeCustom(rangeStart, rangeEnd)
    : range !== 'custom' ? getPreviousPeriodRange(range as TimeRange) : null;
  const prevRankMap = prev
    ? buildRankChangeMap(await dbRead<{ entity_id: string }[]>('getPrevPeriodEntities', entityType, prev.prevStart, prev.prevEnd, sort, userId))
    : new Map<string, number>();

  // usar batch formatter si disponible (evita N+1 queries)
  const formatted = batchFormatFn
    ? await dbRead<any[]>(batchFormatFn, rows)
    : await Promise.all(rows.map(row => dbRead<any>(formatFn, row)));

  return c.json(formatted.map((f: any, i: number) => ({
    ...f,
    ...rankChangeFields(prev, prevRankMap, rows[i].entity_id, i + 1),
  })));
}

// --- top endpoints ---

stats.get('/top-tracks', (c) => handleTopEntities(c, 'track', 'formatTopTrackRow', 'formatTopTrackRows'));
stats.get('/top-artists', (c) => handleTopEntities(c, 'artist', 'formatTopArtistRow'));
stats.get('/top-albums', (c) => handleTopEntities(c, 'album', 'formatTopAlbumRow'));

// --- specialized endpoints (no se extraen a queries) ---

stats.get('/top-genres', async (c) => {
  const { limit, rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  return c.json(await dbRead('getTopGenres', rangeStart, rangeEnd, limit, userId));
});

stats.get('/listening-time', async (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  const granularity = c.req.query('granularity') || 'day';

  return c.json(await dbRead('getGlobalSeries', rangeStart, granularity, rangeEnd, userId));
});

stats.get('/history', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 100);
  const offset = (page - 1) * limit;
  const userId = c.get('userId');

  const tzRaw = c.req.query('tz');
  const tzOffsetMinutes = tzRaw != null ? Number.parseInt(tzRaw) : 0;
  const { items: rows, total } = await dbRead<{ items: { id: number; played_at: string; track_id: string }[]; total: number }>('getHistoryPage', userId, limit, offset, {
    date: c.req.query('date'),
    albumId: c.req.query('album'),
    trackId: c.req.query('track'),
    artistId: c.req.query('artist'),
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

stats.delete('/history', async (c) => {
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

stats.get('/discovery', async (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  const granularity = c.req.query('granularity') || 'month';
  const type = c.req.query('type') || 'track';

  return c.json(await dbRead('getDiscoverySeries', type, granularity, rangeStart, rangeEnd, userId));
});

stats.get('/heatmap', async (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  return c.json(await dbRead('getHeatmap', rangeStart, rangeEnd, userId));
});

stats.get('/streaks', async (c) => {
  const userId = c.get('userId');

  const days = await dbRead<{ day: string }[]>('getStreakDays', userId);

  if (days.length === 0) {
    return c.json({ currentStreak: 0, longestStreak: 0, totalDays: 0 });
  }

  let longestStreak = 1;
  let tempStreak = 1;

  const today = new Date().toISOString().split('T')[0];
  const lastDay = days[days.length - 1].day;

  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1].day);
    const curr = new Date(days[i].day);
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) tempStreak++;
    else tempStreak = 1;
    longestStreak = Math.max(longestStreak, tempStreak);
  }

  let currentStreak = 0;
  if (lastDay === today || lastDay === new Date(Date.now() - 86400000).toISOString().split('T')[0]) {
    currentStreak = 1;
    for (let i = days.length - 2; i >= 0; i--) {
      const prev = new Date(days[i].day);
      const curr = new Date(days[i + 1].day);
      if ((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24) === 1) currentStreak++;
      else break;
    }
  }

  return c.json({ currentStreak, longestStreak, totalDays: days.length });
});

// --- detail endpoints ---

// Formatea MergeInfo del worker al shape que consumen las páginas detail.
function formatMerge(info: { mergedFrom: any[]; mergedInto: any | null }) {
  return {
    mergedFrom: info.mergedFrom.map((r: any) => ({ id: r.source_id, ruleId: r.rule_id, name: r.name, imageUrl: r.image_url })),
    mergedInto: info.mergedInto
      ? { id: info.mergedInto.target_id, ruleId: info.mergedInto.rule_id, name: info.mergedInto.name, imageUrl: info.mergedInto.image_url }
      : null,
  };
}

stats.get('/artist/:id', async (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const userId = c.get('userId');
  const trackLimit = Math.min(parseInt(c.req.query('trackLimit') || '10'), 200);
  const albumLimit = Math.min(parseInt(c.req.query('albumLimit') || '5'), 200);

  const artist = await dbRead<any>('lookupArtistById', id);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const artistIds = await dbRead<string[]>('resolveEntityIds', 'artist', id, userId);

  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;
  const [statsRow, series, topTracksRaw, topAlbumsRaw, recentRaw, playlists, mergeInfo] = await Promise.all([
    dbRead<any>('getEntityStats', 'artist', id, rangeStart, rangeEnd, artistIds, userId),
    dbRead<any>('getEntitySeries', 'artist', id, rangeStart, rangeKey, artistIds, rangeEnd, customDays, userId),
    dbRead<any[]>('getArtistTopTracks', id, rangeStart, sort, trackLimit, rangeEnd, userId, artistIds),
    dbRead<any[]>('getArtistTopAlbums', id, rangeStart, sort, albumLimit, rangeEnd, userId, artistIds),
    dbRead<any[]>('getRecentPlays', 'artist', id, 10, artistIds, userId),
    dbRead<any>('getArtistPlaylistPresence', id, userId),
    dbRead<any>('getEntityMergeInfo', 'artist', id),
  ]);

  const [topTracks, topAlbums, recentPlays] = await Promise.all([
    dbRead<any[]>('formatArtistTrackRows', topTracksRaw),
    Promise.all(topAlbumsRaw.map((row: any) => dbRead<any>('formatArtistAlbumRow', row))),
    dbRead<any[]>('formatRecentPlays', recentRaw),
  ]);

  return c.json({
    artist: { id: artist.spotify_id, name: artist.name, imageUrl: artist.image_url, genres: artist.genres },
    stats: statsRow,
    series,
    topTracks,
    topAlbums,
    recentPlays,
    ...formatMerge(mergeInfo),
    playlists,
  });
});

stats.get('/album/:id', async (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const userId = c.get('userId');

  const album = await dbRead<any>('lookupAlbumById', id);
  if (!album) return c.json({ error: 'Album not found' }, 404);

  const albumIds = await dbRead<string[]>('resolveEntityIds', 'album', id, userId);

  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;
  const [albumArtistRows, statsRow, series, albumTracks, recentRaw, playlists, mergeInfo, coversRaw] = await Promise.all([
    dbRead<any[]>('getAlbumArtists', id, albumIds),
    dbRead<any>('getEntityStats', 'album', id, rangeStart, rangeEnd, albumIds, userId),
    dbRead<any>('getEntitySeries', 'album', id, rangeStart, rangeKey, albumIds, rangeEnd, customDays, userId),
    dbRead<any[]>('getAlbumTracks', id, rangeStart, sort, albumIds, rangeEnd, userId),
    dbRead<any[]>('getRecentPlays', 'album', id, 10, albumIds, userId),
    dbRead<any>('getAlbumPlaylistPresence', id, userId),
    dbRead<any>('getEntityMergeInfo', 'album', id),
    dbRead<any[]>('getAlbumCovers', id),
  ]);

  const recentPlays = await dbRead<any[]>('formatRecentPlays', recentRaw);

  const tracksResult = albumTracks.map((row: any) => ({
    trackId: row.track_id,
    playCount: row.play_count,
    totalMs: row.total_ms,
    track: {
      name: row.name,
      durationMs: row.duration_ms,
      trackNumber: row.track_number,
      album: { id: album.spotify_id, name: album.name, imageUrl: album.image_url },
      artists: albumArtistRows.map((a: any) => ({ id: a.artist_id, name: a.name })),
    },
  }));

  return c.json({
    album: {
      id: album.spotify_id, name: album.name, imageUrl: album.image_url,
      releaseDate: album.release_date, totalTracks: album.total_tracks, albumType: album.album_type,
    },
    artists: albumArtistRows.map((a: any) => ({ id: a.artist_id, name: a.name, imageUrl: a.image_url })),
    stats: statsRow,
    series,
    tracks: tracksResult,
    recentPlays,
    ...formatMerge(mergeInfo),
    playlists,
    covers: coversRaw.map((r: any) => ({ id: r.id, imageUrl: r.image_url, source: r.source, observedAt: r.observed_at })),
  });
});

stats.get('/track/:id', async (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, customDays } = parseParams(c);
  const userId = c.get('userId');

  const track = await dbRead<any>('lookupTrackById', id);
  if (!track) return c.json({ error: 'Track not found' }, 404);

  const trackIds = await dbRead<string[]>('resolveEntityIds', 'track', id, userId);

  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;
  const [albumRaw, arts, statsRow, series, recentRaw, albumBreakdownRaw, playlists, mergeInfo] = await Promise.all([
    track.album_id ? dbRead<any>('lookupAlbumById', track.album_id) : Promise.resolve(null),
    dbRead<any[]>('getTrackArtists', id),
    dbRead<any>('getEntityStats', 'track', id, rangeStart, rangeEnd, trackIds, userId),
    dbRead<any>('getEntitySeries', 'track', id, rangeStart, rangeKey, trackIds, rangeEnd, customDays, userId),
    dbRead<any[]>('getRecentPlays', 'track', id, 10, trackIds, userId),
    dbRead<any[]>('getTrackAlbumBreakdown', id, rangeStart, rangeEnd, userId),
    dbRead<any>('getTrackPlaylistPresence', id, userId),
    dbRead<any>('getEntityMergeInfo', 'track', id),
  ]);

  const [recentPlays, albumBreakdowns] = await Promise.all([
    dbRead<any[]>('formatRecentPlays', recentRaw),
    Promise.all(albumBreakdownRaw.map((row: any) => dbRead<any>('lookupAlbum', row.album_id).then(ab => ({
      albumId: row.album_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      album: ab ? { id: row.album_id, ...ab } : null,
    })))),
  ]);

  return c.json({
    track: {
      id: track.spotify_id, name: track.name, durationMs: track.duration_ms,
      trackNumber: track.track_number, explicit: track.explicit,
      album: albumRaw ? { id: albumRaw.spotify_id, name: albumRaw.name, imageUrl: albumRaw.image_url, releaseDate: albumRaw.release_date } : null,
      artists: arts.map((a: any) => ({ id: a.spotify_id, name: a.name, imageUrl: a.image_url })),
    },
    stats: statsRow,
    series,
    dailySeries: series.map((s: any) => ({ day: s.period, play_count: s.play_count, total_ms: s.total_ms })),
    albumBreakdown: albumBreakdowns.filter((r: any) => r.album),
    recentPlays,
    ...formatMerge(mergeInfo),
    playlists,
  });
});

// --- charts (browsable period charts) ---

stats.get('/charts/periods', async (c) => {
  const userId = c.get('userId');
  const granularity = (c.req.query('granularity') || 'week') as Granularity;
  return c.json({ periods: await dbRead('getAvailablePeriods', granularity, parseWeekStart(c), userId) });
});

stats.get('/charts', async (c) => {
  const userId = c.get('userId');
  const type = toEntityType(c.req.query('type') || 'tracks');
  const granularity = (c.req.query('granularity') || 'week') as Granularity;
  const limit = Math.min(parseInt(c.req.query('limit') || String(CHART_SIZE)), CHART_SIZE);
  const period = c.req.query('period');

  if (!period) return c.json({ error: 'period is required' }, 400);
  if (!periodMatchesGranularity(period, granularity)) return c.json({ error: 'period format does not match granularity' }, 400);

  return c.json(await dbRead('getChart', type, granularity, parseWeekStart(c), period, parseSort(c), userId, limit));
});

// --- chart peaks (deferred loading for chart page) ---

stats.get('/charts/peaks', async (c) => {
  const userId = c.get('userId');
  const type = toEntityType(c.req.query('type') || 'tracks');
  const granularity = (c.req.query('granularity') || 'week') as Granularity;
  const period = c.req.query('period');
  const ids = c.req.query('ids');

  if (!period) return c.json({ error: 'period is required' }, 400);
  if (!ids) return c.json({ error: 'ids is required' }, 400);

  const entityIds = ids.split(',').filter(Boolean);
  return c.json(await dbRead('getChartPeaks', type, granularity, parseWeekStart(c), period, parseSort(c), userId, entityIds));
});

// --- chart history for a single entity ---

stats.get('/chart-history/:type/:id', async (c) => {
  const userId = c.get('userId');
  const entityType = toEntityType(c.req.param('type'));
  const id = c.req.param('id');

  return c.json(await dbRead('getEntityChartHistory', entityType, id, parseWeekStart(c), parseSort(c), userId));
});

// --- records (chart milestones) ---

stats.get('/records', async (c) => {
  const userId = c.get('userId');
  const weekStart = parseWeekStart(c);
  const sort = parseSort(c);
  const limit = Math.min(parseInt(c.req.query('limit') || String(RECORDS_LIMIT)), 50);
  const rawType = c.req.query('type');
  const type = rawType ? toEntityType(rawType) : undefined;

  const cached = getCachedRecords(userId, weekStart, sort, limit, type);
  if (cached) return c.json(cached);
  return c.json(await dbRead('getRecords', weekStart, sort, limit, type, userId));
});

// --- accolades (records achievements per entity, from cache) ---

stats.get('/accolades/:type/:id', (c) => {
  const userId = c.get('userId');
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  return c.json(getEntityAccolades(entityType, id, userId));
});

// --- rankings (lazy, loaded async by frontend) ---

stats.get('/rankings/:type/:id', async (c) => {
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  const userId = c.get('userId');
  return c.json(await dbRead('computeRankings', entityType, id, parseSort(c), userId));
});

stats.get('/ranking-history/:type/:id', async (c) => {
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  const userId = c.get('userId');
  return c.json(await dbRead('getRankingHistory', entityType, id, parseSort(c), userId));
});

// --- search ---

stats.get('/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2) return c.json({ error: 'query too short' }, 400);

  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 20);
  const term = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const userId = c.get('userId');

  return c.json(await dbRead('searchEntities', term, limit, userId));
});

export default stats;
