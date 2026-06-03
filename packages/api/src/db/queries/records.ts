// Records semanales basados en chart_data (ranking ROW_NUMBER por semana).
// Para records extendidos (longevidad, descubrimiento, accolades, year-end)
// ver records-extended.ts — los compute* helpers de allí son la mitad del fichero.

import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type {
  RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData,
  RecordsResponse, RankingMetric, WeekStartOption, EntityType,
} from '@sis/shared';
import { resolvedEntityId, entityMergeJoin, userFilter, resolvedPlayJoins, playDuration, periodExpr } from './helpers.js';
import { CHART_SIZE } from '../../constants.js';
import {
  computeLongestGap, computeGoldenOldies, computeLatestDiscoveries,
  computeMostUniquePerMonth, computeMostDistinctTracks, computeOneHitWonders,
  computeTopNoAlbum, computeYearEndFinishes, computeMostAccolades,
} from './records-extended.js';

// records semanales solo permiten 'time' o 'plays' — no usan 'natural' (irrelevante para charts).
type Sort = RankingMetric;
// alias para legibilidad — apunta al tipo canónico de @sis/shared.
type WeekStart = WeekStartOption;

const PROFILE = process.env.RECORDS_PROFILE !== '0';
function timed<T>(label: string, fn: () => T): T {
  if (!PROFILE) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    const ms = (performance.now() - start).toFixed(0);
    console.log(`[records-timing] ${label}: ${ms}ms`);
  }
}

const weekExpr = (ws: WeekStart) => periodExpr('week', ws);

// --- queries de records semanales (peak/debuts/weeks-at-#1/etc.) ---

function getTrackRecords(db: Db, ws: WeekStart, sort: Sort, limit: number, userId: number): TrackRecords {
  const week = weekExpr(ws);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;
  const uf = userFilter(userId);
  const trackMrJoin = entityMergeJoin('track', userId);

  const ranked = db.all(sql`
    WITH weekly AS (
      SELECT ${week} as w, ${resolvedEntityId('track', userId)} as eid, ${metric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${week} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${trackMrJoin}
      WHERE 1=1 ${uf}
      GROUP BY w, eid
    ),
    first_week AS (
      SELECT eid, MIN(w) as debut_week FROM weekly GROUP BY eid
    )
    SELECT w.*, fw.debut_week,
           t.name, al.image_url,
           (SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = w.eid AND ta.position = 0 LIMIT 1) as artist_id,
           (SELECT a.name FROM track_artists ta JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = w.eid AND ta.position = 0 LIMIT 1) as artist_name
    FROM weekly w
    JOIN first_week fw ON fw.eid = w.eid
    JOIN tracks t ON t.spotify_id = w.eid
    LEFT JOIN albums al ON al.spotify_id = t.album_id
  `) as any[];

  const base = deriveRecords(ranked, limit);
  base.inMostPlaylists = db.all(sql`
    SELECT spt.track_id as entityId, t.name, al.image_url as imageUrl,
           (SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = spt.track_id AND ta.position = 0 LIMIT 1) as artistId,
           (SELECT a.name FROM track_artists ta JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = spt.track_id AND ta.position = 0 LIMIT 1) as artistName,
           COUNT(DISTINCT spt.playlist_id) as value
    FROM spotify_playlist_tracks spt
    JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
    JOIN tracks t ON t.spotify_id = spt.track_id
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    GROUP BY spt.track_id
    HAVING value > 1
    ORDER BY value DESC
    LIMIT ${limit}
  `) as RecordEntry[];

  const result: TrackRecords = {
    ...base,
    longestGap: timed('track.longestGap', () => computeLongestGap('track', db, userId, limit)),
    goldenOldies: timed('track.goldenOldies', () => computeGoldenOldies('track', db, userId, limit)),
    latestDiscoveries: timed('track.latestDiscoveries', () => computeLatestDiscoveries('track', db, userId, limit)),
    mostUniquePerMonth: timed('track.mostUniquePerMonth', () => computeMostUniquePerMonth('track', db, userId, limit)),
    topNoAlbum: timed('track.topNoAlbum', () => computeTopNoAlbum(db, userId, limit)),
    yearEndFinishes: timed('track.yearEndFinishes', () => computeYearEndFinishes('track', db, userId, sort)),
    mostAccolades: [],
  };
  result.mostAccolades = computeMostAccolades(result);
  return result;
}

function getAlbumRecords(db: Db, ws: WeekStart, sort: Sort, limit: number, userId: number): AlbumRecords {
  const week = weekExpr(ws);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;
  const uf = userFilter(userId);

  const ranked = db.all(sql`
    WITH weekly AS (
      SELECT ${week} as w, ${resolvedEntityId('album', userId)} as eid, ${metric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${week} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      ${resolvedPlayJoins('album', userId)}
      WHERE t.album_id IS NOT NULL ${uf}
      Group by w, eid
    ),
    first_week AS (
      SELECT eid, MIN(w) as debut_week FROM weekly GROUP BY eid
    )
    SELECT w.*, fw.debut_week,
           al.name, al.image_url,
           (SELECT ta.artist_id FROM tracks t2 JOIN track_artists ta ON ta.track_id = t2.spotify_id AND ta.position = 0
            WHERE t2.album_id = w.eid LIMIT 1) as artist_id,
           (SELECT a.name FROM tracks t2 JOIN track_artists ta ON ta.track_id = t2.spotify_id AND ta.position = 0
            JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE t2.album_id = w.eid LIMIT 1) as artist_name
    FROM weekly w
    JOIN first_week fw ON fw.eid = w.eid
    JOIN albums al ON al.spotify_id = w.eid
  `) as any[];

  const base = deriveRecords(ranked, limit);
  base.inMostPlaylists = db.all(sql`
    SELECT t.album_id as entityId, al.name, al.image_url as imageUrl,
           (SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = t.spotify_id AND ta.position = 0 LIMIT 1) as artistId,
           (SELECT a.name FROM track_artists ta JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = t.spotify_id AND ta.position = 0 LIMIT 1) as artistName,
           COUNT(DISTINCT spt.playlist_id) as value
    FROM spotify_playlist_tracks spt
    JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
    JOIN tracks t ON t.spotify_id = spt.track_id
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    WHERE t.album_id IS NOT NULL
    GROUP BY t.album_id
    HAVING value > 1
    ORDER BY value DESC
    LIMIT ${limit}
  `) as RecordEntry[];

  const result: AlbumRecords = {
    ...base,
    longestGap: timed('album.longestGap', () => computeLongestGap('album', db, userId, limit)),
    goldenOldies: timed('album.goldenOldies', () => computeGoldenOldies('album', db, userId, limit)),
    latestDiscoveries: timed('album.latestDiscoveries', () => computeLatestDiscoveries('album', db, userId, limit)),
    mostUniquePerMonth: timed('album.mostUniquePerMonth', () => computeMostUniquePerMonth('album', db, userId, limit)),
    mostDistinctTracks: timed('album.mostDistinctTracks', () => computeMostDistinctTracks('album', db, userId, limit)),
    yearEndFinishes: timed('album.yearEndFinishes', () => computeYearEndFinishes('album', db, userId, sort)),
    mostAccolades: [],
  };
  result.mostAccolades = computeMostAccolades(result);
  return result;
}

function getArtistRecords(db: Db, ws: WeekStart, sort: Sort, limit: number, userId: number): ArtistRecordsData {
  const week = weekExpr(ws);
  const uf = userFilter(userId);
  const metricDedup = sort === 'plays' ? sql`count(*)` : sql`sum(duration_ms)`;
  const mrArtistJoin = entityMergeJoin('artist', userId);

  // dedupe plays a nivel de (w, eid, lh.id) — evita doble count cuando múltiples artists
  // de una track acaban mergeados al mismo target
  const ranked = db.all(sql`
    WITH plays_dedup AS (
      SELECT DISTINCT ${week} as w, ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, ${playDuration()} as duration_ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      JOIN track_artists ta ON ta.track_id = lh.track_id
      ${mrArtistJoin}
      WHERE lh.user_id = ${userId}
    ),
    weekly AS (
      SELECT w, eid, ${metricDedup} as val,
             ROW_NUMBER() OVER (PARTITION BY w ORDER BY ${metricDedup} DESC) as rank
      FROM plays_dedup
      GROUP BY w, eid
    ),
    first_week AS (
      SELECT eid, MIN(w) as debut_week FROM weekly GROUP BY eid
    )
    SELECT w.*, fw.debut_week,
           a.name, a.image_url, NULL as artist_name
    FROM weekly w
    JOIN first_week fw ON fw.eid = w.eid
    JOIN artists a ON a.spotify_id = w.eid
  `) as any[];

  const base = deriveRecords(ranked, limit);

  // artistas con más tracks en #1 (por semana)
  const trackWeek = weekExpr(ws);
  const trackMetric = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;

  // artistResolveJoin y resolved devuelven el artist_id canónico (target si mergeado)
  const artistResolveJoin = sql`LEFT JOIN merge_rules mr_artist ON mr_artist.entity_type = 'artist' AND mr_artist.source_id = ta.artist_id AND mr_artist.user_id = ${userId}`;
  const resolvedTa = sql`COALESCE(mr_artist.target_id, ta.artist_id)`;

  const mostNo1Tracks = db.all(sql`
    WITH weekly_tracks AS (
      SELECT ${trackWeek} as w, lh.track_id as tid, ${trackMetric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${trackWeek} ORDER BY ${trackMetric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE 1=1 ${uf}
      GROUP BY w, lh.track_id
    )
    SELECT ${resolvedTa} as artistId, a.name, a.image_url as imageUrl, COUNT(DISTINCT wt.tid) as count
    FROM weekly_tracks wt
    JOIN track_artists ta ON ta.track_id = wt.tid AND ta.position = 0
    ${artistResolveJoin}
    JOIN artists a ON a.spotify_id = ${resolvedTa}
    WHERE wt.rank = 1
    GROUP BY ${resolvedTa}
    ORDER BY count DESC
    LIMIT ${limit}
  `) as ArtistRecordEntry[];

  const mostNo1Albums = db.all(sql`
    WITH weekly_albums AS (
      SELECT ${trackWeek} as w, ${resolvedEntityId('album', userId)} as aid, ${trackMetric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${trackWeek} ORDER BY ${trackMetric} DESC) as rank
      FROM listening_history lh
      ${resolvedPlayJoins('album', userId)}
      WHERE t.album_id IS NOT NULL ${uf}
      GROUP BY w, aid
    )
    SELECT ${resolvedTa} as artistId, a.name, a.image_url as imageUrl, COUNT(DISTINCT wa.aid) as count
    FROM weekly_albums wa
    JOIN tracks t2 ON t2.album_id = wa.aid
    JOIN track_artists ta ON ta.track_id = t2.spotify_id AND ta.position = 0
    ${artistResolveJoin}
    JOIN artists a ON a.spotify_id = ${resolvedTa}
    WHERE wa.rank = 1
    GROUP BY ${resolvedTa}
    ORDER BY count DESC
    LIMIT ${limit}
  `) as ArtistRecordEntry[];

  base.inMostPlaylists = db.all(sql`
    SELECT ${resolvedTa} as entityId, a.name, a.image_url as imageUrl, NULL as artistId, NULL as artistName,
           COUNT(DISTINCT spt.playlist_id) as value
    FROM spotify_playlist_tracks spt
    JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
    JOIN track_artists ta ON ta.track_id = spt.track_id AND ta.position = 0
    ${artistResolveJoin}
    JOIN artists a ON a.spotify_id = ${resolvedTa}
    GROUP BY ${resolvedTa}
    ORDER BY value DESC
    LIMIT ${limit}
  `) as RecordEntry[];

  const result: ArtistRecordsData = {
    ...base,
    mostNo1Tracks,
    mostNo1Albums,
    longestGap: timed('artist.longestGap', () => computeLongestGap('artist', db, userId, limit)),
    goldenOldies: timed('artist.goldenOldies', () => computeGoldenOldies('artist', db, userId, limit)),
    latestDiscoveries: timed('artist.latestDiscoveries', () => computeLatestDiscoveries('artist', db, userId, limit)),
    mostUniquePerMonth: timed('artist.mostUniquePerMonth', () => computeMostUniquePerMonth('artist', db, userId, limit)),
    mostDistinctTracks: timed('artist.mostDistinctTracks', () => computeMostDistinctTracks('artist', db, userId, limit)),
    oneHitWonders: timed('artist.oneHitWonders', () => computeOneHitWonders('artist', db, userId, limit)),
    yearEndFinishes: timed('artist.yearEndFinishes', () => computeYearEndFinishes('artist', db, userId, sort)),
    mostAccolades: [],
  };
  result.mostAccolades = computeMostAccolades(result);
  return result;
}

// --- helper: derivar records desde filas de ranking semanal ---

function deriveRecords(rows: any[], limit: number): EntityRecords {
  // agrupar por entidad
  const byEntity = new Map<string, { rows: any[]; debutWeek: string; name: string; imageUrl: string | null; artistId: string | null; artistName: string | null }>();
  for (const r of rows) {
    if (!byEntity.has(r.eid)) {
      byEntity.set(r.eid, { rows: [], debutWeek: r.debut_week, name: r.name, imageUrl: r.image_url, artistId: r.artist_id ?? null, artistName: r.artist_name });
    }
    byEntity.get(r.eid)!.rows.push(r);
  }

  // 1. Peak week plays
  const peakWeekPlays: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const best = data.rows.reduce((a: any, b: any) => a.val > b.val ? a : b);
    peakWeekPlays.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: best.val, week: best.w });
  }
  peakWeekPlays.sort((a, b) => b.value - a.value);

  // 2. Biggest debuts
  const biggestDebuts: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const debut = data.rows.find((r: any) => r.w === data.debutWeek);
    if (debut) {
      biggestDebuts.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: debut.val, week: debut.w });
    }
  }
  biggestDebuts.sort((a, b) => b.value - a.value);

  // 3. Most weeks at #1
  const mostWeeksAtNo1: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const weeks = data.rows.filter((r: any) => r.rank === 1).length;
    if (weeks > 0) {
      mostWeeksAtNo1.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: weeks, week: null });
    }
  }
  mostWeeksAtNo1.sort((a, b) => b.value - a.value);

  // 4. Most weeks in the charts (top 25)
  const mostWeeksInTop5: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const weeks = data.rows.filter((r: any) => r.rank <= CHART_SIZE).length;
    if (weeks > 0) {
      mostWeeksInTop5.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: weeks, week: null });
    }
  }
  mostWeeksInTop5.sort((a, b) => b.value - a.value);

  // 5. Longest consecutive run on the charts (top 25)
  const allWeekLabels = [...new Set(rows.map((r: any) => r.w as string))].sort();
  const longestChartRun: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const chartWeekSet = new Set(
      data.rows.filter((r: any) => r.rank <= CHART_SIZE).map((r: any) => r.w as string)
    );
    if (chartWeekSet.size === 0) continue;

    let maxStreak = 0, curStreak = 0;
    let endsAtLatest = false;
    let bestStart = '', bestEnd = '';
    let curStart = '';
    for (const w of allWeekLabels) {
      if (chartWeekSet.has(w)) {
        if (curStreak === 0) curStart = w;
        curStreak++;
      } else {
        if (curStreak > maxStreak) {
          maxStreak = curStreak;
          bestStart = curStart;
          bestEnd = allWeekLabels[allWeekLabels.indexOf(w) - 1];
          endsAtLatest = false;
        }
        curStreak = 0;
      }
    }
    if (curStreak > maxStreak) {
      maxStreak = curStreak;
      bestStart = curStart;
      bestEnd = allWeekLabels[allWeekLabels.length - 1];
      endsAtLatest = true;
    } else if (curStreak === maxStreak && curStreak > 0) {
      bestStart = curStart;
      bestEnd = allWeekLabels[allWeekLabels.length - 1];
      endsAtLatest = true;
    }

    if (maxStreak > 0) {
      longestChartRun.push({
        entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName,
        value: maxStreak,
        week: endsAtLatest ? 'active' : null,
        date: bestStart,
        endDate: bestEnd,
        ongoing: endsAtLatest,
      });
    }
  }
  longestChartRun.sort((a, b) => b.value - a.value);

  return {
    peakWeekPlays: peakWeekPlays.slice(0, limit),
    biggestDebuts: biggestDebuts.slice(0, limit),
    mostWeeksAtNo1: mostWeeksAtNo1.slice(0, limit),
    mostWeeksInTop5: mostWeeksInTop5.slice(0, limit),
    longestChartRun: longestChartRun.slice(0, limit),
    inMostPlaylists: [],
    // placeholders — las funciones getXxxRecords los sobrescriben
    longestGap: [],
    goldenOldies: [],
    latestDiscoveries: [],
    mostUniquePerMonth: [],
    yearEndFinishes: [],
    mostAccolades: [],
  };
}

// --- función principal ---

export type EntityTypeFilter = EntityType;

export function getRecords(db: Db, weekStart: WeekStart = 'monday', sort: Sort = 'time', limit = 10, type: EntityTypeFilter | undefined, userId: number): Partial<RecordsResponse> {
  if (type === 'track') return { tracks: getTrackRecords(db, weekStart, sort, limit, userId) };
  if (type === 'album') return { albums: getAlbumRecords(db, weekStart, sort, limit, userId) };
  if (type === 'artist') return { artists: getArtistRecords(db, weekStart, sort, limit, userId) };
  return {
    tracks: getTrackRecords(db, weekStart, sort, limit, userId),
    albums: getAlbumRecords(db, weekStart, sort, limit, userId),
    artists: getArtistRecords(db, weekStart, sort, limit, userId),
  };
}
