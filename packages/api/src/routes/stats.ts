import { Hono } from 'hono';
import { sql, eq, desc, and, gte } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { listeningHistory, tracks, artists, trackArtists, albums } from '../db/schema.js';
import { TIME_RANGES, DEFAULT_PAGE_LIMIT } from '../constants.js';
import type { TimeRange } from '../constants.js';

const stats = new Hono();

// helper: calcular fecha de inicio según rango
function getRangeStart(range: TimeRange): string | null {
  const days = TIME_RANGES[range];
  if (days === 0) return null; // "all"
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// helper: extraer parámetros comunes
function parseParams(c: any) {
  const range = (c.req.query('range') || 'month') as TimeRange;
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 200);
  const rangeStart = getRangeStart(range);
  return { range, limit, rangeStart };
}

stats.get('/top-tracks', (c) => {
  const { limit, rangeStart } = parseParams(c);
  const db = getDb();

  const conditions = rangeStart
    ? and(gte(listeningHistory.playedAt, rangeStart))
    : undefined;

  const rows = db
    .select({
      trackId: listeningHistory.trackId,
      playCount: sql<number>`count(*)`.as('play_count'),
    })
    .from(listeningHistory)
    .where(conditions)
    .groupBy(listeningHistory.trackId)
    .orderBy(desc(sql`play_count`))
    .limit(limit)
    .all();

  const result = rows.map(row => {
    const track = db.select().from(tracks).where(eq(tracks.spotifyId, row.trackId)).get();
    const album = track?.albumId
      ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
      : null;
    const artRows = db
      .select()
      .from(trackArtists)
      .where(eq(trackArtists.trackId, row.trackId))
      .all();
    const arts = artRows
      .sort((a, b) => a.position - b.position)
      .map(ta => db.select().from(artists).where(eq(artists.spotifyId, ta.artistId)).get())
      .filter(Boolean);

    return {
      trackId: row.trackId,
      playCount: row.playCount,
      track: track ? {
        name: track.name,
        durationMs: track.durationMs,
        album: album ? { name: album.name, imageUrl: album.imageUrl } : null,
        artists: arts.map(a => ({ id: a!.spotifyId, name: a!.name })),
      } : null,
    };
  });

  return c.json(result);
});

stats.get('/top-artists', (c) => {
  const { limit, rangeStart } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  const rows = db.all(sql`
    SELECT ta.artist_id, count(*) as play_count
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    ${whereClause}
    GROUP BY ta.artist_id
    ORDER BY play_count DESC
    LIMIT ${limit}
  `) as { artist_id: string; play_count: number }[];

  const result = rows.map(row => {
    const artist = db.select().from(artists).where(eq(artists.spotifyId, row.artist_id)).get();
    return {
      artistId: row.artist_id,
      playCount: row.play_count,
      artist: artist ? { name: artist.name, imageUrl: artist.imageUrl, genres: artist.genres } : null,
    };
  });

  return c.json(result);
});

stats.get('/top-albums', (c) => {
  const { limit, rangeStart } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  const rows = db.all(sql`
    SELECT t.album_id, count(*) as play_count
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause}
    GROUP BY t.album_id
    ORDER BY play_count DESC
    LIMIT ${limit}
  `) as { album_id: string; play_count: number }[];

  const result = rows.map(row => {
    const album = db.select().from(albums).where(eq(albums.spotifyId, row.album_id)).get();
    return {
      albumId: row.album_id,
      playCount: row.play_count,
      album: album ? { name: album.name, imageUrl: album.imageUrl, releaseDate: album.releaseDate } : null,
    };
  });

  return c.json(result);
});

stats.get('/top-genres', (c) => {
  const { limit, rangeStart } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  // json_each() para "desempacar" el array de géneros de cada artista
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

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  // agrupar por día, semana o mes usando funciones de fecha de sqlite
  const dateTrunc = granularity === 'month'
    ? sql`strftime('%Y-%m', lh.played_at)`
    : granularity === 'week'
    ? sql`strftime('%Y-W%W', lh.played_at)`
    : sql`date(lh.played_at)`;

  const rows = db.all(sql`
    SELECT ${dateTrunc} as period,
           count(*) as play_count,
           sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause}
    GROUP BY period
    ORDER BY period ASC
  `) as { period: string; play_count: number; total_ms: number }[];

  return c.json(rows);
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
    const track = db.select().from(tracks).where(eq(tracks.spotifyId, row.trackId)).get();
    const album = track?.albumId
      ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
      : null;
    const artRows = db.select().from(trackArtists).where(eq(trackArtists.trackId, row.trackId)).all();
    const arts = artRows
      .sort((a, b) => a.position - b.position)
      .map(ta => db.select().from(artists).where(eq(artists.spotifyId, ta.artistId)).get())
      .filter(Boolean);

    return {
      id: row.id,
      playedAt: row.playedAt,
      contextType: row.contextType,
      track: track ? {
        id: track.spotifyId,
        name: track.name,
        durationMs: track.durationMs,
        album: album ? { name: album.name, imageUrl: album.imageUrl } : null,
        artists: arts.map(a => ({ id: a!.spotifyId, name: a!.name })),
      } : null,
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

  // matriz 24×7: hora del día × día de la semana (0=domingo)
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

  // obtener todos los días con al menos una reproducción
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

  // racha actual: contar hacia atrás desde hoy
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

  return c.json({
    currentStreak,
    longestStreak,
    totalDays: days.length,
  });
});

export default stats;
