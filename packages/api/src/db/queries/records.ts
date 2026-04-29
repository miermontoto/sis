import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type {
  RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData,
  RecordsResponse, RankingMetric, WeekStartOption, EntityType, MonthCountEntry, YearEndFinish,
} from '@sis/shared';
import { resolvedEntityId, entityMergeJoin, userFilter } from './helpers.js';
import { getTopEntities } from './entity.js';
import { CHART_SIZE, RECORDS_LIMIT } from '../../constants.js';

type Sort = RankingMetric;
type WeekStart = WeekStartOption;

// diagnóstico: envolver queries con timing (desactivable via RECORDS_PROFILE=0)
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

// formato de semana según día de inicio
function weekExpr(ws: WeekStart) {
  if (ws === 'monday') return sql`strftime('%Y-W%W', lh.played_at)`;
  if (ws === 'sunday') return sql`strftime('%Y-W%W', lh.played_at, '-1 day')`;
  return sql`strftime('%Y-W%W', lh.played_at, '-4 days')`;
}

// --- queries existentes de records semanales (peak/debuts/weeks-at-#1/etc.) ---

function getTrackRecords(db: Db, ws: WeekStart, sort: Sort, limit: number, userId: number): TrackRecords {
  const week = weekExpr(ws);
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;
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
    latestNew: timed('track.latestNew', () => computeLatestNew('track', db, userId, limit)),
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
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;
  const uf = userFilter(userId);
  const mrJoin = entityMergeJoin('album', userId);

  const ranked = db.all(sql`
    WITH weekly AS (
      SELECT ${week} as w, ${resolvedEntityId('album', userId)} as eid, ${metric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${week} ORDER BY ${metric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${mrJoin}
      WHERE t.album_id IS NOT NULL ${uf}
      GROUP BY w, eid
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
    latestNew: timed('album.latestNew', () => computeLatestNew('album', db, userId, limit)),
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
      SELECT DISTINCT ${week} as w, ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, t.duration_ms as duration_ms
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
  const trackMetric = sort === 'plays' ? sql`count(*)` : sql`sum(t.duration_ms)`;

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

  const mrJoin = entityMergeJoin('album', userId);
  const mostNo1Albums = db.all(sql`
    WITH weekly_albums AS (
      SELECT ${trackWeek} as w, ${resolvedEntityId('album', userId)} as aid, ${trackMetric} as val,
             ROW_NUMBER() OVER (PARTITION BY ${trackWeek} ORDER BY ${trackMetric} DESC) as rank
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      ${mrJoin}
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
    latestNew: timed('artist.latestNew', () => computeLatestNew('artist', db, userId, limit)),
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
    latestNew: [],
    mostUniquePerMonth: [],
    yearEndFinishes: [],
    mostAccolades: [],
  };
}

// --- helpers de contexto por entidad (para los nuevos records) ---

type Ent = 'track' | 'album' | 'artist';

// Fragmentos SQL reutilizables para una query agrupada por entidad.
// `finalJoin` NUNCA introduce joins que puedan multiplicar filas (eso falsearía
// los ORDER BY/LIMIT). Los campos artist_id/artist_name usan subconsultas escalares.
function entityCtx(entity: Ent, userId: number) {
  if (entity === 'track') {
    return {
      eidExpr: resolvedEntityId('track', userId),
      extraJoins: entityMergeJoin('track', userId),
      filter: sql``,
      finalJoin: sql`
        JOIN tracks t ON t.spotify_id = eid
        LEFT JOIN albums al ON al.spotify_id = t.album_id
      `,
      finalName: sql`t.name`,
      finalImg: sql`al.image_url`,
      finalArtistId: sql`(SELECT ta_p.artist_id FROM track_artists ta_p WHERE ta_p.track_id = eid AND ta_p.position = 0 LIMIT 1)`,
      finalArtistName: sql`(SELECT a_p.name FROM track_artists ta_p JOIN artists a_p ON a_p.spotify_id = ta_p.artist_id WHERE ta_p.track_id = eid AND ta_p.position = 0 LIMIT 1)`,
    };
  }
  if (entity === 'album') {
    return {
      eidExpr: resolvedEntityId('album', userId),
      extraJoins: sql`JOIN tracks t ON t.spotify_id = lh.track_id ${entityMergeJoin('album', userId)}`,
      filter: sql`AND t.album_id IS NOT NULL`,
      finalJoin: sql`JOIN albums al ON al.spotify_id = eid`,
      finalName: sql`al.name`,
      finalImg: sql`al.image_url`,
      finalArtistId: sql`(SELECT ta_p.artist_id FROM tracks t_p JOIN track_artists ta_p ON ta_p.track_id = t_p.spotify_id AND ta_p.position = 0 WHERE t_p.album_id = eid LIMIT 1)`,
      finalArtistName: sql`(SELECT a_p.name FROM tracks t_p JOIN track_artists ta_p ON ta_p.track_id = t_p.spotify_id AND ta_p.position = 0 JOIN artists a_p ON a_p.spotify_id = ta_p.artist_id WHERE t_p.album_id = eid LIMIT 1)`,
    };
  }
  // artist
  return {
    eidExpr: resolvedEntityId('artist', userId),
    extraJoins: sql`JOIN track_artists ta ON ta.track_id = lh.track_id ${entityMergeJoin('artist', userId)}`,
    filter: sql``,
    finalJoin: sql`JOIN artists a ON a.spotify_id = eid`,
    finalName: sql`a.name`,
    finalImg: sql`a.image_url`,
    finalArtistId: sql`NULL`,
    finalArtistName: sql`NULL`,
  };
}

// --- records extendidos (longevidad / descubrimiento / mensuales / variedad) ---

function computeLongestGap(entity: Ent, db: Db, userId: number, limit: number): RecordEntry[] {
  const ctx = entityCtx(entity, userId);
  // Mayor hueco entre reproducciones (incluye huecos "en curso" hasta ahora).
  // Truco: se codifica (gap, prev_ts, ts) en un único string `printf('%020.6f|%s|%s', ...)`
  // para que MAX() devuelva el valor con mayor gap Y conserve las fechas del par.
  // Así evitamos ROW_NUMBER() (lento sobre 317k filas × 34k particiones) y un
  // segundo pase de lookup. Benchmark: 805ms tracks, 1.3s artists/albums.
  const rows = db.all(sql`
    WITH pairs AS (
      SELECT ${ctx.eidExpr} AS eid, lh.played_at AS ts,
             LAG(lh.played_at) OVER (PARTITION BY ${ctx.eidExpr} ORDER BY lh.played_at) AS prev_ts
      FROM listening_history lh ${ctx.extraJoins}
      WHERE lh.user_id = ${userId} ${ctx.filter}
    ),
    agg AS (
      SELECT eid,
             COUNT(*) AS plays,
             MAX(CASE WHEN prev_ts IS NOT NULL
                      THEN printf('%020.6f|%s|%s', julianday(ts) - julianday(prev_ts), prev_ts, ts)
                      ELSE NULL END) AS hist_pack,
             MAX(ts) AS last_play
      FROM pairs GROUP BY eid
      HAVING plays >= 50
    ),
    top AS (
      SELECT eid, hist_pack, last_play,
             CASE
               WHEN (julianday('now') - julianday(last_play)) > COALESCE(CAST(substr(hist_pack, 1, 20) AS REAL), 0.0)
                 THEN (julianday('now') - julianday(last_play))
               ELSE COALESCE(CAST(substr(hist_pack, 1, 20) AS REAL), 0.0)
             END AS value,
             CASE
               WHEN (julianday('now') - julianday(last_play)) > COALESCE(CAST(substr(hist_pack, 1, 20) AS REAL), 0.0)
                 THEN 1 ELSE 0
             END AS ongoing_flag
      FROM agg
      ORDER BY value DESC
      LIMIT ${limit}
    )
    SELECT t.eid AS eid,
           CAST(t.value AS INTEGER) AS value,
           t.ongoing_flag AS ongoing_flag,
           t.last_play AS last_play,
           t.hist_pack AS hist_pack,
           ${ctx.finalName} AS name,
           ${ctx.finalImg} AS image_url,
           ${ctx.finalArtistId} AS artist_id,
           ${ctx.finalArtistName} AS artist_name
    FROM top t
    ${ctx.finalJoin}
    WHERE t.value > 0
    ORDER BY t.value DESC
  `) as any[];

  return rows.map(r => {
    const ongoing = r.ongoing_flag === 1 || r.ongoing_flag === true;
    // desempaquetar el par histórico desde hist_pack = "gap|prev_ts|ts"
    let histStart: string | null = null;
    let histEnd: string | null = null;
    if (r.hist_pack && typeof r.hist_pack === 'string') {
      const idx1 = r.hist_pack.indexOf('|');
      const idx2 = r.hist_pack.indexOf('|', idx1 + 1);
      if (idx1 > 0 && idx2 > idx1) {
        histStart = r.hist_pack.slice(idx1 + 1, idx2);
        histEnd = r.hist_pack.slice(idx2 + 1);
      }
    }
    return {
      entityId: r.eid,
      name: r.name ?? 'unknown',
      imageUrl: r.image_url ?? null,
      artistId: r.artist_id ?? null,
      artistName: r.artist_name ?? null,
      value: Number(r.value),
      week: null,
      // ongoing: date = last_play (inicio del hueco en curso), endDate = null
      // historic: date = inicio del par más largo, endDate = fin del par
      date: ongoing ? (r.last_play ?? null) : histStart,
      endDate: ongoing ? null : histEnd,
      ongoing,
    };
  });
}

function computeGoldenOldies(entity: Ent, db: Db, userId: number, limit: number): RecordEntry[] {
  const ctx = entityCtx(entity, userId);
  const rows = db.all(sql`
    WITH agg AS (
      SELECT ${ctx.eidExpr} AS eid,
             COUNT(*) AS plays,
             MAX(lh.played_at) AS last_play
      FROM listening_history lh ${ctx.extraJoins}
      WHERE lh.user_id = ${userId} ${ctx.filter}
      GROUP BY eid
      HAVING plays > 50
    )
    SELECT agg.eid AS eid, agg.plays AS value, agg.last_play AS last_play,
           ${ctx.finalName} AS name,
           ${ctx.finalImg} AS image_url,
           ${ctx.finalArtistId} AS artist_id,
           ${ctx.finalArtistName} AS artist_name
    FROM agg
    ${ctx.finalJoin}
    ORDER BY agg.last_play ASC
    LIMIT ${limit}
  `) as any[];

  return rows.map(r => ({
    entityId: r.eid,
    name: r.name ?? 'unknown',
    imageUrl: r.image_url ?? null,
    artistId: r.artist_id ?? null,
    artistName: r.artist_name ?? null,
    value: Number(r.value),
    week: null,
    date: r.last_play ?? null,
  }));
}

function computeLatestDiscoveries(entity: Ent, db: Db, userId: number, limit: number): RecordEntry[] {
  const ctx = entityCtx(entity, userId);
  const rows = db.all(sql`
    WITH agg AS (
      SELECT ${ctx.eidExpr} AS eid,
             COUNT(*) AS plays,
             MIN(lh.played_at) AS first_play
      FROM listening_history lh ${ctx.extraJoins}
      WHERE lh.user_id = ${userId} ${ctx.filter}
      GROUP BY eid
      HAVING plays > 50
    )
    SELECT agg.eid AS eid, agg.plays AS value, agg.first_play AS first_play,
           ${ctx.finalName} AS name,
           ${ctx.finalImg} AS image_url,
           ${ctx.finalArtistId} AS artist_id,
           ${ctx.finalArtistName} AS artist_name
    FROM agg
    ${ctx.finalJoin}
    ORDER BY agg.first_play DESC
    LIMIT ${limit}
  `) as any[];

  return rows.map(r => ({
    entityId: r.eid,
    name: r.name ?? 'unknown',
    imageUrl: r.image_url ?? null,
    artistId: r.artist_id ?? null,
    artistName: r.artist_name ?? null,
    value: Number(r.value),
    week: null,
    date: r.first_play ?? null,
  }));
}

function computeLatestNew(entity: Ent, db: Db, userId: number, limit: number): RecordEntry[] {
  const ctx = entityCtx(entity, userId);
  const rows = db.all(sql`
    WITH agg AS (
      SELECT ${ctx.eidExpr} AS eid,
             COUNT(*) AS plays,
             MIN(lh.played_at) AS first_play
      FROM listening_history lh ${ctx.extraJoins}
      WHERE lh.user_id = ${userId} ${ctx.filter}
      GROUP BY eid
    )
    SELECT agg.eid AS eid, agg.plays AS value, agg.first_play AS first_play,
           ${ctx.finalName} AS name,
           ${ctx.finalImg} AS image_url,
           ${ctx.finalArtistId} AS artist_id,
           ${ctx.finalArtistName} AS artist_name
    FROM agg
    ${ctx.finalJoin}
    ORDER BY agg.first_play DESC
    LIMIT ${limit}
  `) as any[];

  return rows.map(r => ({
    entityId: r.eid,
    name: r.name ?? 'unknown',
    imageUrl: r.image_url ?? null,
    artistId: r.artist_id ?? null,
    artistName: r.artist_name ?? null,
    value: Number(r.value),
    week: null,
    date: r.first_play ?? null,
  }));
}

function computeMostUniquePerMonth(entity: Ent, db: Db, userId: number, limit: number): MonthCountEntry[] {
  const ctx = entityCtx(entity, userId);
  const rows = db.all(sql`
    SELECT strftime('%Y-%m', lh.played_at) AS month,
           COUNT(DISTINCT ${ctx.eidExpr}) AS count
    FROM listening_history lh ${ctx.extraJoins}
    WHERE lh.user_id = ${userId} ${ctx.filter}
    GROUP BY month
    ORDER BY count DESC
    LIMIT ${limit}
  `) as any[];

  const months = rows.map(r => ({ month: r.month as string, count: Number(r.count) }));
  if (months.length === 0) return months.map(m => ({ ...m, covers: [] }));

  const coversByMonth = fetchMonthCovers(entity, db, userId, months.map(m => m.month));
  return months.map(m => ({ ...m, covers: coversByMonth.get(m.month) ?? [] }));
}

// Top covers por mes para la pestaña activa:
//  - track  → portada de álbum de los top tracks
//  - album  → portada del álbum
//  - artist → foto del artista
function fetchMonthCovers(entity: Ent, db: Db, userId: number, months: string[]): Map<string, string[]> {
  const perMonth = 4;
  const monthList = sql.join(months.map(m => sql`${m}`), sql`, `);

  let query;
  if (entity === 'track') {
    query = sql`
      WITH ranked AS (
        SELECT strftime('%Y-%m', lh.played_at) AS month,
               al.image_url AS image_url,
               ROW_NUMBER() OVER (
                 PARTITION BY strftime('%Y-%m', lh.played_at)
                 ORDER BY COUNT(*) DESC
               ) AS rn
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN albums al ON al.spotify_id = t.album_id
        WHERE lh.user_id = ${userId}
          AND al.image_url IS NOT NULL
          AND strftime('%Y-%m', lh.played_at) IN (${monthList})
        GROUP BY month, lh.track_id
      )
      SELECT month, image_url FROM ranked WHERE rn <= ${perMonth}
      ORDER BY month, rn
    `;
  } else if (entity === 'album') {
    query = sql`
      WITH ranked AS (
        SELECT strftime('%Y-%m', lh.played_at) AS month,
               al.image_url AS image_url,
               ROW_NUMBER() OVER (
                 PARTITION BY strftime('%Y-%m', lh.played_at)
                 ORDER BY COUNT(*) DESC
               ) AS rn
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN albums al ON al.spotify_id = t.album_id
        WHERE lh.user_id = ${userId}
          AND al.image_url IS NOT NULL
          AND strftime('%Y-%m', lh.played_at) IN (${monthList})
        GROUP BY month, al.spotify_id
      )
      SELECT month, image_url FROM ranked WHERE rn <= ${perMonth}
      ORDER BY month, rn
    `;
  } else {
    query = sql`
      WITH ranked AS (
        SELECT strftime('%Y-%m', lh.played_at) AS month,
               a.image_url AS image_url,
               ROW_NUMBER() OVER (
                 PARTITION BY strftime('%Y-%m', lh.played_at)
                 ORDER BY COUNT(*) DESC
               ) AS rn
        FROM listening_history lh
        JOIN track_artists ta ON ta.track_id = lh.track_id AND ta.position = 0
        JOIN artists a ON a.spotify_id = ta.artist_id
        WHERE lh.user_id = ${userId}
          AND a.image_url IS NOT NULL
          AND strftime('%Y-%m', lh.played_at) IN (${monthList})
        GROUP BY month, ta.artist_id
      )
      SELECT month, image_url FROM ranked WHERE rn <= ${perMonth}
      ORDER BY month, rn
    `;
  }

  const rows = db.all(query) as { month: string; image_url: string }[];
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.month) ?? [];
    // dedup: varios tracks pueden compartir portada de álbum
    if (!list.includes(r.image_url) && list.length < perMonth) {
      list.push(r.image_url);
    }
    out.set(r.month, list);
  }
  return out;
}

function computeMostDistinctTracks(entity: 'album' | 'artist', db: Db, userId: number, limit: number): RecordEntry[] {
  const ctx = entityCtx(entity, userId);
  const rows = db.all(sql`
    WITH agg AS (
      SELECT ${ctx.eidExpr} AS eid,
             COUNT(DISTINCT lh.track_id) AS distinct_tracks
      FROM listening_history lh ${ctx.extraJoins}
      WHERE lh.user_id = ${userId} ${ctx.filter}
      GROUP BY eid
    )
    SELECT agg.eid AS eid, agg.distinct_tracks AS value,
           ${ctx.finalName} AS name,
           ${ctx.finalImg} AS image_url,
           ${ctx.finalArtistId} AS artist_id,
           ${ctx.finalArtistName} AS artist_name
    FROM agg
    ${ctx.finalJoin}
    WHERE agg.distinct_tracks > 1
    ORDER BY agg.distinct_tracks DESC
    LIMIT ${limit}
  `) as any[];

  return rows.map(r => mapSimple(r));
}

function computeOneHitWonders(entity: 'artist', db: Db, userId: number, limit: number): RecordEntry[] {
  const ctx = entityCtx(entity, userId);
  // dominant track: ≥90% de plays proviene de 1 track; mínimo 10 plays totales.
  // Usa window functions (SUM/MAX/ROW_NUMBER OVER) en lugar de subconsulta correlacionada
  // para evitar O(N²) sobre per_track al crecer el historial.
  const rows = db.all(sql`
    WITH per_track AS (
      SELECT ${ctx.eidExpr} AS eid, lh.track_id AS tid, COUNT(*) AS cnt
      FROM listening_history lh ${ctx.extraJoins}
      WHERE lh.user_id = ${userId} ${ctx.filter}
      GROUP BY eid, lh.track_id
    ),
    windowed AS (
      SELECT
        eid, tid, cnt,
        SUM(cnt) OVER (PARTITION BY eid) AS total,
        MAX(cnt) OVER (PARTITION BY eid) AS top_cnt,
        ROW_NUMBER() OVER (PARTITION BY eid ORDER BY cnt DESC) AS rn
      FROM per_track
    ),
    qualified AS (
      SELECT eid, total, tid AS top_tid
      FROM windowed
      WHERE rn = 1 AND total >= 10 AND (top_cnt * 1.0 / total) >= 0.9
    )
    SELECT q.eid AS eid, q.total AS value, q.top_tid,
           top_t.name AS secondary_label,
           ${ctx.finalName} AS name,
           ${ctx.finalImg} AS image_url,
           ${ctx.finalArtistId} AS artist_id,
           ${ctx.finalArtistName} AS artist_name
    FROM qualified q
    JOIN tracks top_t ON top_t.spotify_id = q.top_tid
    ${ctx.finalJoin}
    ORDER BY q.total DESC
    LIMIT ${limit}
  `) as any[];

  return rows.map(r => ({
    entityId: r.eid,
    name: r.name ?? 'unknown',
    imageUrl: r.image_url ?? null,
    artistId: r.artist_id ?? null,
    artistName: r.artist_name ?? null,
    value: Number(r.value),
    week: null,
    secondaryLabel: r.secondary_label ?? null,
  }));
}

function computeTopNoAlbum(db: Db, userId: number, limit: number): RecordEntry[] {
  const rows = db.all(sql`
    SELECT lh.track_id AS eid,
           COUNT(*) AS value,
           t.name AS name,
           NULL AS image_url,
           (SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = lh.track_id AND ta.position = 0 LIMIT 1) AS artist_id,
           (SELECT a.name FROM track_artists ta JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = lh.track_id AND ta.position = 0 LIMIT 1) AS artist_name
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.user_id = ${userId} AND t.album_id IS NULL
    GROUP BY lh.track_id
    ORDER BY value DESC
    LIMIT ${limit}
  `) as any[];

  return rows.map(r => mapSimple(r));
}

// mapea una row genérica {eid, name, image_url, artist_id, artist_name, value} a RecordEntry
function mapSimple(r: any): RecordEntry {
  return {
    entityId: r.eid,
    name: r.name ?? 'unknown',
    imageUrl: r.image_url ?? null,
    artistId: r.artist_id ?? null,
    artistName: r.artist_name ?? null,
    value: Number(r.value),
    week: null,
  };
}

// year-end finishes: top-N de cada año completado (para accolades).
// Sólo incluye años anteriores al actual (el año en curso todavía no "terminó").
const YEAR_END_LIMIT = 10;
function computeYearEndFinishes(entity: Ent, db: Db, userId: number, sort: Sort): YearEndFinish[] {
  const currentYear = new Date().getUTCFullYear();
  const years = db.all(sql`
    SELECT DISTINCT CAST(strftime('%Y', played_at) AS INTEGER) AS y
    FROM listening_history
    WHERE user_id = ${userId} AND CAST(strftime('%Y', played_at) AS INTEGER) < ${currentYear}
    ORDER BY y ASC
  `) as { y: number }[];

  const results: YearEndFinish[] = [];
  for (const { y } of years) {
    const yearStart = `${y}-01-01T00:00:00.000Z`;
    const yearEnd = `${y}-12-31T23:59:59.999Z`;
    const top = getTopEntities(db, entity, yearStart, sort, YEAR_END_LIMIT, yearEnd, userId);
    top.forEach((row, i) => {
      results.push({
        year: y,
        entityId: row.entity_id,
        rank: i + 1,
        value: Number(sort === 'plays' ? row.play_count : row.total_ms),
      });
    });
  }
  return results;
}

// --- most accolades: cuenta en cuántas listas de records aparece cada entidad ---

function computeMostAccolades(
  data: EntityRecords & Partial<TrackRecords & AlbumRecords & ArtistRecordsData>,
): RecordEntry[] {
  const counts = new Map<string, RecordEntry>();

  function tally(list: RecordEntry[]) {
    for (let i = 0; i < Math.min(list.length, RECORDS_LIMIT); i++) {
      const e = list[i];
      const prev = counts.get(e.entityId);
      if (prev) { prev.value++; }
      else { counts.set(e.entityId, { ...e, value: 1, week: null }); }
    }
  }

  tally(data.peakWeekPlays);
  tally(data.biggestDebuts);
  tally(data.mostWeeksAtNo1);
  tally(data.mostWeeksInTop5);
  tally(data.longestChartRun);
  tally(data.inMostPlaylists);
  tally(data.longestGap);
  tally(data.goldenOldies);
  tally(data.latestDiscoveries);
  tally(data.latestNew);

  if (data.topNoAlbum) tally(data.topNoAlbum);
  if (data.mostDistinctTracks) tally(data.mostDistinctTracks);
  if (data.oneHitWonders) tally(data.oneHitWonders);

  if (data.mostNo1Tracks) {
    for (const list of [data.mostNo1Tracks, data.mostNo1Albums ?? []]) {
      for (let i = 0; i < Math.min(list.length, RECORDS_LIMIT); i++) {
        const e = list[i] as ArtistRecordEntry;
        const prev = counts.get(e.artistId);
        if (prev) { prev.value++; }
        else { counts.set(e.artistId, { entityId: e.artistId, name: e.name, imageUrl: e.imageUrl, artistId: null, artistName: null, value: 1, week: null }); }
      }
    }
  }

  for (const f of data.yearEndFinishes) {
    const prev = counts.get(f.entityId);
    if (prev) { prev.value++; }
    // no crear entradas nuevas sólo por year-end (no tenemos name/imageUrl)
  }

  return [...counts.values()]
    .filter(e => e.value > 1)
    .sort((a, b) => b.value - a.value)
    .slice(0, RECORDS_LIMIT);
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
