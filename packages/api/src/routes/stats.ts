import { Hono } from 'hono';
import { sql, eq, desc, and, gte } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { listeningHistory, tracks, artists, trackArtists, albums } from '../db/schema.js';
import { TIME_RANGES, DEFAULT_PAGE_LIMIT } from '../constants.js';
import type { TimeRange } from '../constants.js';

const stats = new Hono();

// cache: para cada track, el álbum canónico (preferir álbum completo sobre single)
let bestAlbumMap: Map<string, string> = new Map();
let bestAlbumCacheTime = 0;
const BEST_ALBUM_CACHE_TTL = 60 * 60_000; // 1h

function getBestAlbumMap(): Map<string, string> {
  if (Date.now() - bestAlbumCacheTime < BEST_ALBUM_CACHE_TTL) return bestAlbumMap;
  try {
    const db = getDb();
    // para cada grupo de tracks (mismo nombre + artista principal), encontrar el mejor álbum
    const groups = db.all(sql`
      SELECT t.spotify_id as track_id, t.album_id, LOWER(t.name) as track_name,
             pa.artist_id, a.album_type
      FROM tracks t
      JOIN track_artists pa ON pa.track_id = t.spotify_id AND pa.position = 0
      LEFT JOIN albums a ON a.spotify_id = t.album_id
      WHERE t.album_id IS NOT NULL
    `) as { track_id: string; album_id: string; track_name: string; artist_id: string; album_type: string | null }[];

    // agrupar por nombre+artista
    const canonical = new Map<string, { album_id: string; album_type: string | null; tracks: string[] }[]>();
    for (const row of groups) {
      const key = `${row.track_name}|${row.artist_id}`;
      if (!canonical.has(key)) canonical.set(key, []);
      canonical.get(key)!.push({ album_id: row.album_id, album_type: row.album_type, tracks: [row.track_id] });
    }

    const newMap = new Map<string, string>();
    for (const [, entries] of canonical) {
      if (entries.length <= 1) continue; // sin duplicados
      // encontrar el mejor álbum: album > null > compilation > single
      const best = entries.reduce((a, b) => {
        const scoreA = a.album_type === 'album' ? 0 : a.album_type === 'single' ? 3 : a.album_type === 'compilation' ? 2 : 1;
        const scoreB = b.album_type === 'album' ? 0 : b.album_type === 'single' ? 3 : b.album_type === 'compilation' ? 2 : 1;
        return scoreA <= scoreB ? a : b;
      });
      // mapear todos los tracks de este grupo al mejor álbum
      for (const entry of entries) {
        if (entry.album_id !== best.album_id) {
          for (const tid of entry.tracks) {
            newMap.set(tid, best.album_id);
          }
        }
      }
    }

    bestAlbumMap = newMap;
    bestAlbumCacheTime = Date.now();
    console.log(`[stats] cache best-album: ${bestAlbumMap.size} tracks remapeados`);
  } catch (err) {
    console.error('[stats] error calculando best-album:', err);
  }
  return bestAlbumMap;
}

// precalcular en background al arrancar
setTimeout(() => getBestAlbumMap(), 5000);

// helper: calcular fecha de inicio según rango
function getRangeStart(range: TimeRange): string | null {
  const days = TIME_RANGES[range];
  if (days === 0) return null; // "all"
  if (days === -1) return new Date(Date.UTC(new Date().getFullYear(), 0, 1)).toISOString(); // "thisYear"
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
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
  const { limit, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  const orderBy = sort === 'plays' ? sql`play_count` : sql`total_ms`;

  // agrupar por nombre+artista para unificar versiones (single, álbum, compilación)
  const rows = db.all(sql`
    SELECT LOWER(t.name) as track_name, pa.artist_id as primary_artist_id,
           count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    JOIN track_artists pa ON pa.track_id = t.spotify_id AND pa.position = 0
    ${whereClause}
    GROUP BY track_name, primary_artist_id
    ORDER BY ${orderBy} DESC
    LIMIT ${limit}
  `) as { track_name: string; primary_artist_id: string; play_count: number; total_ms: number }[];

  const result = rows.map(row => {
    // representante: preferir ID real de Spotify y álbum completo sobre single
    const rep = db.get(sql`
      SELECT t.spotify_id FROM tracks t
      JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
      LEFT JOIN albums a ON a.spotify_id = t.album_id
      WHERE LOWER(t.name) = ${row.track_name} AND ta.artist_id = ${row.primary_artist_id}
      ORDER BY
        CASE WHEN t.spotify_id NOT LIKE 'import:%' AND t.spotify_id NOT LIKE 'local:%' THEN 0 ELSE 1 END,
        CASE WHEN a.album_type = 'album' THEN 0 WHEN a.album_type = 'single' THEN 1 ELSE 2 END
      LIMIT 1
    `) as { spotify_id: string } | undefined;
    if (!rep) return null;

    const track = db.select().from(tracks).where(eq(tracks.spotifyId, rep.spotify_id)).get();
    const album = track?.albumId
      ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
      : null;
    const artRows = db
      .select()
      .from(trackArtists)
      .where(eq(trackArtists.trackId, rep.spotify_id))
      .all();
    const arts = artRows
      .sort((a, b) => a.position - b.position)
      .map(ta => db.select().from(artists).where(eq(artists.spotifyId, ta.artistId)).get())
      .filter(Boolean);

    return {
      trackId: rep.spotify_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      track: track ? {
        name: track.name,
        durationMs: track.durationMs,
        album: album ? { name: album.name, imageUrl: album.imageUrl } : null,
        artists: arts.map(a => ({ id: a!.spotifyId, name: a!.name })),
      } : null,
    };
  }).filter(Boolean);

  return c.json(result);
});

stats.get('/top-artists', (c) => {
  const { limit, rangeStart, sort } = parseParams(c);
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

  const result = rows.map(row => {
    const artist = db.select().from(artists).where(eq(artists.spotifyId, row.artist_id)).get();
    return {
      artistId: row.artist_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      artist: artist ? { name: artist.name, imageUrl: artist.imageUrl, genres: artist.genres } : null,
    };
  });

  return c.json(result);
});

stats.get('/top-albums', (c) => {
  const { limit, rangeStart, sort } = parseParams(c);
  const db = getDb();

  const whereClause = rangeStart
    ? sql`WHERE lh.played_at >= ${rangeStart}`
    : sql``;

  const orderBy = sort === 'plays' ? sql`play_count` : sql`total_ms`;
  const bestAlbum = getBestAlbumMap();

  const rows = db.all(sql`
    SELECT t.album_id, lh.track_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${whereClause}
    GROUP BY lh.track_id
  `) as { album_id: string; track_id: string; play_count: number; total_ms: number }[];

  // agrupar por álbum canónico (redirigir singles al álbum completo)
  const albumMap = new Map<string, { play_count: number; total_ms: number }>();
  for (const row of rows) {
    const albumId = bestAlbum.get(row.track_id) ?? row.album_id;
    if (!albumId) continue;
    const existing = albumMap.get(albumId) || { play_count: 0, total_ms: 0 };
    existing.play_count += row.play_count;
    existing.total_ms += row.total_ms;
    albumMap.set(albumId, existing);
  }

  // ordenar y limitar
  const sorted = [...albumMap.entries()]
    .sort((a, b) => sort === 'plays' ? b[1].play_count - a[1].play_count : b[1].total_ms - a[1].total_ms)
    .slice(0, limit);

  const result = sorted.map(([albumId, stats]) => {
    const album = db.select().from(albums).where(eq(albums.spotifyId, albumId)).get();
    return {
      albumId,
      playCount: stats.play_count,
      totalMs: stats.total_ms,
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

  // top tracks (agrupados por nombre para unificar versiones)
  const trackOrderBy = sort === 'plays' ? sql`play_count` : sql`total_ms`;
  const topTracks = db.all(sql`
    SELECT LOWER(t.name) as track_name, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ta.artist_id = ${id} ${whereRange}
    GROUP BY track_name
    ORDER BY ${trackOrderBy} DESC
    LIMIT ${trackLimit}
  `) as { track_name: string; play_count: number; total_ms: number }[];

  const topTracksResult = topTracks.map(row => {
    // representante: preferir ID real y álbum completo
    const rep = db.get(sql`
      SELECT t.spotify_id FROM tracks t
      JOIN track_artists ta ON ta.track_id = t.spotify_id
      LEFT JOIN albums a ON a.spotify_id = t.album_id
      WHERE LOWER(t.name) = ${row.track_name} AND ta.artist_id = ${id}
      ORDER BY
        CASE WHEN t.spotify_id NOT LIKE 'import:%' AND t.spotify_id NOT LIKE 'local:%' THEN 0 ELSE 1 END,
        CASE WHEN a.album_type = 'album' THEN 0 WHEN a.album_type = 'single' THEN 1 ELSE 2 END
      LIMIT 1
    `) as { spotify_id: string } | undefined;
    if (!rep) return null;

    const track = db.select().from(tracks).where(eq(tracks.spotifyId, rep.spotify_id)).get();
    const album = track?.albumId
      ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
      : null;
    return {
      trackId: rep.spotify_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      track: track ? {
        name: track.name,
        durationMs: track.durationMs,
        album: album ? { name: album.name, imageUrl: album.imageUrl } : null,
        artists: [{ id: artist.spotifyId, name: artist.name }],
      } : null,
    };
  }).filter(Boolean);

  const bestAlbum = getBestAlbumMap();
  const artistAlbumRows = db.all(sql`
    SELECT t.album_id, lh.track_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN track_artists ta ON ta.track_id = lh.track_id
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ta.artist_id = ${id} AND t.album_id IS NOT NULL ${whereRange}
    GROUP BY lh.track_id
  `) as { album_id: string; track_id: string; play_count: number; total_ms: number }[];

  // agrupar por álbum canónico
  const artistAlbumMap = new Map<string, { play_count: number; total_ms: number }>();
  for (const row of artistAlbumRows) {
    const albumId = bestAlbum.get(row.track_id) ?? row.album_id;
    const existing = artistAlbumMap.get(albumId) || { play_count: 0, total_ms: 0 };
    existing.play_count += row.play_count;
    existing.total_ms += row.total_ms;
    artistAlbumMap.set(albumId, existing);
  }

  const topAlbumsResult = [...artistAlbumMap.entries()]
    .sort((a, b) => sort === 'plays' ? b[1].play_count - a[1].play_count : b[1].total_ms - a[1].total_ms)
    .slice(0, albumLimit)
    .map(([albumId, stats]) => {
      const album = db.select().from(albums).where(eq(albums.spotifyId, albumId)).get();
      return {
        albumId,
        playCount: stats.play_count,
        totalMs: stats.total_ms,
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
        album: album ? { name: album.name, imageUrl: album.imageUrl } : null,
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
      album: { name: album.name, imageUrl: album.imageUrl },
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
        album: { name: album.name, imageUrl: album.imageUrl },
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

  // encontrar todos los track_ids hermanos (mismo nombre + mismo artista principal)
  const primaryArtist = artRows.find(a => a.position === 0);
  const siblingFilter = primaryArtist
    ? sql`lh.track_id IN (
        SELECT t2.spotify_id FROM tracks t2
        JOIN track_artists ta2 ON ta2.track_id = t2.spotify_id AND ta2.position = 0
        WHERE LOWER(t2.name) = LOWER(${track.name}) AND ta2.artist_id = ${primaryArtist.artistId}
      )`
    : sql`lh.track_id = ${id}`;

  const whereRange = rangeStart
    ? sql`AND lh.played_at >= ${rangeStart}`
    : sql``;

  // stats agregados (todas las versiones)
  const statsRow = db.all(sql`
    SELECT count(*) as play_count, coalesce(sum(t.duration_ms), 0) as total_ms,
           min(lh.played_at) as first_played, max(lh.played_at) as last_played
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${siblingFilter} ${whereRange}
  `)[0] as { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };

  // serie temporal diaria (todas las versiones)
  const dailySeries = db.all(sql`
    SELECT date(lh.played_at) as day, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${siblingFilter} ${whereRange}
    GROUP BY day
    ORDER BY day ASC
  `) as { day: string; play_count: number; total_ms: number }[];

  // desglose por álbum (en qué álbumes se escuchó este track)
  const albumBreakdown = db.all(sql`
    SELECT t.album_id, count(*) as play_count, sum(t.duration_ms) as total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE ${siblingFilter} ${whereRange}
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

export default stats;
