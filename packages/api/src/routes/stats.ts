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
  if (days === -1) return new Date(Date.UTC(new Date().getFullYear(), 0, 1)).toISOString(); // "thisYear"
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// helper: calcular rango del periodo anterior (para comparar posiciones)
function getPreviousPeriodRange(range: TimeRange): { prevStart: string; prevEnd: string } | null {
  const days = TIME_RANGES[range];
  if (days === 0) return null; // "all" — sin periodo anterior

  if (days === -1) {
    // "thisYear" — comparar con el mismo rango del año anterior
    const now = new Date();
    const year = now.getFullYear();
    const prevStart = new Date(Date.UTC(year - 1, 0, 1)).toISOString();
    const prevEnd = new Date(Date.UTC(year - 1, now.getMonth(), now.getDate())).toISOString();
    return { prevStart, prevEnd };
  }

  // periodo anterior de la misma duración
  const now = new Date();
  const prevEnd = new Date(now);
  prevEnd.setDate(prevEnd.getDate() - days);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days);
  return { prevStart: prevStart.toISOString(), prevEnd: prevEnd.toISOString() };
}

// helper: extraer parámetros comunes
function parseParams(c: any) {
  const range = (c.req.query('range') || 'month') as TimeRange;
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 200);
  const rangeStart = getRangeStart(range);
  const sort = c.req.query('sort') === 'plays' ? 'plays' : 'time';
  return { range, limit, rangeStart, sort };
}

stats.get('/top-tracks', (c) => {
  const { range, limit, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  const orderBy = sort === 'plays' ? sql`play_count` : sql`total_ms`;

  const rows = db.all(sql`
    SELECT lh.track_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause}
    GROUP BY lh.track_id
    ORDER BY ${orderBy} DESC
    LIMIT ${limit}
  `) as { track_id: string; play_count: number; total_ms: number }[];

  // ranking del periodo anterior para detectar cambios de posición
  const prev = getPreviousPeriodRange(range);
  const prevRankMap = new Map<string, number>();
  if (prev) {
    const prevRows = db.all(sql`
      SELECT lh.track_id, count(*) as play_count, sum(t.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.played_at >= ${prev.prevStart} AND lh.played_at < ${prev.prevEnd}
      GROUP BY lh.track_id
      ORDER BY ${orderBy} DESC
      LIMIT 200
    `) as { track_id: string }[];
    prevRows.forEach((r, i) => prevRankMap.set(r.track_id, i + 1));
  }

  const result = rows.map((row, i) => {
    const track = db.select().from(tracks).where(eq(tracks.spotifyId, row.track_id)).get();
    const album = track?.albumId
      ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
      : null;
    const artRows = db
      .select()
      .from(trackArtists)
      .where(eq(trackArtists.trackId, row.track_id))
      .all();
    const arts = artRows
      .sort((a, b) => a.position - b.position)
      .map(ta => db.select().from(artists).where(eq(artists.spotifyId, ta.artistId)).get())
      .filter(Boolean);

    const currentRank = i + 1;
    const previousRank = prevRankMap.get(row.track_id) ?? null;
    const rankChange = prev === null ? null : previousRank === null ? null : previousRank - currentRank;

    return {
      trackId: row.track_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      rankChange,
      previousRank,
      isNew: prev !== null && previousRank === null,
      track: track ? {
        name: track.name,
        durationMs: track.durationMs,
        album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl } : null,
        artists: arts.map(a => ({ id: a!.spotifyId, name: a!.name })),
      } : null,
    };
  }).filter(Boolean);

  return c.json(result);
});

stats.get('/top-artists', (c) => {
  const { range, limit, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  const orderBy = sort === 'plays' ? sql`play_count` : sql`total_ms`;

  const rows = db.all(sql`
    SELECT ta.artist_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause}
    GROUP BY ta.artist_id
    ORDER BY ${orderBy} DESC
    LIMIT ${limit}
  `) as { artist_id: string; play_count: number; total_ms: number }[];

  // ranking del periodo anterior
  const prev = getPreviousPeriodRange(range);
  const prevRankMap = new Map<string, number>();
  if (prev) {
    const prevRows = db.all(sql`
      SELECT ta.artist_id, count(*) as play_count, sum(t.duration_ms) as total_ms
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.played_at >= ${prev.prevStart} AND lh.played_at < ${prev.prevEnd}
      GROUP BY ta.artist_id
      ORDER BY ${orderBy} DESC
      LIMIT 200
    `) as { artist_id: string }[];
    prevRows.forEach((r, i) => prevRankMap.set(r.artist_id, i + 1));
  }

  const result = rows.map((row, i) => {
    const artist = db.select().from(artists).where(eq(artists.spotifyId, row.artist_id)).get();
    const currentRank = i + 1;
    const previousRank = prevRankMap.get(row.artist_id) ?? null;
    const rankChange = prev === null ? null : previousRank === null ? null : previousRank - currentRank;

    return {
      artistId: row.artist_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      rankChange,
      previousRank,
      isNew: prev !== null && previousRank === null,
      artist: artist ? { name: artist.name, imageUrl: artist.imageUrl, genres: artist.genres } : null,
    };
  });

  return c.json(result);
});

stats.get('/top-albums', (c) => {
  const { range, limit, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  const orderBy = sort === 'plays' ? sql`play_count` : sql`total_ms`;

  const rows = db.all(sql`
    SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause}
    GROUP BY t.album_id
    HAVING t.album_id IS NOT NULL
    ORDER BY ${orderBy} DESC
    LIMIT ${limit}
  `) as { album_id: string; play_count: number; total_ms: number }[];

  // ranking del periodo anterior
  const prev = getPreviousPeriodRange(range);
  const prevRankMap = new Map<string, number>();
  if (prev) {
    const prevRows = db.all(sql`
      SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.played_at >= ${prev.prevStart} AND lh.played_at < ${prev.prevEnd}
      GROUP BY t.album_id
      HAVING t.album_id IS NOT NULL
      ORDER BY ${orderBy} DESC
      LIMIT 200
    `) as { album_id: string }[];
    prevRows.forEach((r, i) => prevRankMap.set(r.album_id, i + 1));
  }

  const result = rows.map((row, i) => {
    const album = db.select().from(albums).where(eq(albums.spotifyId, row.album_id)).get();
    const currentRank = i + 1;
    const previousRank = prevRankMap.get(row.album_id) ?? null;
    const rankChange = prev === null ? null : previousRank === null ? null : previousRank - currentRank;

    return {
      albumId: row.album_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      rankChange,
      previousRank,
      isNew: prev !== null && previousRank === null,
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
        album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl } : null,
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

// --- detail endpoints ---

stats.get('/artist/:id', (c) => {
  const id = c.req.param('id');
  const { rangeStart, sort } = parseParams(c);
  const trackLimit = Math.min(parseInt(c.req.query('trackLimit') || '10'), 200);
  const albumLimit = Math.min(parseInt(c.req.query('albumLimit') || '5'), 200);
  const db = getDb();

  const artist = db.select().from(artists).where(eq(artists.spotifyId, id)).get();
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const whereRange = rangeStart
    ? sql`AND lh.played_at >= ${rangeStart}`
    : sql``;

  // stats agregados
  const statsRow = db.all(sql`
    SELECT count(*) as play_count, coalesce(sum(t.duration_ms), 0) as total_ms,
           min(lh.played_at) as first_played, max(lh.played_at) as last_played
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ta.artist_id = ${id} ${whereRange}
  `)[0] as { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };

  const trackOrderBy = sort === 'plays' ? sql`play_count` : sql`total_ms`;
  const topTracks = db.all(sql`
    SELECT lh.track_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ta.artist_id = ${id} ${whereRange}
    GROUP BY lh.track_id
    ORDER BY ${trackOrderBy} DESC
    LIMIT ${trackLimit}
  `) as { track_id: string; play_count: number; total_ms: number }[];

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

  const topAlbumsRows = db.all(sql`
    SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ta.artist_id = ${id} AND t.album_id IS NOT NULL ${whereRange}
    GROUP BY t.album_id
    ORDER BY ${trackOrderBy} DESC
    LIMIT ${albumLimit}
  `) as { album_id: string; play_count: number; total_ms: number }[];

  const topAlbumsResult = topAlbumsRows.map(row => {
    const album = db.select().from(albums).where(eq(albums.spotifyId, row.album_id)).get();
    return {
      albumId: row.album_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      album: album ? { name: album.name, imageUrl: album.imageUrl, releaseDate: album.releaseDate } : null,
    };
  });

  // 10 reproducciones recientes
  const recentPlays = db.all(sql`
    SELECT lh.id, lh.played_at, lh.track_id
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    WHERE ta.artist_id = ${id}
    ORDER BY lh.played_at DESC
    LIMIT 10
  `) as { id: number; played_at: string; track_id: string }[];

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
    topTracks: topTracksResult,
    topAlbums: topAlbumsResult,
    recentPlays: recentResult,
  });
});

stats.get('/album/:id', (c) => {
  const id = c.req.param('id');
  const { rangeStart, sort } = parseParams(c);
  const db = getDb();

  const album = db.select().from(albums).where(eq(albums.spotifyId, id)).get();
  if (!album) return c.json({ error: 'Album not found' }, 404);

  const whereRange = rangeStart
    ? sql`AND lh.played_at >= ${rangeStart}`
    : sql``;

  // artistas del álbum (via tracks)
  const albumArtists = db.all(sql`
    SELECT DISTINCT ta.artist_id, a.name, a.image_url
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.spotify_id
    JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE t.album_id = ${id}
    ORDER BY ta.position ASC
  `) as { artist_id: string; name: string; image_url: string | null }[];

  // stats agregados
  const statsRow = db.all(sql`
    SELECT count(*) as play_count, coalesce(sum(t.duration_ms), 0) as total_ms,
           min(lh.played_at) as first_played, max(lh.played_at) as last_played
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE t.album_id = ${id} ${whereRange}
  `)[0] as { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };

  // todos los tracks del álbum con play counts
  const albumTracks = db.all(sql`
    SELECT t.spotify_id as track_id, t.name, t.duration_ms, t.track_number,
           coalesce(s.play_count, 0) as play_count, coalesce(s.total_ms, 0) as total_ms
    FROM tracks t
    LEFT JOIN (
      SELECT lh.track_id, count(*) as play_count, sum(tr.duration_ms) as total_ms
      FROM listening_history lh
      JOIN tracks tr ON tr.spotify_id = lh.track_id
      WHERE tr.album_id = ${id} ${whereRange}
      GROUP BY lh.track_id
    ) s ON s.track_id = t.spotify_id
    WHERE t.album_id = ${id}
    ORDER BY ${sort === 'plays' ? sql`play_count` : sql`total_ms`} DESC, t.track_number ASC
  `) as { track_id: string; name: string; duration_ms: number; track_number: number | null; play_count: number; total_ms: number }[];

  const tracksResult = albumTracks.map(row => ({
    trackId: row.track_id,
    playCount: row.play_count,
    totalMs: row.total_ms,
    track: {
      name: row.name,
      durationMs: row.duration_ms,
      trackNumber: row.track_number,
      album: { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl },
      artists: albumArtists.map(a => ({ id: a.artist_id, name: a.name })),
    },
  }));

  // 10 reproducciones recientes
  const recentPlays = db.all(sql`
    SELECT lh.id, lh.played_at, lh.track_id
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE t.album_id = ${id}
    ORDER BY lh.played_at DESC
    LIMIT 10
  `) as { id: number; played_at: string; track_id: string }[];

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
        artists: albumArtists.map(a => ({ id: a.artist_id, name: a.name })),
      } : null,
    };
  });

  return c.json({
    album: {
      id: album.spotifyId, name: album.name, imageUrl: album.imageUrl,
      releaseDate: album.releaseDate, totalTracks: album.totalTracks, albumType: album.albumType,
    },
    artists: albumArtists.map(a => ({ id: a.artist_id, name: a.name, imageUrl: a.image_url })),
    stats: statsRow,
    tracks: tracksResult,
    recentPlays: recentResult,
  });
});

stats.get('/track/:id', (c) => {
  const id = c.req.param('id');
  const { rangeStart } = parseParams(c);
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

  const trackFilter = sql`lh.track_id = ${id}`;

  const whereRange = rangeStart
    ? sql`AND lh.played_at >= ${rangeStart}`
    : sql``;

  // stats agregados (todas las versiones)
  const statsRow = db.all(sql`
    SELECT count(*) as play_count, coalesce(sum(t.duration_ms), 0) as total_ms,
           min(lh.played_at) as first_played, max(lh.played_at) as last_played
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${trackFilter} ${whereRange}
  `)[0] as { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };

  // serie temporal diaria (todas las versiones)
  const dailySeries = db.all(sql`
    SELECT date(lh.played_at) as day, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${trackFilter} ${whereRange}
    GROUP BY day
    ORDER BY day ASC
  `) as { day: string; play_count: number; total_ms: number }[];

  // desglose por álbum (en qué álbumes se escuchó este track)
  const albumBreakdown = db.all(sql`
    SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${trackFilter} ${whereRange}
      AND t.album_id IS NOT NULL
    GROUP BY t.album_id
    ORDER BY play_count DESC
  `) as { album_id: string; play_count: number; total_ms: number }[];

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
    dailySeries,
    albumBreakdown: albumBreakdownResult,
  });
});

// --- search ---

stats.get('/search', (c) => {
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2) return c.json({ error: 'query too short' }, 400);

  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 20);
  // normalizar: quitar acentos y minúsculas (coincide con la función unaccent() de SQLite)
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
           COALESCE(s.play_count, 0) as playCount
    FROM albums al
    LEFT JOIN (
      SELECT t.album_id, COUNT(*) as play_count
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE t.album_id IS NOT NULL
      GROUP BY t.album_id
    ) s ON s.album_id = al.spotify_id
    WHERE unaccent(al.name) LIKE ${'%' + term + '%'}
      AND al.spotify_id NOT LIKE 'import:%'
      AND al.spotify_id NOT LIKE 'local:%'
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
