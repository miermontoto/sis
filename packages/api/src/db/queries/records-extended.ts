// Records extendidos: longevidad, descubrimiento, variedad, accolades, year-end.
// Estos son cómputos independientes de los charts semanales (no usan el CTE
// chart_data). Cada uno corre su propia query SQL y deriva el resultado.
// Los charts semanales viven en records.ts y consumen estos helpers.

import { sql } from 'drizzle-orm';
import type { Db, SqlChunk, AggregateRow } from './helpers.js';
import type {
  RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData,
  MonthCountEntry, YearEndFinish, YearRank, RankingMetric, PeriodCalendar,
} from '@sis/shared';
import { resolvedEntityId, entityMergeJoin, resolvedPlayJoins, albumArtistId, albumArtistName, albumNullFilter, trackArtistsFor, primaryArtistOf, artistNameOf, localPlayedAt, playDuration } from './helpers.js';
import { periodBounds, periodForDate, topDistinctEntries, COLLECTION_ID_PREFIX } from '@sis/shared';
import { getTopEntities } from './entity.js';
import { RECORDS_LIMIT, CHART_SIZE, AVG_YEAR_FINISH_MIN_YEARS, AVG_ALBUM_RANK_TOP, AVG_ALBUM_RANK_MIN_ALBUMS } from '../../constants.js';

type Sort = RankingMetric;
export type Ent = 'track' | 'album' | 'artist';

// --- helpers de contexto por entidad ---

// Fragmentos SQL reutilizables para una query agrupada por entidad.
// `finalJoin` NUNCA introduce joins que puedan multiplicar filas (eso falsearía
// los ORDER BY/LIMIT). Los campos artist_id/artist_name usan subconsultas escalares.
export function entityCtx(entity: Ent, userId: number) {
  if (entity === 'track') {
    return {
      eidExpr: resolvedEntityId('track'),
      extraJoins: entityMergeJoin('track', userId),
      filter: sql``,
      finalJoin: sql`
        JOIN tracks t ON t.spotify_id = eid
        LEFT JOIN albums al ON al.spotify_id = t.album_id
      `,
      finalName: sql`t.name`,
      finalImg: sql`al.image_url`,
      finalArtistId: primaryArtistOf(sql`eid`, userId),
      finalArtistName: artistNameOf(primaryArtistOf(sql`eid`, userId)),
    };
  }
  if (entity === 'album') {
    return {
      eidExpr: resolvedEntityId('album'),
      extraJoins: resolvedPlayJoins('album', userId),
      filter: sql`AND t.album_id IS NOT NULL`,
      finalJoin: sql`JOIN albums al ON al.spotify_id = eid`,
      finalName: sql`al.name`,
      finalImg: sql`al.image_url`,
      finalArtistId: albumArtistId(sql`eid`, userId),
      finalArtistName: albumArtistName(sql`eid`, userId),
    };
  }
  // artist
  return {
    eidExpr: resolvedEntityId('artist'),
    extraJoins: sql`JOIN ${trackArtistsFor(userId)} ta ON ta.track_id = lh.track_id ${entityMergeJoin('artist', userId)}`,
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

// mes de un play en la zona del usuario, el mismo que etiqueta los charts mensuales
const localMonth = (timeZone: string) => sql`strftime('%Y-%m', ${localPlayedAt(timeZone)})`;

export function computeMostUniquePerMonth(entity: Ent, db: Db, userId: number, limit: number, calendar: PeriodCalendar): MonthCountEntry[] {
  const ctx = entityCtx(entity, userId);
  const rows = db.all(sql`
    SELECT ${localMonth(calendar.timeZone)} AS month,
           COUNT(DISTINCT ${ctx.eidExpr}) AS count
    FROM listening_history lh ${ctx.extraJoins}
    WHERE lh.user_id = ${userId} ${ctx.filter}
    GROUP BY month
    ORDER BY count DESC
    LIMIT ${limit}
  `) as any[];

  const months = rows.map(r => ({ month: r.month as string, count: Number(r.count) }));
  if (months.length === 0) return months.map(m => ({ ...m, covers: [] }));

  const coversByMonth = fetchMonthCovers(entity, db, userId, months.map(m => m.month), calendar.timeZone);
  return months.map(m => ({ ...m, covers: coversByMonth.get(m.month) ?? [] }));
}

// Top covers por mes para la pestaña activa:
//  - track  → portada de álbum de los top tracks
//  - album  → portada del álbum
//  - artist → foto del artista
function fetchMonthCovers(entity: Ent, db: Db, userId: number, months: string[], timeZone: string): Map<string, string[]> {
  const perMonth = 4;
  const month = localMonth(timeZone);
  const monthList = sql.join(months.map(m => sql`${m}`), sql`, `);
  // '' es el centinela de "buscado sin resultado" en albums y artists: no es una
  // portada, así que no puede ocupar un hueco del mosaico
  const hasCover = (col: SqlChunk) => sql`${col} IS NOT NULL AND ${col} != ''`;

  let query;
  if (entity === 'track') {
    query = sql`
      WITH ranked AS (
        SELECT ${month} AS month,
               al.image_url AS image_url,
               ROW_NUMBER() OVER (
                 PARTITION BY ${month}
                 ORDER BY COUNT(*) DESC
               ) AS rn
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN albums al ON al.spotify_id = t.album_id
        WHERE lh.user_id = ${userId}
          AND ${hasCover(sql`al.image_url`)}
          AND ${month} IN (${monthList})
        GROUP BY month, lh.track_id
      )
      SELECT month, image_url FROM ranked WHERE rn <= ${perMonth}
      ORDER BY month, rn
    `;
  } else if (entity === 'album') {
    query = sql`
      WITH ranked AS (
        SELECT ${month} AS month,
               al.image_url AS image_url,
               ROW_NUMBER() OVER (
                 PARTITION BY ${month}
                 ORDER BY COUNT(*) DESC
               ) AS rn
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        JOIN albums al ON al.spotify_id = t.album_id
        WHERE lh.user_id = ${userId}
          AND ${hasCover(sql`al.image_url`)}
          AND ${month} IN (${monthList})
        GROUP BY month, al.spotify_id
      )
      SELECT month, image_url FROM ranked WHERE rn <= ${perMonth}
      ORDER BY month, rn
    `;
  } else {
    query = sql`
      WITH ranked AS (
        SELECT ${month} AS month,
               a.image_url AS image_url,
               ROW_NUMBER() OVER (
                 PARTITION BY ${month}
                 ORDER BY COUNT(*) DESC
               ) AS rn
        FROM listening_history lh
        JOIN ${trackArtistsFor(userId)} ta ON ta.track_id = lh.track_id AND ta.position = 0
        JOIN artists a ON a.spotify_id = ta.artist_id
        WHERE lh.user_id = ${userId}
          AND ${hasCover(sql`a.image_url`)}
          AND ${month} IN (${monthList})
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

export function computeMostDistinctTracks(entity: 'artist', db: Db, userId: number, limit: number): RecordEntry[] {
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

// --- records de directo (concerts / concert_songs) ---
//
// Los dos son conteos: no dependen de `sort` (time|plays) ni de los charts semanales.
// El merge se resuelve inline y no con entityMergeJoin() porque los helpers de
// merge asumen los alias del historial (lh.track_id / ta.artist_id) y aquí la
// columna de origen está en las tablas del log de conciertos.

/** Artistas que más veces has visto en directo. El concierto se guarda contra el
 *  artista visitado, así que el conteo resuelve el grupo de merge igual que el
 *  resto del log: dos alias fusionados son el mismo artista y suman juntos.
 *
 *  Sin umbral: a diferencia de los demás records, haber visto a alguien una vez ya
 *  es el hecho que se rankea, y el top se corta por `limit`. */
export function computeMostConcerts(db: Db, userId: number, limit: number): RecordEntry[] {
  const rows = db.all(sql`
    WITH agg AS (
      SELECT COALESCE(mr_a.target_id, c.artist_id) AS eid, COUNT(*) AS shows
      FROM concerts c
      LEFT JOIN merge_rules mr_a ON mr_a.entity_type = 'artist' AND mr_a.source_id = c.artist_id AND mr_a.user_id = ${userId}
      WHERE c.user_id = ${userId}
      GROUP BY eid
    )
    SELECT agg.eid AS eid, agg.shows AS value,
           a.name AS name, a.image_url AS image_url,
           NULL AS artist_id, NULL AS artist_name
    FROM agg
    JOIN artists a ON a.spotify_id = agg.eid
    ORDER BY agg.shows DESC, a.name ASC
    LIMIT ${limit}
  `) as any[];

  return rows.map(r => mapSimple(r));
}

/** Temas que sonaron en más conciertos de los que fuiste. Sólo lo alimentan los
 *  setlists importados con la canción emparejada a la librería (track_id NULL =
 *  "no la tienes", que es una respuesta válida pero no una entidad que rankear).
 *
 *  DISTINCT concert_id: un bis o un medley repiten el tema esa misma noche y aquí
 *  cuenta el bolo, no cada interpretación — igual que getTrackLiveConcerts.
 *
 *  > 1 porque un tema oído en un único concierto no es un récord: sería medio
 *  setlist empatado a 1 y ordenado al azar (misma regla que inMostPlaylists). */
export function computeMostHeardLive(db: Db, userId: number, limit: number): RecordEntry[] {
  const ctx = entityCtx('track', userId);
  const rows = db.all(sql`
    WITH agg AS (
      SELECT COALESCE(mr_t.target_id, cs.track_id) AS eid, COUNT(DISTINCT cs.concert_id) AS shows
      FROM concert_songs cs
      JOIN concerts c ON c.id = cs.concert_id
      LEFT JOIN merge_rules mr_t ON mr_t.entity_type = 'track' AND mr_t.source_id = cs.track_id AND mr_t.user_id = ${userId}
      WHERE c.user_id = ${userId} AND cs.track_id IS NOT NULL
      GROUP BY eid
    )
    SELECT agg.eid AS eid, agg.shows AS value,
           ${ctx.finalName} AS name,
           ${ctx.finalImg} AS image_url,
           ${ctx.finalArtistId} AS artist_id,
           ${ctx.finalArtistName} AS artist_name
    FROM agg
    ${ctx.finalJoin}
    WHERE agg.shows > 1
    ORDER BY agg.shows DESC, ${ctx.finalName} ASC
    LIMIT ${limit}
  `) as any[];

  return rows.map(r => mapSimple(r));
}

// year-end: charts de cada año completado. Sólo incluye años anteriores al actual
// (el año en curso todavía no "terminó"). De la misma pasada salen los year-end
// finishes (top-10, para accolades) y la media de puesto anual, que necesita el
// chart entero (top CHART_SIZE): pedir 25 filas en vez de 10 no cuesta nada, el
// GROUP BY materializa el año completo igual
const YEAR_END_LIMIT = 10;
type YearChart = { year: number; rows: AggregateRow[] };

// años y sus límites en la zona del usuario, los del chart anual
export function computeYearFinishes(entity: Ent, db: Db, userId: number, sort: Sort, calendar: PeriodCalendar, limit: number): Pick<EntityRecords, 'yearEndFinishes' | 'averageYearFinish'> {
  const { weekStart, timeZone } = calendar;
  const currentYear = Number(periodForDate(new Date(), 'year', weekStart, timeZone));
  const localYear = sql`CAST(strftime('%Y', ${localPlayedAt(timeZone)}) AS INTEGER)`;
  const years = db.all(sql`
    SELECT DISTINCT ${localYear} AS y
    FROM listening_history lh
    WHERE lh.user_id = ${userId} AND ${localYear} < ${currentYear}
    ORDER BY y ASC
  `) as { y: number }[];

  const charts: YearChart[] = years.flatMap(({ y }) => {
    const bounds = periodBounds(String(y), 'year', weekStart, timeZone);
    if (!bounds) return [];
    // getTopEntities cierra con `<=`: el instante anterior al año siguiente
    const yearEnd = new Date(Date.parse(bounds.end) - 1).toISOString();
    return [{ year: y, rows: getTopEntities(db, entity, bounds.start, sort, CHART_SIZE, yearEnd, userId) }];
  });

  const yearEndFinishes: YearEndFinish[] = charts.flatMap(({ year, rows }) =>
    rows.slice(0, YEAR_END_LIMIT).map((row, i) => ({
      year,
      entityId: row.entity_id,
      rank: i + 1,
      value: Number(sort === 'plays' ? row.play_count : row.total_ms),
    })),
  );

  return { yearEndFinishes, averageYearFinish: averageYearFinish(entity, db, userId, charts, limit) };
}

// media del puesto final en los años en que la entidad entró en el chart anual. Los
// años fuera del chart no cuentan: unos plays sueltos antes de descubrirla (#1150) se
// comerían una racha de #1 posterior. Un año malo tampoco resta, así que mide lo alto
// que acaba cuando acaba arriba; cuántos años lo hizo va en `finishes`
function averageYearFinish(entity: Ent, db: Db, userId: number, charts: YearChart[], limit: number): RecordEntry[] {
  const byEntity = charts
    .flatMap(({ year, rows }) => rows.map((row, i) => ({ eid: row.entity_id, year, rank: i + 1 })))
    .reduce((acc, { eid, year, rank }) => acc.set(eid, [...(acc.get(eid) ?? []), { year, rank }]), new Map<string, YearRank[]>());

  const ranked = [...byEntity]
    .filter(([, finishes]) => finishes.length >= AVG_YEAR_FINISH_MIN_YEARS)
    .map(([eid, finishes]) => ({ eid, finishes, avg: finishes.reduce((s, f) => s + f.rank, 0) / finishes.length }))
    // a igual media, más años arriba es más mérito
    .sort((a, b) => a.avg - b.avg || b.finishes.length - a.finishes.length)
    .slice(0, limit);
  if (ranked.length === 0) return [];

  // nombre, imagen y artista con los mismos fragmentos que el resto de records
  const ctx = entityCtx(entity, userId);
  const meta = new Map((db.all(sql`
    WITH picked(eid) AS (VALUES ${sql.join(ranked.map(r => sql`(${r.eid})`), sql`, `)})
    SELECT picked.eid AS eid,
           ${ctx.finalName} AS name,
           ${ctx.finalImg} AS image_url,
           ${ctx.finalArtistId} AS artist_id,
           ${ctx.finalArtistName} AS artist_name
    FROM picked
    ${ctx.finalJoin}
  `) as any[]).map(r => [r.eid as string, r]));

  return ranked
    .filter(r => meta.has(r.eid))
    .map(r => ({ ...mapSimple({ ...meta.get(r.eid), value: r.avg }), finishes: r.finishes }));
}

// --- media de puesto de los álbumes de un artista ---

// puesto all-time de cada álbum (el ranking de /top, singles incluidos) junto a cada
// artista al que se le acredita, con el peso del álbum en la métrica del usuario.
// el crédito es el de la página del artista (artistCreditedAlbums) mirado sobre la fila
// resuelta: la lista corregida del usuario si existe; si no, `artist_ids` en cualquier
// posición; sin crédito de álbum (sintéticos), quien lidera la mayoría de lo ingestado;
// y una colección, de quien la creó.
//
// los singles se rankean pero no son álbumes de nadie: con ellos Angèle tenía cinco
// "álbumes" y dos eran singles de un play en el #8000. Los de spotify traen su
// album_type; un sintético no, así que uno de un solo tema que se llama como él
// es el single de ese tema (101 de 450 en local; el resto son discos con un tema ingestado)
type AlbumRankRow = { artist_id: string; eid: string; rnk: number; val: number };

function artistAlbumRanks(db: Db, userId: number, sort: Sort): AlbumRankRow[] {
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;
  const notOverridden = sql`NOT EXISTS (SELECT 1 FROM credit_overrides co_x WHERE co_x.user_id = ${userId}
    AND co_x.subject_type = 'album' AND co_x.subject_id = r.eid)`;
  const syntheticSingle = sql`al.album_type IS NULL AND COALESCE((SELECT COUNT(*) = 1 AND LOWER(MAX(t_s.name)) = LOWER(al.name)
    FROM tracks t_s WHERE t_s.album_id = r.eid), 0)`;
  return db.all(sql`
    WITH ranked AS (
      SELECT eid, val, ROW_NUMBER() OVER (ORDER BY val DESC) AS rnk
      FROM (
        SELECT ${resolvedEntityId('album')} AS eid, ${metric} AS val
        FROM listening_history lh
        ${resolvedPlayJoins('album', userId)}
        WHERE lh.user_id = ${userId} ${albumNullFilter('album')}
        GROUP BY 1
      )
    ),
    uncredited AS (
      SELECT r.eid FROM ranked r JOIN albums al ON al.spotify_id = r.eid
      WHERE json_extract(al.artist_ids, '$[0]') IS NULL AND r.eid NOT LIKE ${COLLECTION_ID_PREFIX + '%'} AND ${notOverridden}
    ),
    led AS (
      SELECT t.album_id AS eid, ta.artist_id, COUNT(*) AS n, SUM(COUNT(*)) OVER (PARTITION BY t.album_id) AS total
      FROM tracks t
      JOIN ${trackArtistsFor(userId)} ta ON ta.track_id = t.spotify_id AND ta.position = 0
      WHERE t.album_id IN (SELECT eid FROM uncredited)
      GROUP BY t.album_id, ta.artist_id
    ),
    credited(eid, artist_id) AS (
      SELECT co.subject_id, co.artist_id FROM credit_overrides co
      WHERE co.user_id = ${userId} AND co.subject_type = 'album' AND co.subject_id IN (SELECT eid FROM ranked)
      UNION
      SELECT r.eid, ac.artist_id FROM ranked r
      JOIN album_collections ac ON ${COLLECTION_ID_PREFIX} || ac.id = r.eid
      WHERE ${notOverridden}
      UNION
      SELECT r.eid, je.value FROM ranked r
      JOIN albums al ON al.spotify_id = r.eid, json_each(al.artist_ids) je
      WHERE ${notOverridden}
      UNION
      SELECT eid, artist_id FROM led WHERE n * 2 > total
    )
    -- DISTINCT: dos acreditados del mismo grupo de merge son un solo artista
    SELECT DISTINCT COALESCE(mr.target_id, c.artist_id) AS artist_id, r.eid, r.rnk, r.val
    FROM credited c
    JOIN ranked r ON r.eid = c.eid
    JOIN albums al ON al.spotify_id = r.eid
    LEFT JOIN merge_rules mr ON mr.entity_type = 'artist' AND mr.source_id = c.artist_id AND mr.user_id = ${userId}
    WHERE al.album_type IS NOT 'single' AND NOT (${syntheticSingle})
  `) as AlbumRankRow[];
}

// media del puesto all-time de los álbumes de cada artista, ponderada por lo que pesa
// cada uno en la métrica: dice dónde cae, de media, lo que escuchas de sus discos. Con
// la media a secas, un artista con mucho catálogo se hundía por los discos que nunca
// pasaron del #1000. Ponderar no basta: el puesto no tiene techo, así que 8 minutos en
// el #9000 sumaban 11 puestos a Angèle; fuera del top de /top todo cuenta como el
// primero de fuera, y un disco olvidado resta lo que pesa, nada más.
// hacen falta AVG_ALBUM_RANK_MIN_ALBUMS dentro del top, por la misma razón que los años
// de la media year-end: con uno, la "media" sería ese disco
export function computeAverageAlbumRank(db: Db, userId: number, sort: Sort, limit: number): RecordEntry[] {
  const ceiling = AVG_ALBUM_RANK_TOP + 1;
  const byArtist = artistAlbumRanks(db, userId, sort)
    .reduce((acc, row) => (acc.get(row.artist_id)?.push(row) ?? acc.set(row.artist_id, [row]), acc), new Map<string, AlbumRankRow[]>());

  const ranked = [...byArtist]
    .map(([artistId, albums]) => {
      const weight = albums.reduce((s, a) => s + (Number(a.val) || 0), 0);
      const avg = albums.reduce((s, a) => s + Math.min(a.rnk, ceiling) * (Number(a.val) || 0), 0) / weight;
      return { artistId, avg, charted: albums.filter(a => a.rnk <= AVG_ALBUM_RANK_TOP).sort((a, b) => a.rnk - b.rnk) };
    })
    .filter(r => r.charted.length >= AVG_ALBUM_RANK_MIN_ALBUMS && Number.isFinite(r.avg))
    // a igual media, más discos en el top es más mérito
    .sort((a, b) => a.avg - b.avg || b.charted.length - a.charted.length)
    .slice(0, limit);
  if (ranked.length === 0) return [];

  const values = (ids: string[]) => sql.join(ids.map(id => sql`(${id})`), sql`, `);
  const names = (rows: any[]) => new Map(rows.map(r => [r.id as string, r]));
  const artists = names(db.all(sql`
    WITH picked(id) AS (VALUES ${values(ranked.map(r => r.artistId))})
    SELECT picked.id AS id, a.name, a.image_url FROM picked JOIN artists a ON a.spotify_id = picked.id
  `) as any[]);
  const albums = names(db.all(sql`
    WITH picked(id) AS (VALUES ${values([...new Set(ranked.flatMap(r => r.charted.map(a => a.eid)))])})
    SELECT picked.id AS id, al.name FROM picked JOIN albums al ON al.spotify_id = picked.id
  `) as any[]);

  return ranked
    .filter(r => artists.has(r.artistId))
    .map(r => ({
      ...mapSimple({ ...artists.get(r.artistId), eid: r.artistId, value: r.avg }),
      albumRanks: r.charted.map(a => ({ albumId: a.eid, name: albums.get(a.eid)?.name ?? 'unknown', rank: a.rnk })),
    }));
}

// --- most accolades: cuenta en cuántas listas de records aparece cada entidad ---

export function computeMostAccolades(
  data: EntityRecords & Partial<TrackRecords & AlbumRecords & ArtistRecordsData>,
): RecordEntry[] {
  const counts = new Map<string, RecordEntry>();

  // una lista suma uno por entidad, como el badge del hero: con "record entries" en
  // duplicados, contar filas daba tres records a quien tiene tres semanas en peak week
  function tally(list: RecordEntry[]) {
    for (const e of topDistinctEntries(list, (entry) => entry.entityId, RECORDS_LIMIT)) {
      const prev = counts.get(e.entityId);
      if (prev) { prev.value++; }
      else { counts.set(e.entityId, { ...e, value: 1, week: null }); }
    }
  }

  tally(data.peakWeekPlays);
  tally(data.dominance);
  tally(data.biggestDebuts);
  tally(data.mostWeeksAtNo1);
  tally(data.bubblingUnder);
  tally(data.mostWeeksInTop5);
  tally(data.longestChartRun);
  tally(data.averageYearFinish);
  if (data.averageAlbumRank) tally(data.averageAlbumRank);
  tally(data.inMostPlaylists);
  tally(data.longestGap);
  tally(data.goldenOldies);
  tally(data.latestDiscoveries);


  if (data.mostDistinctTracks) tally(data.mostDistinctTracks);
  if (data.oneHitWonders) tally(data.oneHitWonders);
  if (data.mostHeardLive) tally(data.mostHeardLive);
  if (data.mostConcerts) tally(data.mostConcerts);

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
