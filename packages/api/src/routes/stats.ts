import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { dbRead } from '../db/read-pool.js';
import { DEFAULT_PAGE_LIMIT, CHART_SIZE, RECORDS_LIMIT, SESSION_GAP_MS } from '../constants.js';
import { getCachedRecords, getEntityAccolades } from '../services/records-cache.js';
import { ensureFullAlbumTracks } from '../services/ingestion.js';
import type { TimeRange } from '../constants.js';
import { getRangeStart, getPreviousPeriodRange, getPreviousPeriodRangeCustom, getLookbackPreviousPeriodRange, deleteHistoryEntries, computeProjectedRankingsBatch } from '../db/queries/index.js';
import { pollingState, tracks, artists, trackArtists, albums, listeningHistory } from '../db/schema.js';
import type { AppVariables } from '../app.js';
import type { ProjectionResult, ProjectedRankingsResponse, CrossoverEntity } from '@sis/shared';
import { fetchEntityMetadata } from '../db/queries/charts.js';

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
  const sortRaw = c.req.query('sort');
  const sort = (sortRaw === 'plays' ? 'plays' : sortRaw === 'natural' ? 'natural' : 'time') as Sort;

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
const LOOKBACK_QUALIFYING_RANGES = new Set<string>(['3months', '6months', 'year', 'thisYear', 'all']);

async function handleTopEntities(c: any, entityType: EntityType, formatFn: string, batchFormatFn?: string) {
  const { range, limit, rangeStart, rangeEnd, sort } = parseParams(c);
  const userId = c.get('userId');

  const rows = await dbRead<{ entity_id: string; play_count: number; total_ms: number }[]>('getTopEntities', entityType, rangeStart, sort, limit, rangeEnd, userId);

  const lookbackParam = c.req.query('lookback');
  const lookbackDays = lookbackParam === '7d' ? 7 : lookbackParam === '30d' ? 30 : null;
  const qualifies = range !== 'custom' && LOOKBACK_QUALIFYING_RANGES.has(range);

  const prev = (lookbackDays && qualifies)
    ? getLookbackPreviousPeriodRange(range as TimeRange, lookbackDays)
    : null;
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

stats.get('/monthly-distribution', async (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  return c.json(await dbRead('getMonthlyDistribution', rangeStart, rangeEnd, userId));
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

  if (sort === 'natural') {
    try { await ensureFullAlbumTracks(id, album.total_tracks, userId); } catch {}
  }

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
    dbRead<any[]>('getTrackAlbumBreakdown', id, rangeStart, rangeEnd, userId, trackIds),
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
  const fn = c.req.query('crossovers') === 'true' ? 'getRankingHistoryWithCrossovers' : 'getRankingHistory';
  return c.json(await dbRead(fn, entityType, id, parseSort(c), userId));
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

// --- projected rankings (now-playing + session) ---

stats.get('/projected-rankings', (c) => {
  const userId = c.get('userId');
  const sort = parseSort(c);
  const db = getDb();
  const empty: ProjectedRankingsResponse = { nowPlaying: [], session: [], sessionTrackCount: 0, sessionTotalMs: 0 };

  const state = db.select().from(pollingState).where(eq(pollingState.userId, userId)).get();

  // --- recopilar targets de session ---
  type TargetInfo = { entityId: string; entityType: 'track' | 'artist' | 'album'; extraPlays: number; extraMs: number };
  const sessionTargets: TargetInfo[] = [];

  // session: plays desde session_started_at (o derivado del último gap en listening_history)
  const sessionRow = db.all(sql`SELECT session_started_at FROM polling_state WHERE user_id = ${userId}`)[0] as { session_started_at: string | null } | undefined;
  let sessionStart = sessionRow?.session_started_at ?? null;

  if (!sessionStart) {
    // derivar: buscar el último gap > track_duration + buffer entre plays recientes
    const BUFFER_MS = 2 * 60_000;
    const recentPlays = db.all(sql`
      SELECT lh.played_at, t.duration_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId}
      ORDER BY lh.played_at DESC
      LIMIT 100
    `) as { played_at: string; duration_ms: number }[];

    if (recentPlays.length > 0) {
      sessionStart = recentPlays[0].played_at;
      for (let i = 0; i < recentPlays.length - 1; i++) {
        const cur = new Date(recentPlays[i].played_at).getTime();
        const prev = new Date(recentPlays[i + 1].played_at).getTime();
        const prevDuration = recentPlays[i + 1].duration_ms ?? 0;
        const threshold = Math.max(SESSION_GAP_MS, prevDuration + BUFFER_MS);
        if (cur - prev > threshold) {
          sessionStart = recentPlays[i].played_at;
          break;
        }
        sessionStart = recentPlays[i + 1].played_at;
      }
    }
  }

  let sessionTrackCount = 0;
  let sessionTotalMs = 0;
  const trackNameMap = new Map<string, string>();
  if (sessionStart) {
    const sessionPlays = db.all(sql`
      SELECT lh.track_id as trackId, COALESCE(lh.duration_played_ms, t.duration_ms) as playMs
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId} AND lh.played_at >= ${sessionStart}
    `) as { trackId: string; playMs: number }[];

    const trackAccum = new Map<string, { count: number; totalMs: number }>();
    for (const p of sessionPlays) {
      const prev = trackAccum.get(p.trackId) || { count: 0, totalMs: 0 };
      trackAccum.set(p.trackId, { count: prev.count + 1, totalMs: prev.totalMs + p.playMs });
    }
    sessionTrackCount = sessionPlays.length;

    const artistAccum = new Map<string, { plays: number; ms: number }>();
    const albumAccum = new Map<string, { plays: number; ms: number }>();

    for (const [trackId, accum] of trackAccum) {
      const t = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
      if (!t) continue;
      sessionTotalMs += accum.totalMs;
      trackNameMap.set(trackId, t.name);

      sessionTargets.push({ entityId: trackId, entityType: 'track', extraPlays: accum.count, extraMs: accum.totalMs });

      if (t.albumId) {
        const prev = albumAccum.get(t.albumId) || { plays: 0, ms: 0 };
        albumAccum.set(t.albumId, { plays: prev.plays + accum.count, ms: prev.ms + accum.totalMs });
      }

      const tArtists = db.select({ artistId: trackArtists.artistId }).from(trackArtists).where(eq(trackArtists.trackId, trackId)).all();
      for (const ta of tArtists) {
        const prev = artistAccum.get(ta.artistId) || { plays: 0, ms: 0 };
        artistAccum.set(ta.artistId, { plays: prev.plays + accum.count, ms: prev.ms + accum.totalMs });
      }
    }

    for (const [albumId, accum] of albumAccum) {
      sessionTargets.push({ entityId: albumId, entityType: 'album', extraPlays: accum.plays, extraMs: accum.ms });
    }
    for (const [artistId, accum] of artistAccum) {
      sessionTargets.push({ entityId: artistId, entityType: 'artist', extraPlays: accum.plays, extraMs: accum.ms });
    }
  }

  // --- batch: session (con sessionStart), pre-sesión como "current", post-sesión como "projected" ---
  const sessByType = new Map<string, { entityId: string; extraPlays: number; extraMs: number }[]>();
  for (const t of sessionTargets) {
    const list = sessByType.get(t.entityType) || [];
    if (!list.some(x => x.entityId === t.entityId)) {
      list.push({ entityId: t.entityId, extraPlays: 0, extraMs: 0 });
    }
    sessByType.set(t.entityType, list);
  }

  type RankResult = Record<string, { current: number | null; projected: number | null; displaced: string[] }>;
  const sessRankResults = new Map<string, Map<string, RankResult>>();
  for (const [entityType, targets] of sessByType) {
    sessRankResults.set(entityType, computeProjectedRankingsBatch(db, entityType as 'track' | 'artist' | 'album', targets, sort, userId, sessionStart));
  }

  // batch-fetch displaced entity metadata per entity type
  const displacedMetaByType = new Map<string, Map<string, { name: string; imageUrl: string | null; artistName: string | null }>>();
  for (const [entityType, rankMap] of sessRankResults) {
    const allIds = new Set<string>();
    for (const ranks of rankMap.values()) {
      for (const v of Object.values(ranks)) {
        for (const id of v.displaced) allIds.add(id);
      }
    }
    if (allIds.size > 0) {
      displacedMetaByType.set(entityType, fetchEntityMetadata(db, entityType as 'track' | 'artist' | 'album', [...allIds]));
    }
  }

  // --- construir resultados ---
  function buildResult(target: TargetInfo, resultsMap: Map<string, Map<string, RankResult>>): ProjectionResult | null {
    const typeResults = resultsMap.get(target.entityType);
    if (!typeResults) return null;

    const ranks = typeResults.get(target.entityId);
    if (!ranks) return null;

    const metaMap = displacedMetaByType.get(target.entityType);

    const changes = Object.entries(ranks)
      .filter(([, v]) => v.current !== null && v.projected !== null && v.current !== v.projected)
      .map(([range, v]) => ({
        range,
        currentRank: v.current!,
        projectedRank: v.projected!,
        delta: v.current! - v.projected!,
        displaced: v.displaced.map(id => {
          const meta = metaMap?.get(id);
          return { id, name: meta?.name ?? '', imageUrl: meta?.imageUrl ?? null, artistName: meta?.artistName ?? null } satisfies CrossoverEntity;
        }),
      }));

    if (changes.length === 0) return null;

    let entityName = '';
    let imageUrl: string | null = null;

    if (target.entityType === 'track') {
      entityName = trackNameMap.get(target.entityId) ?? '';
    } else if (target.entityType === 'artist') {
      const a = db.select().from(artists).where(eq(artists.spotifyId, target.entityId)).get();
      entityName = a?.name ?? '';
      imageUrl = a?.imageUrl ?? null;
    } else {
      const al = db.select().from(albums).where(eq(albums.spotifyId, target.entityId)).get();
      entityName = al?.name ?? '';
      imageUrl = al?.imageUrl ?? null;
    }

    return { entityId: target.entityId, entityType: target.entityType, entityName, imageUrl, changes };
  }

  const sessionResults: ProjectionResult[] = [];
  for (const t of sessionTargets) {
    const r = buildResult(t, sessRankResults);
    if (r) sessionResults.push(r);
  }

  return c.json({ nowPlaying: [], session: sessionResults, sessionTrackCount, sessionTotalMs, sessionStartedAt: sessionStart } satisfies ProjectedRankingsResponse);
});

export default stats;
