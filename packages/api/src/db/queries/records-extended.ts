// Records extendidos: longevidad, descubrimiento, variedad, accolades, year-end.
// Estos son cómputos independientes de los charts semanales (no usan el CTE
// chart_data). Cada uno corre su propia query SQL y deriva el resultado.
// Los charts semanales viven en records.ts y consumen estos helpers.

import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type {
  RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData,
  MonthCountEntry, YearEndFinish, RankingMetric,
} from '@sis/shared';
import { resolvedEntityId, entityMergeJoin, resolvedPlayJoins } from './helpers.js';
import { getTopEntities } from './entity.js';
import { RECORDS_LIMIT } from '../../constants.js';

type Sort = RankingMetric;
export type Ent = 'track' | 'album' | 'artist';

// --- helpers de contexto por entidad ---

// Fragmentos SQL reutilizables para una query agrupada por entidad.
// `finalJoin` NUNCA introduce joins que puedan multiplicar filas (eso falsearía
// los ORDER BY/LIMIT). Los campos artist_id/artist_name usan subconsultas escalares.
export function entityCtx(entity: Ent, userId: number) {
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
      extraJoins: resolvedPlayJoins('album', userId),
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

// --- records extendidos ---

export function computeLongestGap(entity: Ent, db: Db, userId: number, limit: number): RecordEntry[] {
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

export function computeGoldenOldies(entity: Ent, db: Db, userId: number, limit: number): RecordEntry[] {
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

export function computeLatestDiscoveries(entity: Ent, db: Db, userId: number, limit: number): RecordEntry[] {
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

export function computeMostUniquePerMonth(entity: Ent, db: Db, userId: number, limit: number): MonthCountEntry[] {
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

export function computeMostDistinctTracks(entity: 'album' | 'artist', db: Db, userId: number, limit: number): RecordEntry[] {
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

export function computeOneHitWonders(entity: 'artist', db: Db, userId: number, limit: number): RecordEntry[] {
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

export function computeTopNoAlbum(db: Db, userId: number, limit: number): RecordEntry[] {
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

// year-end finishes: top-N de cada año completado (para accolades).
// Sólo incluye años anteriores al actual (el año en curso todavía no "terminó").
const YEAR_END_LIMIT = 10;
export function computeYearEndFinishes(entity: Ent, db: Db, userId: number, sort: Sort): YearEndFinish[] {
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

export function computeMostAccolades(
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
