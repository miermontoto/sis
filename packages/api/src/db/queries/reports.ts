// report periódico (semana / mes / año cerrados) estilo last.fm: todas las secciones
// de una vez. el periodo se filtra por límites [start, end) —rangos indexados por
// (user_id, played_at)— y no con `periodExpr() = period` como los charts, que obliga
// a un scan completo del historial por query; un report son una docena de ellas.
// los buckets diarios y los días de la semana van en UTC, como los límites del
// periodo y los charts; solo el reloj por horas se desplaza a la hora local del
// cliente (tzOffsetMinutes), que es donde un desfase de dos horas se nota
import { sql } from 'drizzle-orm';
import type {
  Granularity, WeekStartOption, RankingMetric, ListeningTimeItem,
  TopArtistItem, TopAlbumItem, TopTrackItem,
  ReportResponse, ReportSummary, ReportFacts, ReportGenre, ReportDecade, ReportDiscovery,
  ReportDiscoveryStat, ReportNewPick, ReportMonth, ReportMilestone, ReportEntityRef, ReportPlayRef,
} from '@sis/shared';
import {
  periodBounds, adjacentPeriod, isClosedPeriod,
  REPORT_TOP_LIMIT, REPORT_GENRES_LIMIT, REPORT_GENRES_PREV_LIMIT,
} from '@sis/shared';
import type { Db, SqlChunk, AggregateRow } from './helpers.js';
import { playDuration, resolvedEntityId, entityMergeJoin, trackJoinResolvingMerges } from './helpers.js';
import { getTopEntities, getPrevPeriodEntities, getGlobalSeries } from './entity.js';
import { getTopGenres } from './inline.js';
import { getProfileSummary } from './social.js';
import { formatTopTrackRows, formatTopArtistRow, formatTopAlbumRow, lookupArtist, lookupAlbum } from './formatters.js';
import { getAlbumArtists } from './album.js';
import { enrichTracksBatch } from './track.js';
import { MILESTONE_THRESHOLDS } from '../../constants.js';

const DAY_MS = 86_400_000;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const DECADE_YEARS = 10;
const PCT = 100;
// release_date puede ser 'YYYY', 'YYYY-MM' o 'YYYY-MM-DD': el año son sus 4 primeros chars
const RELEASE_YEAR_CHARS = 4;

type Sort = RankingMetric;

interface PrevRank { previousRank: number | null; rankChange: number | null; isNew: boolean }

// los helpers de rango existentes cierran con `<=`: el instante justo antes del
// inicio del periodo siguiente equivale al `<` de los límites del periodo
const inclusiveEnd = (end: string) => new Date(Date.parse(end) - 1).toISOString();

// modificador de strftime con el desfase del cliente ('+120 minutes', '-300 minutes')
const tzModifier = (minutes: number) => `${minutes < 0 ? '-' : '+'}${Math.abs(minutes)} minutes`;

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, total: number) => total > 0 ? round1((part / total) * PCT) : 0;

function periodWhere(userId: number, start: string, end: string): SqlChunk {
  return sql`lh.user_id = ${userId} AND lh.played_at >= ${start} AND lh.played_at < ${end}`;
}

// cambio de puesto respecto al periodo anterior, mismo contrato que los top-* de /stats
function prevRankFields(prevIds: string[] | null, id: string, rank: number): PrevRank {
  if (!prevIds) return { previousRank: null, rankChange: null, isNew: false };
  const idx = prevIds.indexOf(id);
  const previousRank = idx < 0 ? null : idx + 1;
  return { previousRank, rankChange: previousRank === null ? null : previousRank - rank, isNew: previousRank === null };
}

function toSummary(row: ReturnType<typeof getProfileSummary>, activeDays: number, start: string, end: string): ReportSummary {
  return {
    plays: row.play_count,
    totalMs: row.total_ms,
    distinctArtists: row.distinct_artists,
    distinctTracks: row.distinct_tracks,
    distinctAlbums: row.distinct_albums,
    activeDays,
    days: Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS),
  };
}

function activeDayCount(db: Db, userId: number, start: string, end: string): number {
  const row = db.get(sql`
    SELECT count(DISTINCT date(lh.played_at)) AS c FROM listening_history lh WHERE ${periodWhere(userId, start, end)}
  `) as { c: number } | undefined;
  return row?.c ?? 0;
}

// --- reloj y días de la semana ---

/** Plays por hora local (24 posiciones). Exportado aparte: es la única sección que
 *  depende de la zona horaria del cliente, así que la cache la recalcula al servir. */
export function getReportClock(db: Db, userId: number, start: string, end: string, tzOffsetMinutes: number): number[] {
  const rows = db.all(sql`
    SELECT cast(strftime('%H', lh.played_at, ${tzModifier(tzOffsetMinutes)}) AS integer) AS hour, count(*) AS c
    FROM listening_history lh
    WHERE ${periodWhere(userId, start, end)}
    GROUP BY hour
  `) as { hour: number; c: number }[];
  const clock = new Array<number>(HOURS_PER_DAY).fill(0);
  rows.forEach(r => { clock[r.hour] = r.c; });
  return clock;
}

function getWeekdays(db: Db, userId: number, start: string, end: string): number[] {
  const rows = db.all(sql`
    SELECT cast(strftime('%w', lh.played_at) AS integer) AS dow, count(*) AS c
    FROM listening_history lh
    WHERE ${periodWhere(userId, start, end)}
    GROUP BY dow
  `) as { dow: number; c: number }[];
  const days = new Array<number>(DAYS_PER_WEEK).fill(0);
  rows.forEach(r => { days[r.dow] = r.c; });
  return days;
}

// --- quick facts ---

function edgePlay(db: Db, userId: number, start: string, end: string, edge: 'first' | 'last'): { track_id: string; played_at: string } | undefined {
  const order = edge === 'first' ? sql`ASC` : sql`DESC`;
  return db.get(sql`
    SELECT lh.track_id, lh.played_at FROM listening_history lh
    WHERE ${periodWhere(userId, start, end)}
    ORDER BY lh.played_at ${order}
    LIMIT 1
  `) as { track_id: string; played_at: string } | undefined;
}

// racha más larga de días consecutivos con plays, sobre la serie diaria (UTC)
function longestStreak(daily: ListeningTimeItem[]): number {
  let best = 0;
  let run = 0;
  let prevDay = Number.NaN;
  for (const d of daily) {
    const day = Date.parse(d.period) / DAY_MS;
    run = day === prevDay + 1 ? run + 1 : 1;
    prevDay = day;
    if (run > best) best = run;
  }
  return best;
}

function buildFacts(db: Db, userId: number, start: string, end: string, daily: ListeningTimeItem[], clock: number[], summary: ReportSummary, topTrack: TopTrackItem | undefined): ReportFacts {
  const busiest = daily.reduce<ListeningTimeItem | null>((acc, d) => (!acc || d.play_count > acc.play_count ? d : acc), null);
  const maxHour = Math.max(...clock);
  const first = edgePlay(db, userId, start, end, 'first');
  const last = edgePlay(db, userId, start, end, 'last');
  const tracks = enrichTracksBatch(db, [first?.track_id, last?.track_id].filter((id): id is string => !!id));
  const toRef = (row: { track_id: string; played_at: string } | undefined): ReportPlayRef | null =>
    row ? { playedAt: row.played_at, track: tracks.get(row.track_id) ?? null } : null;

  return {
    busiestDay: busiest ? { date: busiest.period, plays: busiest.play_count, totalMs: busiest.total_ms } : null,
    busiestHour: maxHour > 0 ? clock.indexOf(maxHour) : null,
    longestStreak: longestStreak(daily),
    firstPlay: toRef(first),
    lastPlay: toRef(last),
    topTrackShare: topTrack ? pct(topTrack.playCount, summary.plays) : 0,
  };
}

// --- tops con cambio de puesto ---

function topWithChanges<T extends object>(rows: AggregateRow[], formatted: T[], prevIds: string[] | null) {
  return formatted.map((item, i) => ({ ...item, ...prevRankFields(prevIds, rows[i].entity_id, i + 1) }));
}

function getTops(db: Db, userId: number, start: string, end: string, prev: { start: string; end: string } | null, sort: Sort) {
  const endIncl = inclusiveEnd(end);
  const prevIds = (type: 'artist' | 'album' | 'track') =>
    prev ? getPrevPeriodEntities(db, type, prev.start, prev.end, sort, userId).map(r => r.entity_id) : null;

  const artistRows = getTopEntities(db, 'artist', start, sort, REPORT_TOP_LIMIT, endIncl, userId);
  const albumRows = getTopEntities(db, 'album', start, sort, REPORT_TOP_LIMIT, endIncl, userId);
  const trackRows = getTopEntities(db, 'track', start, sort, REPORT_TOP_LIMIT, endIncl, userId);

  return {
    artists: topWithChanges(artistRows, artistRows.map(r => formatTopArtistRow(db, r)), prevIds('artist')) as TopArtistItem[],
    albums: topWithChanges(albumRows, albumRows.map(r => formatTopAlbumRow(db, r)), prevIds('album')) as TopAlbumItem[],
    tracks: topWithChanges(trackRows, formatTopTrackRows(db, trackRows), prevIds('track')) as TopTrackItem[],
  };
}

// --- géneros ---

function getGenres(db: Db, userId: number, start: string, end: string, prev: { start: string; end: string } | null, totalPlays: number): ReportGenre[] {
  const rows = getTopGenres(db, start, inclusiveEnd(end), REPORT_GENRES_LIMIT, userId);
  const prevGenres = prev ? getTopGenres(db, prev.start, inclusiveEnd(prev.end), REPORT_GENRES_PREV_LIMIT, userId).map(g => g.genre) : null;
  return rows.map((g, i) => {
    const { rankChange, isNew } = prevRankFields(prevGenres, g.genre, i + 1);
    return { genre: g.genre, plays: g.play_count, pct: pct(g.play_count, totalPlays), rankChange, isNew };
  });
}

// % de plays con algún artista (resuelto) que tiene géneros: la base real del top de géneros
function genreCoverage(db: Db, userId: number, start: string, end: string, totalPlays: number): number {
  const row = db.get(sql`
    SELECT count(*) AS c FROM listening_history lh
    WHERE ${periodWhere(userId, start, end)} AND EXISTS (
      SELECT 1 FROM track_artists ta
      LEFT JOIN merge_rules mr_artist ON mr_artist.entity_type = 'artist' AND mr_artist.source_id = ta.artist_id AND mr_artist.user_id = ${userId}
      JOIN artists a ON a.spotify_id = COALESCE(mr_artist.target_id, ta.artist_id)
      WHERE ta.track_id = lh.track_id AND json_array_length(a.genres) > 0
    )
  `) as { c: number } | undefined;
  return pct(row?.c ?? 0, totalPlays);
}

// --- décadas ---

// año de lanzamiento del álbum resuelto (merges de track y de álbum) truncado a década.
// los enteros van en crudo: como parámetros better-sqlite3 los liga como REAL y la
// división deja de ser entera (cada año salía como su propia "década")
const decadeExpr = sql`(cast(substr(al.release_date, 1, ${sql.raw(String(RELEASE_YEAR_CHARS))}) AS integer) / ${sql.raw(String(DECADE_YEARS))}) * ${sql.raw(String(DECADE_YEARS))}`;

function albumJoins(userId: number): SqlChunk {
  return sql`${trackJoinResolvingMerges(userId)} ${entityMergeJoin('album', userId)}
    JOIN albums al ON al.spotify_id = ${resolvedEntityId('album')}`;
}

function getDecades(db: Db, userId: number, start: string, end: string, totalPlays: number): ReportDecade[] {
  const totals = db.all(sql`
    SELECT ${decadeExpr} AS decade, count(*) AS plays
    FROM listening_history lh
    ${albumJoins(userId)}
    WHERE ${periodWhere(userId, start, end)} AND length(al.release_date) >= ${RELEASE_YEAR_CHARS}
    GROUP BY decade
    HAVING decade > 0
    ORDER BY decade
  `) as { decade: number; plays: number }[];
  if (totals.length === 0) return [];

  // artista principal más oído dentro de cada década, solo para la etiqueta de la barra:
  // el total de la década sale de la query de arriba, sin el join de artistas
  const leaders = db.all(sql`
    WITH d AS (
      SELECT ${decadeExpr} AS decade, ${resolvedEntityId('artist')} AS artist_id, count(*) AS plays
      FROM listening_history lh
      ${albumJoins(userId)}
      JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
      ${entityMergeJoin('artist', userId)}
      WHERE ${periodWhere(userId, start, end)} AND length(al.release_date) >= ${RELEASE_YEAR_CHARS}
      GROUP BY 1, 2
    )
    SELECT decade, artist_id FROM (
      SELECT d.*, row_number() OVER (PARTITION BY decade ORDER BY plays DESC, artist_id) AS rn FROM d
    ) WHERE rn = 1
  `) as { decade: number; artist_id: string }[];
  const leaderByDecade = new Map(leaders.map(l => [l.decade, l.artist_id]));

  return totals.map(t => ({
    decade: t.decade,
    plays: t.plays,
    pct: pct(t.plays, totalPlays),
    topArtist: artistRef(db, leaderByDecade.get(t.decade)),
  }));
}

function artistRef(db: Db, id: string | undefined): ReportEntityRef | null {
  if (!id) return null;
  const a = lookupArtist(db, id);
  return a ? { id, name: a.name, imageUrl: a.imageUrl } : null;
}

// --- discovery: "nuevo para ti" = primer play de la historia dentro del periodo ---
// (los GROUP BY de las CTEs van por ordinal: un alias como `id` o `artist_id` se
// resuelve antes contra las columnas de merge_rules / track_artists que contra el alias)

// ids de la entidad y de los sources que se han mergeado en ella
function mergeGroup(type: 'artist' | 'album' | 'track', userId: number, idCol: SqlChunk): SqlChunk {
  return sql`SELECT ${idCol} UNION SELECT mr.source_id FROM merge_rules mr WHERE mr.entity_type = ${type} AND mr.user_id = ${userId} AND mr.target_id = ${idCol}`;
}

// NOT EXISTS sobre (user_id, track_id, played_at): un probe indexado por entidad del
// periodo en vez de un MIN(played_at) por entidad sobre el historial entero
function noPlayBefore(userId: number, start: string, trackIds: SqlChunk): SqlChunk {
  return sql`NOT EXISTS (
    SELECT 1 FROM listening_history lh2
    WHERE lh2.user_id = ${userId} AND lh2.played_at < ${start} AND lh2.track_id IN (${trackIds})
  )`;
}

interface DiscoveryTotals { total: number; new_count: number; total_plays: number; new_plays: number }
// estreno más escuchado del tipo según la métrica del usuario (null sin estrenos)
interface DiscoveryTop { top_id: string | null; top_plays: number | null; top_ms: number | null }

function toDiscoveryStat(t: DiscoveryTotals | undefined): ReportDiscoveryStat {
  const total = t?.total ?? 0;
  const newCount = t?.new_count ?? 0;
  const newPlays = t?.new_plays ?? 0;
  return { newCount, totalCount: total, pct: pct(newCount, total), newPlays, playsPct: pct(newPlays, t?.total_plays ?? 0) };
}

const metricCol = (sort: Sort) => sort === 'plays' ? sql`plays` : sql`total_ms`;

// totales del tipo y su estreno más escuchado en una pasada: la CTE con el probe se
// materializa y los escalares del top leen de ella en vez de repetir el probe
function discoveryTotals(db: Db, period: SqlChunk, isNew: SqlChunk, sort: Sort): (DiscoveryTotals & DiscoveryTop) | undefined {
  const top = (col: SqlChunk) => sql`(SELECT ${col} FROM q WHERE is_new ORDER BY ${metricCol(sort)} DESC, id LIMIT 1)`;
  return db.get(sql`
    WITH p AS (${period}),
    q AS MATERIALIZED (SELECT p.id, p.plays, p.total_ms, ${isNew} AS is_new FROM p)
    SELECT count(*) AS total, sum(is_new) AS new_count, sum(plays) AS total_plays,
      sum(CASE WHEN is_new THEN plays ELSE 0 END) AS new_plays,
      ${top(sql`id`)} AS top_id, ${top(sql`plays`)} AS top_plays, ${top(sql`total_ms`)} AS top_ms
    FROM q
  `) as (DiscoveryTotals & DiscoveryTop) | undefined;
}

function trackDiscovery(db: Db, userId: number, start: string, end: string, sort: Sort) {
  const period = sql`
    SELECT ${resolvedEntityId('track')} AS id, count(*) AS plays, sum(${playDuration()}) AS total_ms
    FROM listening_history lh
    JOIN tracks t ON t.spotify_id = lh.track_id
    ${entityMergeJoin('track', userId)}
    WHERE ${periodWhere(userId, start, end)}
    GROUP BY 1`;
  return discoveryTotals(db, period, noPlayBefore(userId, start, mergeGroup('track', userId, sql`p.id`)), sort);
}

function albumDiscovery(db: Db, userId: number, start: string, end: string, sort: Sort) {
  // tracks del grupo de álbumes (idx_tracks_album_id). los sources de merges de track
  // quedan fuera a propósito: incluirlos obliga a un join merge_rules × tracks por
  // álbum del periodo (5s en un año) para cubrir el caso de un álbum cuyos únicos
  // plays previos fueran de tracks luego mergeados
  const albumTracks = sql`SELECT tr.spotify_id FROM tracks tr WHERE tr.album_id IN (${mergeGroup('album', userId, sql`p.id`)})`;
  const period = sql`
    SELECT ${resolvedEntityId('album')} AS id, count(*) AS plays, sum(${playDuration()}) AS total_ms
    FROM listening_history lh ${trackJoinResolvingMerges(userId)} ${entityMergeJoin('album', userId)}
    WHERE ${periodWhere(userId, start, end)} AND t.album_id IS NOT NULL
    GROUP BY 1`;
  return discoveryTotals(db, period, noPlayBefore(userId, start, albumTracks), sort);
}

// los artistas vuelven fila a fila (agregado por track + expansión a artista resuelto,
// como topArtistsAggregate); totales y estreno se sacan en memoria
function artistDiscovery(db: Db, userId: number, start: string, end: string, sort: Sort) {
  const artistTracks = sql`
    SELECT ta2.track_id FROM track_artists ta2 WHERE ta2.artist_id IN (${mergeGroup('artist', userId, sql`p.id`)})`;
  const rows = db.all(sql`
    WITH p AS (
      SELECT am.artist_id AS id, sum(pt.cnt) AS plays, sum(pt.ms) AS total_ms
      FROM (
        SELECT lh.track_id, count(*) AS cnt, sum(${playDuration()}) AS ms
        FROM listening_history lh
        JOIN tracks t ON t.spotify_id = lh.track_id
        WHERE ${periodWhere(userId, start, end)}
        GROUP BY lh.track_id
      ) pt
      JOIN (
        SELECT DISTINCT ta.track_id, ${resolvedEntityId('artist')} AS artist_id
        FROM track_artists ta ${entityMergeJoin('artist', userId)}
      ) am ON am.track_id = pt.track_id
      GROUP BY am.artist_id
    )
    SELECT p.id, p.plays, p.total_ms, ${noPlayBefore(userId, start, artistTracks)} AS is_new
    FROM p
    ORDER BY ${sort === 'plays' ? sql`p.plays` : sql`p.total_ms`} DESC, p.id
  `) as { id: string; plays: number; total_ms: number; is_new: number }[];

  const totals = rows.reduce<DiscoveryTotals>((acc, r) => ({
    total: acc.total + 1,
    new_count: acc.new_count + r.is_new,
    total_plays: acc.total_plays + r.plays,
    new_plays: acc.new_plays + (r.is_new ? r.plays : 0),
  }), { total: 0, new_count: 0, total_plays: 0, new_plays: 0 });

  return { totals, top: rows.find(r => r.is_new) ?? null };
}

const newPick = (ref: ReportEntityRef | null, plays: number, totalMs: number, artists?: { id: string; name: string }[]): ReportNewPick | null =>
  ref ? { ...ref, plays, totalMs, artists } : null;

function albumPick(db: Db, t: DiscoveryTop | undefined): ReportNewPick | null {
  if (!t?.top_id) return null;
  const album = lookupAlbum(db, t.top_id);
  if (!album) return null;
  const artists = getAlbumArtists(db, t.top_id).map(a => ({ id: a.artist_id, name: a.name }));
  return newPick({ id: t.top_id, name: album.name, imageUrl: album.imageUrl }, t.top_plays ?? 0, t.top_ms ?? 0, artists);
}

function trackPick(db: Db, t: DiscoveryTop | undefined): ReportNewPick | null {
  if (!t?.top_id) return null;
  const track = enrichTracksBatch(db, [t.top_id]).get(t.top_id);
  if (!track) return null;
  return newPick({ id: t.top_id, name: track.name, imageUrl: track.album?.imageUrl ?? null }, t.top_plays ?? 0, t.top_ms ?? 0, track.artists.map(a => ({ id: a.id, name: a.name })));
}

function getDiscovery(db: Db, userId: number, start: string, end: string, sort: Sort): ReportDiscovery {
  const artists = artistDiscovery(db, userId, start, end, sort);
  const albums = albumDiscovery(db, userId, start, end, sort);
  const tracks = trackDiscovery(db, userId, start, end, sort);
  return {
    artists: toDiscoveryStat(artists.totals),
    albums: toDiscoveryStat(albums),
    tracks: toDiscoveryStat(tracks),
    topNew: {
      artist: artists.top ? newPick(artistRef(db, artists.top.id), artists.top.plays, artists.top.total_ms) : null,
      album: albumPick(db, albums),
      track: trackPick(db, tracks),
    },
  };
}

// --- extras del report anual: líder de cada mes ---

function monthlyLeaders(db: Db, userId: number, start: string, end: string, sort: Sort, type: 'artist' | 'track'): Map<string, string> {
  const metric = sort === 'plays' ? sql`count(*)` : sql`sum(${playDuration()})`;
  const joins = type === 'artist'
    ? sql`JOIN tracks t ON t.spotify_id = lh.track_id JOIN track_artists ta ON ta.track_id = lh.track_id AND ta.position = 0 ${entityMergeJoin('artist', userId)}`
    : sql`JOIN tracks t ON t.spotify_id = lh.track_id ${entityMergeJoin('track', userId)}`;
  const rows = db.all(sql`
    WITH m AS (
      SELECT strftime('%Y-%m', lh.played_at) AS month, ${resolvedEntityId(type)} AS id, ${metric} AS val
      FROM listening_history lh ${joins}
      WHERE ${periodWhere(userId, start, end)}
      GROUP BY 1, 2
    )
    SELECT month, id FROM (
      SELECT m.*, row_number() OVER (PARTITION BY month ORDER BY val DESC, id) AS rn FROM m
    ) WHERE rn = 1
  `) as { month: string; id: string }[];
  return new Map(rows.map(r => [r.month, r.id]));
}

function getMonths(db: Db, userId: number, start: string, end: string, sort: Sort): ReportMonth[] {
  const series = getGlobalSeries(db, start, 'month', inclusiveEnd(end), userId);
  const artistByMonth = monthlyLeaders(db, userId, start, end, sort, 'artist');
  const trackByMonth = monthlyLeaders(db, userId, start, end, sort, 'track');
  const tracks = enrichTracksBatch(db, [...trackByMonth.values()]);
  return series.map(s => ({
    month: s.period,
    plays: s.play_count,
    totalMs: s.total_ms,
    topArtist: artistRef(db, artistByMonth.get(s.period)),
    topTrack: tracks.get(trackByMonth.get(s.period) ?? '') ?? null,
  }));
}

// --- milestones: umbrales de plays de la historia cruzados dentro del periodo ---

function getMilestones(db: Db, userId: number, start: string, end: string, periodPlays: number): ReportMilestone[] {
  const before = (db.get(sql`
    SELECT count(*) AS c FROM listening_history lh WHERE lh.user_id = ${userId} AND lh.played_at < ${start}
  `) as { c: number } | undefined)?.c ?? 0;

  const crossed = MILESTONE_THRESHOLDS.filter(n => n > before && n <= before + periodPlays);
  const hits = crossed.flatMap((n) => {
    // el play nº n de la historia es el (n - before)-ésimo del periodo, en orden cronológico
    const row = db.get(sql`
      SELECT lh.track_id, lh.played_at FROM listening_history lh
      WHERE ${periodWhere(userId, start, end)}
      ORDER BY lh.played_at ASC
      LIMIT 1 OFFSET ${n - before - 1}
    `) as { track_id: string; played_at: string } | undefined;
    return row ? [{ n, ...row }] : [];
  });
  const tracks = enrichTracksBatch(db, hits.map(h => h.track_id));
  return hits.map(h => ({ n: h.n, playedAt: h.played_at, track: tracks.get(h.track_id) ?? null }));
}

// --- ensamblado ---

function firstPlayedAt(db: Db, userId: number): string | null {
  const row = db.get(sql`SELECT min(played_at) AS first FROM listening_history WHERE user_id = ${userId}`) as { first: string | null } | undefined;
  return row?.first ?? null;
}

/** Report completo de un periodo cerrado. null si la etiqueta no existe en el calendario. */
export function getReport(db: Db, userId: number, granularity: Granularity, period: string, weekStart: WeekStartOption, sort: Sort, tzOffsetMinutes: number): ReportResponse | null {
  const bounds = periodBounds(period, granularity, weekStart);
  if (!bounds) return null;
  const { start, end } = bounds;

  // periodo anterior solo si el usuario ya tenía historial entonces; siguiente solo si ya cerró
  const prevLabel = adjacentPeriod(period, granularity, weekStart, -1);
  const prevBounds = prevLabel ? periodBounds(prevLabel, granularity, weekStart) : null;
  const first = firstPlayedAt(db, userId);
  const prev = prevBounds && first && prevBounds.end > first ? prevBounds : null;
  const nextLabel = adjacentPeriod(period, granularity, weekStart, 1);
  const next = nextLabel && isClosedPeriod(nextLabel, granularity, weekStart) ? nextLabel : null;

  const daily = getGlobalSeries(db, start, 'day', inclusiveEnd(end), userId);
  const summary = toSummary(getProfileSummary(db, userId, start, inclusiveEnd(end)), daily.length, start, end);
  const previous = prev
    ? toSummary(getProfileSummary(db, userId, prev.start, inclusiveEnd(prev.end)), activeDayCount(db, userId, prev.start, prev.end), prev.start, prev.end)
    : null;

  const clock = getReportClock(db, userId, start, end, tzOffsetMinutes);
  const top = getTops(db, userId, start, end, prev, sort);

  return {
    period: { granularity, period, start, end, prev: prev ? prevLabel : null, next },
    summary,
    previous,
    facts: buildFacts(db, userId, start, end, daily, clock, summary, top.tracks[0]),
    series: granularity === 'year' ? getGlobalSeries(db, start, 'month', inclusiveEnd(end), userId) : daily,
    clock,
    weekdays: getWeekdays(db, userId, start, end),
    top,
    genres: getGenres(db, userId, start, end, prev, summary.plays),
    genreCoveragePct: genreCoverage(db, userId, start, end, summary.plays),
    decades: getDecades(db, userId, start, end, summary.plays),
    discovery: getDiscovery(db, userId, start, end, sort),
    months: granularity === 'year' ? getMonths(db, userId, start, end, sort) : null,
    milestones: getMilestones(db, userId, start, end, summary.plays),
  };
}
