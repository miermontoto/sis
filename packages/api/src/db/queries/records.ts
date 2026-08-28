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
import { CHART_SIZE, DOMINANCE_MIN_WEEK_PLAYS } from '../../constants.js';
import {
  computeLongestGap, computeGoldenOldies, computeLatestDiscoveries,
  computeMostUniquePerMonth, computeMostDistinctTracks, computeOneHitWonders,
  computeYearEndFinishes, computeMostAccolades,
} from './records-extended.js';
import { createLogger } from '../../services/logger.js';

const log = createLogger('records-timing');

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
    log.info(`${label}: ${ms}ms`);
  }
}

const weekExpr = (ws: WeekStart) => periodExpr('week', ws);

// Escucha total de cada semana, sin filtrar por entidad: es el denominador de
// `dominance`. Se calcula aparte porque no se puede derivar de las filas del
// ranking semanal — para artists un play con varios artistas suma en cada uno,
// así que la suma por semana pasaría del 100%.
type WeekTotal = { val: number; plays: number };
function getWeekTotals(db: Db, ws: WeekStart, sort: Sort, userId: number): Map<string, WeekTotal> {
  const rows = db.all(sql`
    SELECT ${weekExpr(ws)} as w,
           ${sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`} as val,
           count(*) as plays
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.user_id = ${userId}
    GROUP BY w
  `) as { w: string; val: number; plays: number }[];

  return new Map(rows.map(r => [r.w, { val: Number(r.val), plays: Number(r.plays) }]));
}

// --- queries de records semanales (peak/debuts/weeks-at-#1/etc.) ---

function getTrackRecords(db: Db, ws: WeekStart, sort: Sort, limit: number, userId: number, unique: boolean): TrackRecords {
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

  const base = deriveRecords(ranked, limit, unique, timed('weekTotals', () => getWeekTotals(db, ws, sort, userId)));
  // resuelve track merges: un track fusionado se cuenta bajo su id canónico
  // (nombre/artista/álbum del track target), no bajo su id de origen.
  base.inMostPlaylists = db.all(sql`
    SELECT COALESCE(mr_track.target_id, spt.track_id) as entityId, t.name, al.image_url as imageUrl,
           (SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = t.spotify_id AND ta.position = 0 LIMIT 1) as artistId,
           (SELECT a.name FROM track_artists ta JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = t.spotify_id AND ta.position = 0 LIMIT 1) as artistName,
           COUNT(DISTINCT spt.playlist_id) as value
    FROM spotify_playlist_tracks spt
    JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
    LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = spt.track_id AND mr_track.user_id = ${userId}
    JOIN tracks t ON t.spotify_id = COALESCE(mr_track.target_id, spt.track_id)
    LEFT JOIN albums al ON al.spotify_id = t.album_id
    GROUP BY COALESCE(mr_track.target_id, spt.track_id)
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
    yearEndFinishes: timed('track.yearEndFinishes', () => computeYearEndFinishes('track', db, userId, sort)),
    mostAccolades: [],
  };
  result.mostAccolades = computeMostAccolades(result);
  return result;
}

function getAlbumRecords(db: Db, ws: WeekStart, sort: Sort, limit: number, userId: number, unique: boolean): AlbumRecords {
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

  const base = deriveRecords(ranked, limit, unique, timed('weekTotals', () => getWeekTotals(db, ws, sort, userId)));
  // resuelve merges (track y album) igual que el ranking semanal: agrupa por el
  // álbum canónico para no listar un álbum ya fusionado bajo su id de origen.
  // nombre/artista se toman del target (join por el eid resuelto).
  base.inMostPlaylists = db.all(sql`
    WITH album_playlists AS (
      SELECT ${resolvedEntityId('album', userId)} as eid,
             COUNT(DISTINCT spt.playlist_id) as value
      FROM spotify_playlist_tracks spt
      JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
      LEFT JOIN merge_rules mr_track ON mr_track.entity_type = 'track' AND mr_track.source_id = spt.track_id AND mr_track.user_id = ${userId}
      JOIN tracks t ON t.spotify_id = COALESCE(mr_track.target_id, spt.track_id)
      ${entityMergeJoin('album', userId)}
      WHERE t.album_id IS NOT NULL
      GROUP BY eid
      HAVING value > 1
    )
    SELECT ap.eid as entityId, al.name, al.image_url as imageUrl,
           (SELECT ta.artist_id FROM tracks t2 JOIN track_artists ta ON ta.track_id = t2.spotify_id AND ta.position = 0
            WHERE t2.album_id = ap.eid LIMIT 1) as artistId,
           (SELECT a.name FROM tracks t2 JOIN track_artists ta ON ta.track_id = t2.spotify_id AND ta.position = 0
            JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE t2.album_id = ap.eid LIMIT 1) as artistName,
           ap.value as value
    FROM album_playlists ap
    JOIN albums al ON al.spotify_id = ap.eid
    ORDER BY value DESC
    LIMIT ${limit}
  `) as RecordEntry[];

  const result: AlbumRecords = {
    ...base,
    longestGap: timed('album.longestGap', () => computeLongestGap('album', db, userId, limit)),
    goldenOldies: timed('album.goldenOldies', () => computeGoldenOldies('album', db, userId, limit)),
    latestDiscoveries: timed('album.latestDiscoveries', () => computeLatestDiscoveries('album', db, userId, limit)),
    mostUniquePerMonth: timed('album.mostUniquePerMonth', () => computeMostUniquePerMonth('album', db, userId, limit)),
    yearEndFinishes: timed('album.yearEndFinishes', () => computeYearEndFinishes('album', db, userId, sort)),
    mostAccolades: [],
  };
  result.mostAccolades = computeMostAccolades(result);
  return result;
}

function getArtistRecords(db: Db, ws: WeekStart, sort: Sort, limit: number, userId: number, unique: boolean): ArtistRecordsData {
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

  const base = deriveRecords(ranked, limit, unique, timed('weekTotals', () => getWeekTotals(db, ws, sort, userId)));

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

// unique=true: un registro por entidad (comportamiento por defecto). unique=false:
// peak week, dominance y longest run permiten que la misma entidad aparezca varias veces.
function deriveRecords(rows: any[], limit: number, unique: boolean, weekTotals: Map<string, WeekTotal>): EntityRecords {
  // agrupar por entidad
  const byEntity = new Map<string, { rows: any[]; debutWeek: string; name: string; imageUrl: string | null; artistId: string | null; artistName: string | null }>();
  for (const r of rows) {
    if (!byEntity.has(r.eid)) {
      byEntity.set(r.eid, { rows: [], debutWeek: r.debut_week, name: r.name, imageUrl: r.image_url, artistId: r.artist_id ?? null, artistName: r.artist_name });
    }
    byEntity.get(r.eid)!.rows.push(r);
  }

  // 1. Peak week plays. En modo unique, la mejor semana por entidad. Sin unique,
  // cada (entidad, semana) compite por separado, así que una misma entidad puede
  // aparecer varias veces con sus semanas más altas.
  const peakWeekPlays: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const weeks = unique ? [data.rows.reduce((a: any, b: any) => a.val > b.val ? a : b)] : data.rows;
    for (const r of weeks) {
      peakWeekPlays.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: r.val, week: r.w });
    }
  }
  peakWeekPlays.sort((a, b) => b.value - a.value);

  // 1b. Dominance: qué porcentaje del total de la semana se llevó la entidad.
  // Solo cuentan semanas con suficientes plays — si no, cualquier semana muerta
  // regala un 100%. Respeta `unique` igual que peak week: la mejor semana por
  // entidad, o todas las (entidad, semana) compitiendo por separado.
  const dominance: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const shares = data.rows
      .map((r: any) => ({ week: r.w as string, val: Number(r.val), total: weekTotals.get(r.w) }))
      .filter(x => !!x.total && x.total.val > 0 && x.total.plays >= DOMINANCE_MIN_WEEK_PLAYS)
      // el cap se aplica porque numerador y denominador no capan siempre por la misma
      // duración: la query de álbumes resuelve track merges antes de leer duration_ms y
      // el total de la semana no (el tiempo escuchado no depende de las fusiones). El
      // desvío medido es <2%, pero basta para que un 99% real se pinte por encima de 100.
      .map(x => ({ week: x.week, share: Math.min((x.val * 100) / x.total!.val, 100) }));
    if (shares.length === 0) continue;

    const picked = unique ? [shares.reduce((a, b) => a.share > b.share ? a : b)] : shares;
    for (const p of picked) {
      dominance.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: p.share, week: p.week });
    }
  }
  dominance.sort((a, b) => b.value - a.value);

  // 2. Biggest debuts
  const biggestDebuts: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const debut = data.rows.find((r) => r.w === data.debutWeek);
    if (debut) {
      biggestDebuts.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: debut.val, week: debut.w });
    }
  }
  biggestDebuts.sort((a, b) => b.value - a.value);

  // 3. Most weeks at #1
  const mostWeeksAtNo1: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const weeks = data.rows.filter((r) => r.rank === 1).length;
    if (weeks > 0) {
      mostWeeksAtNo1.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: weeks, week: null });
    }
  }
  mostWeeksAtNo1.sort((a, b) => b.value - a.value);

  // 3b. Bubbling under: lo más escuchado de entre lo que nunca llegó a #1 en una
  // semana. El total all-time sale de sumar las semanas — cada play cae en una sola
  // (y en artists el DISTINCT de plays_dedup ya evita contar dos veces un play con
  // varios artistas). Se guarda la mejor posición alcanzada: es lo que da sentido al
  // nombre, cómo de cerca se quedó.
  const bubblingUnder: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    if (data.rows.some((r: any) => r.rank === 1)) continue;
    const total = data.rows.reduce((sum: number, r: any) => sum + Number(r.val), 0);
    const best = data.rows.reduce((a: any, b: any) => a.rank <= b.rank ? a : b);
    bubblingUnder.push({
      entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName,
      value: total, week: best.w, peakRank: best.rank,
    });
  }
  bubblingUnder.sort((a, b) => b.value - a.value);

  // 4. Most weeks in the charts (top 25)
  const mostWeeksInTop5: RecordEntry[] = [];
  for (const [eid, data] of byEntity) {
    const weeks = data.rows.filter((r) => r.rank <= CHART_SIZE).length;
    if (weeks > 0) {
      mostWeeksInTop5.push({ entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName, value: weeks, week: null });
    }
  }
  mostWeeksInTop5.sort((a, b) => b.value - a.value);

  // 5. Longest consecutive run on the charts (top 25). Recolectamos TODAS las
  // rachas consecutivas de cada entidad; en modo unique nos quedamos con la más
  // larga (a igualdad gana la racha en curso), sin unique emitimos cada racha por
  // separado, así que una entidad con varias rachas aparece varias veces.
  const allWeekLabels = [...new Set(rows.map((r) => r.w as string))].sort();
  const longestChartRun: RecordEntry[] = [];
  type Run = { streak: number; start: string; end: string; ongoing: boolean };
  for (const [eid, data] of byEntity) {
    const chartWeekSet = new Set(
      data.rows.filter((r) => r.rank <= CHART_SIZE).map((r) => r.w as string)
    );
    if (chartWeekSet.size === 0) continue;

    // recorrer la línea temporal completa acumulando rachas consecutivas
    const runs: Run[] = [];
    let curStreak = 0, curStart = '';
    for (let i = 0; i < allWeekLabels.length; i++) {
      const w = allWeekLabels[i];
      if (chartWeekSet.has(w)) {
        if (curStreak === 0) curStart = w;
        curStreak++;
      } else if (curStreak > 0) {
        runs.push({ streak: curStreak, start: curStart, end: allWeekLabels[i - 1], ongoing: false });
        curStreak = 0;
      }
    }
    if (curStreak > 0) {
      runs.push({ streak: curStreak, start: curStart, end: allWeekLabels[allWeekLabels.length - 1], ongoing: true });
    }

    const toEntry = (run: Run): RecordEntry => ({
      entityId: eid, name: data.name, imageUrl: data.imageUrl, artistId: data.artistId, artistName: data.artistName,
      value: run.streak,
      week: run.ongoing ? 'active' : null,
      date: run.start,
      endDate: run.end,
      ongoing: run.ongoing,
    });

    if (unique) {
      // mejor racha: la más larga; a igualdad, gana la que sigue en curso
      let best: Run | null = null;
      for (const run of runs) {
        if (!best || run.streak > best.streak || (run.streak === best.streak && run.ongoing)) best = run;
      }
      if (best) longestChartRun.push(toEntry(best));
    } else {
      for (const run of runs) longestChartRun.push(toEntry(run));
    }
  }
  longestChartRun.sort((a, b) => b.value - a.value);

  return {
    peakWeekPlays: peakWeekPlays.slice(0, limit),
    dominance: dominance.slice(0, limit),
    biggestDebuts: biggestDebuts.slice(0, limit),
    mostWeeksAtNo1: mostWeeksAtNo1.slice(0, limit),
    bubblingUnder: bubblingUnder.slice(0, limit),
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

export function getRecords(db: Db, weekStart: WeekStart = 'monday', sort: Sort = 'time', limit = 10, type: EntityTypeFilter | undefined, userId: number, unique = true): Partial<RecordsResponse> {
  if (type === 'track') return { tracks: getTrackRecords(db, weekStart, sort, limit, userId, unique) };
  if (type === 'album') return { albums: getAlbumRecords(db, weekStart, sort, limit, userId, unique) };
  if (type === 'artist') return { artists: getArtistRecords(db, weekStart, sort, limit, userId, unique) };
  return {
    tracks: getTrackRecords(db, weekStart, sort, limit, userId, unique),
    albums: getAlbumRecords(db, weekStart, sort, limit, userId, unique),
    artists: getArtistRecords(db, weekStart, sort, limit, userId, unique),
  };
}
