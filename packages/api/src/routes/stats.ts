import { Hono } from 'hono';
import { sql, eq, desc } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { listeningHistory, tracks, artists, trackArtists, albums } from '../db/schema.js';
import { DEFAULT_PAGE_LIMIT, CHART_SIZE } from '../constants.js';
import { getCachedRecords, getEntityAccolades } from '../services/records-cache.js';
import type { TimeRange } from '../constants.js';
import {
  getRangeStart, getPreviousPeriodRange, getPreviousPeriodRangeCustom,
  getTopEntities, getPrevPeriodEntities,
  getEntityStats, getEntitySeries, getGlobalSeries,
  getRecentPlays, computeRankings, getRankingHistory,
  getArtistTopTracks, getArtistTopAlbums,
  resolveAlbumIds, getAlbumArtists, getAlbumTracks,
  enrichTrack,
  getTrackAlbumBreakdown,
  getRecords,
  getChart, getAvailablePeriods, getEntityChartHistory,
  lookupArtist, lookupAlbum,
  formatTopTrackRow, formatTopArtistRow, formatTopAlbumRow,
  formatRecentPlay, formatArtistTrackRow, formatArtistAlbumRow,
  getTrackPlaylistPresence, getArtistPlaylistPresence, getAlbumPlaylistPresence,
  getHistoryPage,
  deleteHistoryEntries,
} from '../db/queries/index.js';
import type { EntityType } from '../db/queries/helpers.js';

import type { AppVariables } from '../app.js';

const stats = new Hono<{ Variables: AppVariables }>();

// helpers: parseo de query params comunes
type WeekStart = 'monday' | 'sunday' | 'friday';
type Sort = 'plays' | 'time';

function parseWeekStart(c: any): WeekStart {
  const ws = c.req.query('weekStart');
  return ws === 'sunday' ? 'sunday' : ws === 'friday' ? 'friday' : 'monday';
}

function parseSort(c: any): Sort {
  return c.req.query('sort') === 'plays' ? 'plays' : 'time';
}

/** Construir WHERE con rango temporal + userId para queries directas en stats.ts */
function buildWhere(rangeStart: string | null, rangeEnd: string | null | undefined, userId: number, alias = 'lh') {
  const pa = sql.raw(`${alias}.played_at`);
  const uid = sql.raw(`${alias}.user_id`);
  if (rangeStart && rangeEnd) return sql`WHERE ${pa} >= ${rangeStart} AND ${pa} <= ${rangeEnd} AND ${uid} = ${userId}`;
  if (rangeStart) return sql`WHERE ${pa} >= ${rangeStart} AND ${uid} = ${userId}`;
  return sql`WHERE ${uid} = ${userId}`;
}

function parseParams(c: any) {
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 200);
  const sort = (c.req.query('sort') === 'plays' ? 'plays' : 'time') as 'plays' | 'time';

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
function handleTopEntities<T>(
  c: any,
  entityType: EntityType,
  formatRow: (db: ReturnType<typeof getDb>, row: { entity_id: string; play_count: number; total_ms: number }) => T,
) {
  const { range, limit, rangeStart, rangeEnd, sort } = parseParams(c);
  const userId = c.get('userId');
  const db = getDb();

  const rows = getTopEntities(db, entityType, rangeStart, sort, limit, rangeEnd, userId);

  const prev = range === 'custom' && rangeStart && rangeEnd
    ? getPreviousPeriodRangeCustom(rangeStart, rangeEnd)
    : range !== 'custom' ? getPreviousPeriodRange(range as TimeRange) : null;
  const prevRankMap = prev
    ? buildRankChangeMap(getPrevPeriodEntities(db, entityType, prev.prevStart, prev.prevEnd, sort, userId))
    : new Map<string, number>();

  return c.json(rows.map((row, i) => ({
    ...formatRow(db, row),
    ...rankChangeFields(prev, prevRankMap, row.entity_id, i + 1),
  })));
}

// --- top endpoints ---

stats.get('/top-tracks', (c) => handleTopEntities(c, 'track', formatTopTrackRow));
stats.get('/top-artists', (c) => handleTopEntities(c, 'artist', formatTopArtistRow));
stats.get('/top-albums', (c) => handleTopEntities(c, 'album', formatTopAlbumRow));

// --- specialized endpoints (no se extraen a queries) ---

stats.get('/top-genres', (c) => {
  const { limit, rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  const db = getDb();

  const rows = db.all(sql`
    SELECT genre.value as genre, count(*) as play_count
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN artists a ON a.spotify_id = ta.artist_id
    JOIN json_each(a.genres) genre
    ${buildWhere(rangeStart, rangeEnd, userId)}
    GROUP BY genre.value
    ORDER BY play_count DESC
    LIMIT ${limit}
  `) as { genre: string; play_count: number }[];

  return c.json(rows);
});

stats.get('/listening-time', (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  const granularity = c.req.query('granularity') || 'day';
  const db = getDb();

  return c.json(getGlobalSeries(db, rangeStart, granularity, rangeEnd, userId));
});

stats.get('/history', (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 100);
  const offset = (page - 1) * limit;
  const userId = c.get('userId');
  const db = getDb();

  const { items: rows, total } = getHistoryPage(db, userId, limit, offset, {
    date: c.req.query('date'),
    albumId: c.req.query('album'),
    trackId: c.req.query('track'),
    artistId: c.req.query('artist'),
  });

  const items = rows.map(row => ({
    id: row.id,
    playedAt: row.played_at,
    contextType: null,
    track: enrichTrack(db, row.track_id),
  }));

  return c.json({
    items,
    page,
    limit,
    total,
    hasMore: offset + limit < total,
  });
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

stats.get('/heatmap', (c) => {
  const { rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  const db = getDb();

  // heatmap no usa alias de tabla, usar columnas directas
  const whereClause = buildWhere(rangeStart, rangeEnd, userId, 'listening_history');

  const rows = db.all(sql`
    SELECT
      cast(strftime('%w', played_at) as integer) as day_of_week,
      cast(strftime('%H', played_at) as integer) as hour,
      count(*) as play_count
    FROM listening_history
    ${whereClause}
    GROUP BY day_of_week, hour
  `) as { day_of_week: number; hour: number; play_count: number }[];

  return c.json(rows);
});

stats.get('/streaks', (c) => {
  const userId = c.get('userId');
  const db = getDb();

  const days = db.all(sql`
    SELECT DISTINCT date(played_at) as day
    FROM listening_history
    WHERE user_id = ${userId}
    ORDER BY day ASC
  `) as { day: string }[];

  if (days.length === 0) {
    return c.json({ currentStreak: 0, longestStreak: 0, totalDays: 0 });
  }

  let longestStreak = 1;
  let currentStreak = 1;
  let tempStreak = 1;

  const today = new Date().toISOString().split('T')[0];
  const lastDay = days[days.length - 1].day;

  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1].day);
    const curr = new Date(days[i].day);
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays === 1) {
      tempStreak++;
    } else {
      tempStreak = 1;
    }
    longestStreak = Math.max(longestStreak, tempStreak);
  }

  if (lastDay === today || lastDay === new Date(Date.now() - 86400000).toISOString().split('T')[0]) {
    currentStreak = 1;
    for (let i = days.length - 2; i >= 0; i--) {
      const prev = new Date(days[i].day);
      const curr = new Date(days[i + 1].day);
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  } else {
    currentStreak = 0;
  }

  return c.json({ currentStreak, longestStreak, totalDays: days.length });
});

// --- detail endpoints ---

stats.get('/artist/:id', (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const userId = c.get('userId');
  const trackLimit = Math.min(parseInt(c.req.query('trackLimit') || '10'), 200);
  const albumLimit = Math.min(parseInt(c.req.query('albumLimit') || '5'), 200);
  const db = getDb();

  const artist = db.select().from(artists).where(eq(artists.spotifyId, id)).get();
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const statsRow = getEntityStats(db, 'artist', id, rangeStart, rangeEnd, undefined, userId);
  const series = getEntitySeries(db, 'artist', id, rangeStart, range === 'custom' ? 'all' : range as TimeRange, undefined, rangeEnd, customDays, userId);

  const topTracksResult = getArtistTopTracks(db, id, rangeStart, sort, trackLimit, rangeEnd, userId)
    .map(row => formatArtistTrackRow(db, row));

  const topAlbumsResult = getArtistTopAlbums(db, id, rangeStart, sort, albumLimit, rangeEnd, userId)
    .map(row => formatArtistAlbumRow(db, row));

  const recentResult = getRecentPlays(db, 'artist', id, 10, undefined, userId)
    .map(row => formatRecentPlay(db, row));

  return c.json({
    artist: { id: artist.spotifyId, name: artist.name, imageUrl: artist.imageUrl, genres: artist.genres },
    stats: statsRow,
    series,
    topTracks: topTracksResult,
    topAlbums: topAlbumsResult,
    recentPlays: recentResult,
    playlists: getArtistPlaylistPresence(db, id, userId),
  });
});

stats.get('/album/:id', (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const userId = c.get('userId');
  const db = getDb();

  const album = db.select().from(albums).where(eq(albums.spotifyId, id)).get();
  if (!album) return c.json({ error: 'Album not found' }, 404);

  // resolver IDs de álbum una sola vez (target + sources mergeados)
  const albumIds = resolveAlbumIds(db, id, userId);

  const albumArtistRows = getAlbumArtists(db, id, albumIds);
  const statsRow = getEntityStats(db, 'album', id, rangeStart, rangeEnd, albumIds, userId);
  const series = getEntitySeries(db, 'album', id, rangeStart, range === 'custom' ? 'all' : range as TimeRange, albumIds, rangeEnd, customDays, userId);

  const albumTracks = getAlbumTracks(db, id, rangeStart, sort, albumIds, rangeEnd, userId);
  const tracksResult = albumTracks.map(row => ({
    trackId: row.track_id,
    playCount: row.play_count,
    totalMs: row.total_ms,
    track: {
      name: row.name,
      durationMs: row.duration_ms,
      trackNumber: row.track_number,
      album: { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl },
      artists: albumArtistRows.map(a => ({ id: a.artist_id, name: a.name })),
    },
  }));

  const recentResult = getRecentPlays(db, 'album', id, 10, albumIds, userId)
    .map(row => formatRecentPlay(db, row));

  // merge info
  const mergedFromRows = db.all(sql`
    SELECT mr.id as rule_id, mr.source_id, al.name, al.image_url
    FROM merge_rules mr
    JOIN albums al ON al.spotify_id = mr.source_id
    WHERE mr.entity_type = 'album' AND mr.target_id = ${id}
  `) as { rule_id: number; source_id: string; name: string; image_url: string | null }[];

  const mergedIntoRow = db.all(sql`
    SELECT mr.id as rule_id, mr.target_id, al.name, al.image_url
    FROM merge_rules mr
    JOIN albums al ON al.spotify_id = mr.target_id
    WHERE mr.entity_type = 'album' AND mr.source_id = ${id}
  `)[0] as { rule_id: number; target_id: string; name: string; image_url: string | null } | undefined;

  return c.json({
    album: {
      id: album.spotifyId, name: album.name, imageUrl: album.imageUrl,
      releaseDate: album.releaseDate, totalTracks: album.totalTracks, albumType: album.albumType,
    },
    artists: albumArtistRows.map(a => ({ id: a.artist_id, name: a.name, imageUrl: a.image_url })),
    stats: statsRow,
    series,
    tracks: tracksResult,
    recentPlays: recentResult,
    mergedFrom: mergedFromRows.map(r => ({ id: r.source_id, ruleId: r.rule_id, name: r.name, imageUrl: r.image_url })),
    mergedInto: mergedIntoRow ? { id: mergedIntoRow.target_id, ruleId: mergedIntoRow.rule_id, name: mergedIntoRow.name, imageUrl: mergedIntoRow.image_url } : null,
    playlists: getAlbumPlaylistPresence(db, id, userId),
  });
});

stats.get('/track/:id', (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, customDays } = parseParams(c);
  const userId = c.get('userId');
  const db = getDb();

  const track = db.select().from(tracks).where(eq(tracks.spotifyId, id)).get();
  if (!track) return c.json({ error: 'Track not found' }, 404);

  const album = track.albumId
    ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
    : null;

  const artRows = db.select().from(trackArtists).where(eq(trackArtists.trackId, id)).all();
  const arts = artRows
    .sort((a, b) => a.position - b.position)
    .map(ta => db.select().from(artists).where(eq(artists.spotifyId, ta.artistId)).get())
    .filter(Boolean);

  const statsRow = getEntityStats(db, 'track', id, rangeStart, rangeEnd, undefined, userId);
  const series = getEntitySeries(db, 'track', id, rangeStart, range === 'custom' ? 'all' : range as TimeRange, undefined, rangeEnd, customDays, userId);

  const recentResult = getRecentPlays(db, 'track', id, 10, undefined, userId)
    .map(row => formatRecentPlay(db, row));

  const albumBreakdownResult = getTrackAlbumBreakdown(db, id, rangeStart, rangeEnd, userId)
    .map(row => {
      const ab = lookupAlbum(db, row.album_id);
      return {
        albumId: row.album_id,
        playCount: row.play_count,
        totalMs: row.total_ms,
        album: ab ? { id: row.album_id, ...ab } : null,
      };
    }).filter(r => r.album);

  return c.json({
    track: {
      id: track.spotifyId, name: track.name, durationMs: track.durationMs,
      trackNumber: track.trackNumber, explicit: track.explicit,
      album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl, releaseDate: album.releaseDate } : null,
      artists: arts.map(a => ({ id: a!.spotifyId, name: a!.name, imageUrl: a!.imageUrl })),
    },
    stats: statsRow,
    series,
    dailySeries: series.map(s => ({ day: s.period, play_count: s.play_count, total_ms: s.total_ms })),
    albumBreakdown: albumBreakdownResult,
    recentPlays: recentResult,
    playlists: getTrackPlaylistPresence(db, id, userId),
  });
});

// --- charts (browsable period charts) ---

stats.get('/charts/periods', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const granularity = (c.req.query('granularity') || 'week') as 'week' | 'month' | 'year';
  return c.json({ periods: getAvailablePeriods(db, granularity, parseWeekStart(c), userId) });
});

stats.get('/charts', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const type = (c.req.query('type') || 'tracks') as 'tracks' | 'albums' | 'artists';
  const granularity = (c.req.query('granularity') || 'week') as 'week' | 'month' | 'year';
  const limit = Math.min(parseInt(c.req.query('limit') || String(CHART_SIZE)), CHART_SIZE);
  const period = c.req.query('period');

  if (!period) return c.json({ error: 'period is required' }, 400);

  return c.json(getChart(db, type, granularity, parseWeekStart(c), period, parseSort(c), userId, limit));
});

// --- chart history for a single entity ---

stats.get('/chart-history/:type/:id', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const entityType = c.req.param('type') as 'tracks' | 'albums' | 'artists';
  const id = c.req.param('id');

  return c.json(getEntityChartHistory(db, entityType, id, parseWeekStart(c), parseSort(c), userId));
});

// --- records (chart milestones) ---

stats.get('/records', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const weekStart = parseWeekStart(c);
  const sort = parseSort(c);
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);
  const type = c.req.query('type') as 'tracks' | 'albums' | 'artists' | undefined;

  const cached = getCachedRecords(userId, weekStart, sort, limit, type);
  if (cached) return c.json(cached);
  return c.json(getRecords(db, weekStart, sort, limit, type, userId));
});

// --- accolades (records achievements per entity, from cache) ---

stats.get('/accolades/:type/:id', (c) => {
  const userId = c.get('userId');
  const entityType = c.req.param('type') as 'artist' | 'track' | 'album';
  const id = c.req.param('id');
  return c.json(getEntityAccolades(entityType, id, userId));
});

// --- rankings (lazy, loaded async by frontend) ---

stats.get('/rankings/:type/:id', (c) => {
  const entityType = c.req.param('type') as 'artist' | 'track' | 'album';
  const id = c.req.param('id');
  const userId = c.get('userId');
  return c.json(computeRankings(getDb(), entityType, id, parseSort(c), userId));
});

stats.get('/ranking-history/:type/:id', (c) => {
  const entityType = c.req.param('type') as 'artist' | 'track' | 'album';
  const id = c.req.param('id');
  const userId = c.get('userId');
  return c.json(getRankingHistory(getDb(), entityType, id, parseSort(c), userId));
});

// --- search ---

stats.get('/search', (c) => {
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2) return c.json({ error: 'query too short' }, 400);

  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 20);
  const term = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const userId = c.get('userId');
  const db = getDb();

  const artistRows = db.all(sql`
    SELECT a.spotify_id as id, a.name, a.image_url as imageUrl,
           COALESCE(s.play_count, 0) as playCount
    FROM artists a
    LEFT JOIN (
      SELECT ta.artist_id, COUNT(*) as play_count
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id
      WHERE lh.user_id = ${userId}
      GROUP BY ta.artist_id
    ) s ON s.artist_id = a.spotify_id
    WHERE unaccent(a.name) LIKE ${'%' + term + '%'}
      AND a.spotify_id NOT LIKE 'import:%'
    ORDER BY playCount DESC
    LIMIT ${limit}
  `) as any[];

  const albumRows = db.all(sql`
    SELECT al.spotify_id as id, al.name, al.image_url as imageUrl,
           (SELECT ar.name FROM tracks t2
            JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id AND ta2.position = 0
            JOIN artists ar ON ar.spotify_id = ta2.artist_id
            WHERE t2.album_id = al.spotify_id LIMIT 1) as artistName,
           COALESCE(s.play_count, 0) + COALESCE(ms.merged_count, 0) as playCount
    FROM albums al
    LEFT JOIN (
      SELECT t.album_id, COUNT(*) as play_count
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE t.album_id IS NOT NULL AND lh.user_id = ${userId}
      GROUP BY t.album_id
    ) s ON s.album_id = al.spotify_id
    LEFT JOIN (
      SELECT mr.target_id, SUM(sc.play_count) as merged_count
      FROM merge_rules mr
      JOIN (
        SELECT t.album_id, COUNT(*) as play_count
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        WHERE t.album_id IS NOT NULL AND lh.user_id = ${userId}
        GROUP BY t.album_id
      ) sc ON sc.album_id = mr.source_id
      WHERE mr.entity_type = 'album'
      GROUP BY mr.target_id
    ) ms ON ms.target_id = al.spotify_id
    WHERE unaccent(al.name) LIKE ${'%' + term + '%'}
      AND al.spotify_id NOT LIKE 'import:%'
      AND al.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'album')
    ORDER BY playCount DESC
    LIMIT ${limit}
  `) as any[];

  const trackRows = db.all(sql`
    SELECT t.spotify_id as id, t.name,
           al.image_url as albumImageUrl,
           ar.name as artistName,
           COALESCE(s.play_count, 0) as playCount
    FROM tracks t
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    LEFT JOIN (
      SELECT track_id, MIN(artist_id) as artist_id
      FROM track_artists WHERE position = 0 GROUP BY track_id
    ) pa ON pa.track_id = t.spotify_id
    LEFT JOIN artists ar ON ar.spotify_id = pa.artist_id
    LEFT JOIN (
      SELECT track_id, COUNT(*) as play_count
      FROM listening_history WHERE user_id = ${userId} GROUP BY track_id
    ) s ON s.track_id = t.spotify_id
    WHERE (unaccent(t.name) LIKE ${'%' + term + '%'}
           OR unaccent(ar.name) LIKE ${'%' + term + '%'})
      AND t.spotify_id NOT LIKE 'import:%'
    ORDER BY playCount DESC
    LIMIT ${limit}
  `) as any[];

  return c.json({
    artists: artistRows,
    albums: albumRows,
    tracks: trackRows,
  });
});

export default stats;
