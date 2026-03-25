import { Hono } from 'hono';
import { sql, eq, desc } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { listeningHistory, tracks, artists, trackArtists, albums } from '../db/schema.js';
import { DEFAULT_PAGE_LIMIT } from '../constants.js';
import type { TimeRange } from '../constants.js';
import {
  getRangeStart, getPreviousPeriodRange,
  getTopEntities, getPrevPeriodEntities,
  getEntityStats, getEntitySeries, getGlobalSeries,
  getRecentPlays, computeRankings,
  getArtistTopTracks, getArtistTopAlbums,
  resolveAlbumIds, getAlbumArtists, getAlbumTracks,
  getTrackAlbumBreakdown,
  getRecords,
  getChart, getAvailablePeriods, getEntityChartHistory,
} from '../db/queries/index.js';

const stats = new Hono();

// helper: extraer parámetros comunes
function parseParams(c: any) {
  const range = (c.req.query('range') || 'month') as TimeRange;
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 200);
  const rangeStart = getRangeStart(range);
  const sort = (c.req.query('sort') === 'plays' ? 'plays' : 'time') as 'plays' | 'time';
  return { range, limit, rangeStart, sort };
}

// helper: enriquecer track_id con metadata completa
function enrichTrack(db: ReturnType<typeof getDb>, trackId: string) {
  const track = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
  if (!track) return null;
  const album = track.albumId
    ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
    : null;
  const artRows = db.select().from(trackArtists).where(eq(trackArtists.trackId, trackId)).all();
  const arts = artRows
    .sort((a, b) => a.position - b.position)
    .map(ta => db.select().from(artists).where(eq(artists.spotifyId, ta.artistId)).get())
    .filter(Boolean);
  return {
    id: track.spotifyId,
    name: track.name,
    durationMs: track.durationMs,
    album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl } : null,
    artists: arts.map(a => ({ id: a!.spotifyId, name: a!.name })),
  };
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

// --- top endpoints ---

stats.get('/top-tracks', (c) => {
  const { range, limit, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const rows = getTopEntities(db, 'track', rangeStart, sort, limit);

  const prev = getPreviousPeriodRange(range);
  const prevRankMap = prev
    ? buildRankChangeMap(getPrevPeriodEntities(db, 'track', prev.prevStart, prev.prevEnd, sort))
    : new Map<string, number>();

  const result = rows.map((row, i) => {
    const trackInfo = enrichTrack(db, row.entity_id);
    return {
      trackId: row.entity_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      ...rankChangeFields(prev, prevRankMap, row.entity_id, i + 1),
      track: trackInfo ? {
        name: trackInfo.name,
        durationMs: trackInfo.durationMs,
        album: trackInfo.album,
        artists: trackInfo.artists,
      } : null,
    };
  });

  return c.json(result);
});

stats.get('/top-artists', (c) => {
  const { range, limit, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const rows = getTopEntities(db, 'artist', rangeStart, sort, limit);

  const prev = getPreviousPeriodRange(range);
  const prevRankMap = prev
    ? buildRankChangeMap(getPrevPeriodEntities(db, 'artist', prev.prevStart, prev.prevEnd, sort))
    : new Map<string, number>();

  const result = rows.map((row, i) => {
    const artist = db.select().from(artists).where(eq(artists.spotifyId, row.entity_id)).get();
    return {
      artistId: row.entity_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      ...rankChangeFields(prev, prevRankMap, row.entity_id, i + 1),
      artist: artist ? { name: artist.name, imageUrl: artist.imageUrl, genres: artist.genres } : null,
    };
  });

  return c.json(result);
});

stats.get('/top-albums', (c) => {
  const { range, limit, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const rows = getTopEntities(db, 'album', rangeStart, sort, limit);

  const prev = getPreviousPeriodRange(range);
  const prevRankMap = prev
    ? buildRankChangeMap(getPrevPeriodEntities(db, 'album', prev.prevStart, prev.prevEnd, sort))
    : new Map<string, number>();

  const result = rows.map((row, i) => {
    const album = db.select().from(albums).where(eq(albums.spotifyId, row.entity_id)).get();
    return {
      albumId: row.entity_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      ...rankChangeFields(prev, prevRankMap, row.entity_id, i + 1),
      album: album ? { name: album.name, imageUrl: album.imageUrl, releaseDate: album.releaseDate } : null,
    };
  });

  return c.json(result);
});

// --- specialized endpoints (no se extraen a queries) ---

stats.get('/top-genres', (c) => {
  const { limit, rangeStart } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  const rows = db.all(sql`
    SELECT genre.value as genre, count(*) as play_count
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN artists a ON a.spotify_id = ta.artist_id
    JOIN json_each(a.genres) genre
    ${whereClause}
    GROUP BY genre.value
    ORDER BY play_count DESC
    LIMIT ${limit}
  `) as { genre: string; play_count: number }[];

  return c.json(rows);
});

stats.get('/listening-time', (c) => {
  const { rangeStart } = parseParams(c);
  const granularity = c.req.query('granularity') || 'day';
  const db = getDb();

  return c.json(getGlobalSeries(db, rangeStart, granularity));
});

stats.get('/history', (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 100);
  const offset = (page - 1) * limit;
  const db = getDb();

  const rows = db
    .select()
    .from(listeningHistory)
    .orderBy(desc(listeningHistory.playedAt))
    .limit(limit)
    .offset(offset)
    .all();

  const result = rows.map(row => {
    const trackInfo = enrichTrack(db, row.trackId);
    return {
      id: row.id,
      playedAt: row.playedAt,
      contextType: row.contextType,
      track: trackInfo,
    };
  });

  const total = db.all(sql`SELECT count(*) as count FROM listening_history`)[0] as { count: number };

  return c.json({
    items: result,
    page,
    limit,
    total: total.count,
    hasMore: offset + limit < total.count,
  });
});

stats.get('/heatmap', (c) => {
  const { rangeStart } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE played_at >= ${rangeStart}`
    : sql``;

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
  const db = getDb();

  const days = db.all(sql`
    SELECT DISTINCT date(played_at) as day
    FROM listening_history
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
  const { range, rangeStart, sort } = parseParams(c);
  const trackLimit = Math.min(parseInt(c.req.query('trackLimit') || '10'), 200);
  const albumLimit = Math.min(parseInt(c.req.query('albumLimit') || '5'), 200);
  const db = getDb();

  const artist = db.select().from(artists).where(eq(artists.spotifyId, id)).get();
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const statsRow = getEntityStats(db, 'artist', id, rangeStart);
  const series = getEntitySeries(db, 'artist', id, rangeStart, range);

  const topTracks = getArtistTopTracks(db, id, rangeStart, sort, trackLimit);
  const topTracksResult = topTracks.map(row => {
    const track = db.select().from(tracks).where(eq(tracks.spotifyId, row.track_id)).get();
    const album = track?.albumId
      ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
      : null;
    return {
      trackId: row.track_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      track: track ? {
        name: track.name,
        durationMs: track.durationMs,
        album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl } : null,
        artists: [{ id: artist.spotifyId, name: artist.name }],
      } : null,
    };
  });

  const topAlbumsRows = getArtistTopAlbums(db, id, rangeStart, sort, albumLimit);
  const topAlbumsResult = topAlbumsRows.map(row => {
    const album = db.select().from(albums).where(eq(albums.spotifyId, row.album_id)).get();
    return {
      albumId: row.album_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      album: album ? { name: album.name, imageUrl: album.imageUrl, releaseDate: album.releaseDate } : null,
    };
  });

  const recentPlays = getRecentPlays(db, 'artist', id, 10);
  const recentResult = recentPlays.map(row => {
    const track = db.select().from(tracks).where(eq(tracks.spotifyId, row.track_id)).get();
    const album = track?.albumId
      ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
      : null;
    return {
      id: row.id,
      playedAt: row.played_at,
      track: track ? {
        id: track.spotifyId,
        name: track.name,
        durationMs: track.durationMs,
        album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl } : null,
        artists: [{ id: artist.spotifyId, name: artist.name }],
      } : null,
    };
  });

  return c.json({
    artist: { id: artist.spotifyId, name: artist.name, imageUrl: artist.imageUrl, genres: artist.genres },
    stats: statsRow,
    series,
    topTracks: topTracksResult,
    topAlbums: topAlbumsResult,
    recentPlays: recentResult,
  });
});

stats.get('/album/:id', (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const album = db.select().from(albums).where(eq(albums.spotifyId, id)).get();
  if (!album) return c.json({ error: 'Album not found' }, 404);

  // resolver IDs de álbum una sola vez (target + sources mergeados)
  const albumIds = resolveAlbumIds(db, id);

  const albumArtistRows = getAlbumArtists(db, id, albumIds);
  const statsRow = getEntityStats(db, 'album', id, rangeStart, albumIds);
  const series = getEntitySeries(db, 'album', id, rangeStart, range, albumIds);

  const albumTracks = getAlbumTracks(db, id, rangeStart, sort, albumIds);
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

  const recentPlays = getRecentPlays(db, 'album', id, 10, albumIds);
  const recentResult = recentPlays.map(row => {
    const track = db.select().from(tracks).where(eq(tracks.spotifyId, row.track_id)).get();
    return {
      id: row.id,
      playedAt: row.played_at,
      track: track ? {
        id: track.spotifyId,
        name: track.name,
        durationMs: track.durationMs,
        album: { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl },
        artists: albumArtistRows.map(a => ({ id: a.artist_id, name: a.name })),
      } : null,
    };
  });

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
  });
});

stats.get('/track/:id', (c) => {
  const id = c.req.param('id');
  const { range, rangeStart } = parseParams(c);
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

  const statsRow = getEntityStats(db, 'track', id, rangeStart);
  const series = getEntitySeries(db, 'track', id, rangeStart, range);

  const albumBreakdown = getTrackAlbumBreakdown(db, id, rangeStart);
  const albumBreakdownResult = albumBreakdown.map(row => {
    const ab = db.select().from(albums).where(eq(albums.spotifyId, row.album_id)).get();
    return {
      albumId: row.album_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      album: ab ? { id: ab.spotifyId, name: ab.name, imageUrl: ab.imageUrl, releaseDate: ab.releaseDate } : null,
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
  });
});

// --- charts (browsable period charts) ---

stats.get('/charts/periods', (c) => {
  const db = getDb();
  const granularity = (c.req.query('granularity') || 'week') as 'week' | 'month' | 'year';
  const ws = c.req.query('weekStart');
  const weekStart = (ws === 'sunday' ? 'sunday' : ws === 'friday' ? 'friday' : 'monday') as 'monday' | 'sunday' | 'friday';

  const periods = getAvailablePeriods(db, granularity, weekStart);
  return c.json({ periods });
});

stats.get('/charts', (c) => {
  const db = getDb();
  const type = (c.req.query('type') || 'tracks') as 'tracks' | 'albums' | 'artists';
  const granularity = (c.req.query('granularity') || 'week') as 'week' | 'month' | 'year';
  const ws = c.req.query('weekStart');
  const weekStart = (ws === 'sunday' ? 'sunday' : ws === 'friday' ? 'friday' : 'monday') as 'monday' | 'sunday' | 'friday';
  const sort = (c.req.query('sort') === 'plays' ? 'plays' : 'time') as 'plays' | 'time';
  const limit = Math.min(parseInt(c.req.query('limit') || '25'), 25);
  const period = c.req.query('period');

  if (!period) return c.json({ error: 'period is required' }, 400);

  const chart = getChart(db, type, granularity, weekStart, period, sort, limit);
  return c.json(chart);
});

// --- chart history for a single entity ---

stats.get('/chart-history/:type/:id', (c) => {
  const db = getDb();
  const entityType = c.req.param('type') as 'tracks' | 'albums' | 'artists';
  const id = c.req.param('id');
  const ws = c.req.query('weekStart');
  const weekStart = (ws === 'sunday' ? 'sunday' : ws === 'friday' ? 'friday' : 'monday') as 'monday' | 'sunday' | 'friday';
  const sort = (c.req.query('sort') === 'plays' ? 'plays' : 'time') as 'plays' | 'time';

  const history = getEntityChartHistory(db, entityType, id, weekStart, sort);
  return c.json(history);
});

// --- records (chart milestones) ---

stats.get('/records', (c) => {
  const db = getDb();
  const ws = c.req.query('weekStart');
  const weekStart = (ws === 'sunday' ? 'sunday' : ws === 'friday' ? 'friday' : 'monday') as 'monday' | 'sunday' | 'friday';
  const sort = (c.req.query('sort') === 'plays' ? 'plays' : 'time') as 'plays' | 'time';
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);

  const type = c.req.query('type') as 'tracks' | 'albums' | 'artists' | undefined;
  const records = getRecords(db, weekStart, sort, limit, type);
  return c.json(records);
});

// --- rankings (lazy, loaded async by frontend) ---

stats.get('/rankings/:type/:id', (c) => {
  const entityType = c.req.param('type') as 'artist' | 'track' | 'album';
  const id = c.req.param('id');
  const sort = (c.req.query('sort') === 'plays' ? 'plays' : 'time') as 'plays' | 'time';
  const db = getDb();

  const rankings = computeRankings(db, entityType, id, sort);
  return c.json(rankings);
});

// --- search ---

stats.get('/search', (c) => {
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2) return c.json({ error: 'query too short' }, 400);

  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 20);
  const term = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const db = getDb();

  const artistRows = db.all(sql`
    SELECT a.spotify_id as id, a.name, a.image_url as imageUrl,
           COALESCE(s.play_count, 0) as playCount
    FROM artists a
    LEFT JOIN (
      SELECT ta.artist_id, COUNT(*) as play_count
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id
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
      WHERE t.album_id IS NOT NULL
      GROUP BY t.album_id
    ) s ON s.album_id = al.spotify_id
    LEFT JOIN (
      SELECT mr.target_id, SUM(sc.play_count) as merged_count
      FROM merge_rules mr
      JOIN (
        SELECT t.album_id, COUNT(*) as play_count
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        WHERE t.album_id IS NOT NULL
        GROUP BY t.album_id
      ) sc ON sc.album_id = mr.source_id
      WHERE mr.entity_type = 'album'
      GROUP BY mr.target_id
    ) ms ON ms.target_id = al.spotify_id
    WHERE unaccent(al.name) LIKE ${'%' + term + '%'}
      AND al.spotify_id NOT LIKE 'import:%'
      AND al.spotify_id NOT LIKE 'local:%'
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
      FROM listening_history GROUP BY track_id
    ) s ON s.track_id = t.spotify_id
    WHERE (unaccent(t.name) LIKE ${'%' + term + '%'}
           OR unaccent(ar.name) LIKE ${'%' + term + '%'})
      AND t.spotify_id NOT LIKE 'import:%'
      AND t.spotify_id NOT LIKE 'local:%'
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
