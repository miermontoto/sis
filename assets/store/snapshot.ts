// snapshot de datos reales de una cuenta para las capturas de tienda (screens.js): canciones, artistas,
// cifras y portadas de verdad en vez de las ficticias. sale a assets/store/data/ (gitignored: el repo es
// público y son datos personales + portadas con copyright): snapshot.json + img/<hash>.jpg, que screens.js
// referencia como data/img/<hash>.jpg (render.mjs sirve assets/store/ en /).
//
// no toca prod ni el backup: copia el backup más reciente a un temporal, le quita las credenciales
// (auth_tokens, lastfm, mier.info) y bloquea fetch mientras habla con la api, porque el primer request de
// una sesión dispara syncs contra spotify (triggerDeferredStartup). las cifras salen de los MISMOS
// endpoints que la web, llamados en proceso con app.request() y una sesión creada en la copia.
//
// uso (desde packages/api, que resuelve sus deps; node 22 = el abi de better-sqlite3 instalado):
//   cd packages/api && npx tsx ../../assets/store/snapshot.ts [ruta-a-un-backup.db]
// sin ruta toma el más reciente de data/backups/recent (del checkout principal si se corre en un worktree).
// SNAPSHOT_USER cambia el usuario (por defecto 1).
//
// forma de snapshot.json (minutos y horas redondeados; fechas yyyy-mm-dd en la zona del usuario salvo
// los días del dashboard, que son utc como los buckets de la web):
//   asOf                     "hoy" de las capturas: el día utc del último play
//   user                     { name }
//   settings                 { weekStart, timeZone, sort }
//   dashboard                { playsToday, playsYesterday, minutesToday, minutesYesterday, weekHours,
//                              weekDeltaPct, streak, bestStreak, totalPlays, nextMilestone,
//                              last7: [{ date, minutes, plays }], topTracksWeek: [{ name, artist, img,
//                              minutes, plays }], topArtistsWeek: [{ name, img, minutes, plays }],
//                              nowPlaying: { name, artist, album, img }, session: { tracks, minutes } }
//   rankings                 últimos 30 días: { range: { start, end }, tracks, albums, artists } (10 de
//                              cada, { name, artist?, img, plays, minutes })
//   charts                   última semana cerrada: { period, start, end, tracks: [{ pos, prev, status
//                              (new|re|up|down|same), delta, name, artist, img, peak, peakTimes, weeks,
//                              minutes, plays }] }
//   report                   la misma semana: { period, week, year, start, end, totals: { plays, minutes,
//                              artists, tracks, albums }, prevTotals, topArtists, topAlbums, topTracks (5),
//                              topGenre, genres: [{ name, pct }], busiestDay }
//   artist                   el nº 1 de siempre: { name, img, background, plays, minutes, firstPlayed,
//                              lastPlayed, ranks: { d7, d30, ytd, all }, current, peak, peakTimes,
//                              weeksOnChart, rankHistory: [{ month, rank }] }
//   insights                 de siempre: { totalHours, totalPlays, dailyAvgHours, currentStreak,
//                              playsMonthly: [{ month, plays, hours }], genres: [{ name, plays, pct }],
//                              hoursByYear: [{ year, hours, plays }] }
//   concerts                 { stats: { shows, artists, venues, cities, countries, songsLive, knewPct },
//                              shows: [{ artist, img, venue, city, country, date, tour, songs, inLibrary,
//                              knew }] }
// nada de otros usuarios (amigos, feed social): ni nombres ni avatares.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// las deps son las de la api: este script vive fuera de su paquete y un import pelado no las encuentra
const API = resolve(HERE, '../../packages/api');
// solo lo que usa scratchCopy (los tipos de better-sqlite3 tampoco se resuelven desde aquí)
type Sqlite = { prepare: (sql: string) => { all: () => unknown[]; run: () => unknown }; close: () => void };
const Database = createRequire(join(API, 'package.json'))('better-sqlite3') as new (file: string) => Sqlite;
const OUT = join(HERE, 'data');
const IMG_DIR = join(OUT, 'img');
const IMG_ROUTE = 'data/img';
const BACKUPS = 'data/backups/recent';
const BACKUP_RE = /^sis-.*\.db$/;
const USER_ID = Number(process.env.SNAPSHOT_USER ?? 1);
const SESSION_COOKIE = 'sis_session';
// métrica de los rankings: la de la web por defecto (la elección del usuario vive en su localStorage)
const SORT = 'time';
const DEFAULT_WEEK_START = 'friday';
const DEFAULT_TZ = 'Europe/Madrid';
// cuántas filas de cada lista
const TOP_WEEK = 5;
const TOP_LIST = 10;
const REPORT_TOP = 5;
const GENRES = 8;
const SHOWS = 6;
const RANK_MONTHS = 24;
const MONTHLY_SPAN = 60;
// ventana del dashboard: 14 días utc terminando hoy (la semana y la anterior), como daily-data de la web
const DASH_DAYS = 14;
const WEEK_DAYS = 7;
const RANGE_DAYS = 30;
const HISTORY_PAGE = 100;
// margen sobre la duración de un tema para que el siguiente siga en la misma sesión (projections.ts)
const SESSION_BUFFER_MS = 60_000;
const IMG_CONCURRENCY = 6;
const HASH_LEN = 12;
const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
const PCT = 100;
// tablas con credenciales que se vacían en la copia
const CREDENTIAL_TABLES = ['auth_tokens', 'lastfm_accounts', 'mierid_accounts'];

const round1 = (n: number) => Math.round(n * 10) / 10;
const minutes = (ms: number) => Math.round(ms / MS_MIN);
const hours = (ms: number) => round1(ms / MS_HOUR);
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const localDate = (iso: string, timeZone: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone });

// el backup más reciente: el del repo o, en un worktree, el del checkout principal
const latestBackup = async () => {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim();
  const roots = [resolve(HERE, '../..'), dirname(common)].map((r) => join(r, BACKUPS)).filter(existsSync);
  const files = (await Promise.all(roots.map(async (d) => (await readdir(d)).filter((f) => BACKUP_RE.test(f)).map((f) => join(d, f))))).flat();
  // el nombre lleva la fecha (sis-yyyymmdd-hhmmss.db): el mayor es el último
  const hit = files.sort((a, b) => a.split('/').at(-1)!.localeCompare(b.split('/').at(-1)!)).at(-1);
  if (!hit) throw new Error(`no hay backups en ${BACKUPS}`);
  return hit;
};

// copia desechable del backup, sin credenciales
const scratchCopy = async (src: string) => {
  const dir = await mkdtemp(join(tmpdir(), 'sis-store-snapshot-'));
  const file = join(dir, 'sis.db');
  await copyFile(src, file);
  const db = new Database(file);
  const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((r) => (r as { name: string }).name));
  CREDENTIAL_TABLES.filter((t) => tables.has(t)).forEach((t) => db.prepare(`delete from ${t}`).run());
  db.close();
  return { dir, file };
};

// portadas: url → ruta local, una descarga por url
const images = new Map<string, string>();
const img = (url?: string | null) => {
  if (!url) return null;
  if (!images.has(url)) images.set(url, `${IMG_ROUTE}/${createHash('sha1').update(url).digest('hex').slice(0, HASH_LEN)}.jpg`);
  return images.get(url)!;
};

const download = async (fetchFn: typeof fetch) => {
  await mkdir(IMG_DIR, { recursive: true });
  const jobs = [...images.entries()];
  const failed: string[] = [];
  const one = async ([url, path]: [string, string]) => {
    const dest = join(HERE, path);
    if (existsSync(dest)) return;
    try {
      // las subidas a mano (/api/covers/<fichero>) viven en el data/covers del contenedor de prod: copia de solo lectura
      if (url.startsWith('/api/covers/')) {
        execFileSync('docker', ['cp', `sis-sis-1:/app/data/covers/${url.split('/').at(-1)}`, dest], { stdio: 'ignore' });
        return;
      }
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`http ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      failed.push(`${url} (${(e as Error).message})`);
    }
  };
  for (let i = 0; i < jobs.length; i += IMG_CONCURRENCY) await Promise.all(jobs.slice(i, i + IMG_CONCURRENCY).map(one));
  failed.forEach((f) => console.warn(`[snapshot] portada sin descargar: ${f}`));
  return { total: jobs.length, failed: failed.length };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- respuestas de la api sin tipar a propósito: el snapshot solo proyecta
type Any = any;
const artistsOf = (list?: { name: string }[]) => (list ?? []).map((a) => a.name).join(', ');
const trackRow = (r: Any) => ({ name: r.track.name, artist: artistsOf(r.track.artists), img: img(r.track.album?.imageUrl), plays: r.playCount, minutes: minutes(r.totalMs) });
const albumRow = (r: Any) => ({ name: r.album.name, artist: artistsOf(r.artists), img: img(r.album.imageUrl), plays: r.playCount, minutes: minutes(r.totalMs) });
const artistRow = (r: Any) => ({ name: r.artist.name, img: img(r.artist.imageUrl), plays: r.playCount, minutes: minutes(r.totalMs) });
// e = la entrada con sus picos reales encima: "nueva" que ya estuvo en lista es reentrada (charts/+page.svelte)
const chartStatus = (e: Any) => (e.isReentry ? 're' : e.isNew ? 'new' : e.previousRank == null ? 'same' : e.previousRank > e.rank ? 'up' : e.previousRank < e.rank ? 'down' : 'same');

// sesión en curso al final del historial: plays seguidos sin un hueco mayor que el umbral (projections.ts)
const lastSession = (items: Any[], gapMs: number) => {
  const plays = [...items].reverse().map((p) => ({ at: Date.parse(p.playedAt), ms: p.track?.durationMs ?? 0 }));
  const start = plays.findLastIndex((p, i) => i > 0 && p.at - plays[i - 1].at > Math.max(gapMs, plays[i - 1].ms + SESSION_BUFFER_MS));
  const run = plays.slice(Math.max(start, 0));
  return { tracks: run.length, minutes: minutes(run.reduce((s, p) => s + p.ms, 0)) };
};

const main = async () => {
  const src = process.argv[2] ? resolve(process.argv[2]) : await latestBackup();
  const scratch = await scratchCopy(src);
  console.log(`[snapshot] ${src} → copia temporal`);
  process.env.DATABASE_PATH = scratch.file;
  process.env.DISABLE_POLLING = '1';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: unknown) => {
    throw new Error(`red bloqueada en el snapshot: ${String(u)}`);
  }) as typeof fetch;

  // la api después del env: connection.ts y app.ts leen DATABASE_PATH al importarse
  const { default: app } = await import('../../packages/api/src/app.ts');
  const { initReadWorker, closeReadWorker } = await import('../../packages/api/src/db/read-pool.ts');
  const { createSession } = await import('../../packages/api/src/services/session.ts');
  const { SESSION_GAP_MS } = await import('../../packages/api/src/constants.ts');
  const { nextMilestone } = await import('../../packages/shared/src/constants.ts');
  await initReadWorker();
  const cookie = `${SESSION_COOKIE}=${createSession(USER_ID, 'store-snapshot')}`;
  const get = async (path: string, params: Record<string, string | number> = {}): Promise<Any> => {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]));
    const res = await app.request(`/api${path}${qs.size ? `?${qs}` : ''}`, { headers: { cookie } });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  try {
    const [me, settings, health, streaks, history] = await Promise.all([get('/me'), get('/settings'), get('/health'), get('/stats/streaks'), get('/stats/history', { limit: HISTORY_PAGE })]);
    const weekStart = settings.weekStart ?? DEFAULT_WEEK_START;
    const timeZone = settings.timeZone ?? DEFAULT_TZ;
    const cal = { weekStart, timeZone, sort: SORT };
    const latest = Date.parse(history.items[0].playedAt);
    const asOf = dayKey(latest);
    const days = Array.from({ length: DASH_DAYS }, (_, i) => dayKey(latest - (DASH_DAYS - 1 - i) * MS_DAY));
    const range = (n: number) => ({ startDate: dayKey(latest - (n - 1) * MS_DAY), endDate: asOf });

    // ---------- dashboard ----------
    const [daily, topTracksWeek, topArtistsWeek] = await Promise.all([
      get('/stats/listening-time', { startDate: days[0], endDate: asOf, granularity: 'day' }),
      get('/stats/top-tracks', { ...range(WEEK_DAYS), limit: TOP_WEEK, sort: SORT }),
      get('/stats/top-artists', { ...range(WEEK_DAYS), limit: TOP_WEEK, sort: SORT }),
    ]);
    const byDay = new Map(daily.map((d: Any) => [d.period, d]));
    const buckets = days.map((date) => ({ date, plays: (byDay.get(date) as Any)?.play_count ?? 0, ms: (byDay.get(date) as Any)?.total_ms ?? 0 }));
    const sum = (list: typeof buckets) => list.reduce((s, d) => s + d.ms, 0);
    const [prevWeek, week] = [buckets.slice(0, WEEK_DAYS), buckets.slice(WEEK_DAYS)];
    const [yesterday, today] = buckets.slice(-2);
    const now = history.items[0];
    const dashboard = {
      playsToday: today.plays,
      playsYesterday: yesterday.plays,
      minutesToday: minutes(today.ms),
      minutesYesterday: minutes(yesterday.ms),
      weekHours: hours(sum(week)),
      weekDeltaPct: sum(prevWeek) ? Math.round(((sum(week) - sum(prevWeek)) / sum(prevWeek)) * PCT) : null,
      streak: streaks.currentStreak,
      bestStreak: streaks.longestStreak,
      totalPlays: health.totalPlays,
      nextMilestone: nextMilestone(health.totalPlays),
      last7: week.map((d) => ({ date: d.date, minutes: minutes(d.ms), plays: d.plays })),
      topTracksWeek: topTracksWeek.map(trackRow),
      topArtistsWeek: topArtistsWeek.map(artistRow),
      nowPlaying: { name: now.track.name, artist: artistsOf(now.track.artists), album: now.track.album?.name, img: img(now.track.album?.imageUrl) },
      session: lastSession(history.items, SESSION_GAP_MS),
    };

    // ---------- rankings (30 días) ----------
    const r30 = range(RANGE_DAYS);
    const [rTracks, rAlbums, rArtists] = await Promise.all(['tracks', 'albums', 'artists'].map((k) => get(`/stats/top-${k}`, { ...r30, limit: TOP_LIST, sort: SORT })));
    const rankings = { range: { start: r30.startDate, end: r30.endDate }, tracks: rTracks.map(trackRow), albums: rAlbums.map(albumRow), artists: rArtists.map(artistRow) };

    // ---------- charts + report: la última semana cerrada (la primera de periods sigue abierta) ----------
    const { periods } = await get('/stats/charts/periods', { granularity: 'week', weekStart, timeZone });
    const report = await get('/stats/report', { granularity: 'week', period: periods[1], ...cal });
    const period = report.period.period;
    const chart = await get('/stats/charts', { type: 'tracks', granularity: 'week', period, ...cal, limit: TOP_LIST });
    // las entradas traen picos provisionales; los reales salen de /charts/peaks (como la web)
    const peaks = await get('/stats/charts/peaks', { type: 'tracks', granularity: 'week', period, ...cal, ids: chart.entries.map((e: Any) => e.entityId).join(',') });
    const span = { start: localDate(report.period.start, timeZone), end: localDate(new Date(Date.parse(report.period.end) - 1).toISOString(), timeZone) };
    const charts = {
      period,
      ...span,
      tracks: chart.entries.map((e: Any) => {
        const pk = { ...e, ...peaks[e.entityId] };
        return { pos: e.rank, prev: e.previousRank, status: chartStatus(pk), delta: e.previousRank == null ? null : e.previousRank - e.rank, name: e.name, artist: artistsOf(e.artists) || e.artistName, img: img(e.imageUrl), peak: pk.peakRank, peakTimes: pk.timesAtPeak, weeks: pk.weeksOnChart, minutes: minutes(e.totalMs), plays: e.plays };
      }),
    };
    const totals = (s: Any) => ({ plays: s.plays, minutes: minutes(s.totalMs), artists: s.distinctArtists, tracks: s.distinctTracks, albums: s.distinctAlbums });
    const [year, weekNo] = period.split('-W').map(Number);
    const reportOut = {
      period,
      week: weekNo,
      year,
      ...span,
      totals: totals(report.summary),
      prevTotals: report.previous ? totals(report.previous) : null,
      topArtists: report.top.artists.slice(0, REPORT_TOP).map(artistRow),
      topAlbums: report.top.albums.slice(0, REPORT_TOP).map(albumRow),
      topTracks: report.top.tracks.slice(0, REPORT_TOP).map(trackRow),
      topGenre: report.genres[0]?.genre ?? null,
      genres: report.genres.map((g: Any) => ({ name: g.genre, pct: g.pct })),
      busiestDay: report.facts?.busiestDay ? { date: report.facts.busiestDay.date, plays: report.facts.busiestDay.plays } : null,
    };

    // ---------- artista: el nº 1 de siempre ----------
    const [top] = await get('/stats/top-artists', { range: 'all', limit: 1, sort: SORT });
    const id = encodeURIComponent(top.artistId);
    const [detail, ranks, rankHistory, chartHistory] = await Promise.all([
      get(`/stats/artist/${id}`, { range: 'all' }),
      get(`/stats/rankings/artist/${id}`, { sort: SORT }),
      // withRankings: la forma { rankings, history } de la web (sin él responde el array pelado)
      get(`/stats/ranking-history/artist/${id}`, { sort: SORT, withRankings: 'true' }),
      get(`/stats/chart-history/artists/${id}`, cal),
    ]);
    const artist = {
      name: detail.artist.name,
      img: img(detail.artist.imageUrl),
      background: img(detail.artist.backgroundUrl),
      plays: detail.stats.play_count,
      minutes: minutes(detail.stats.total_ms),
      firstPlayed: localDate(detail.stats.first_played, timeZone),
      lastPlayed: detail.stats.last_played,
      ranks: { d7: ranks.week, d30: ranks.month, ytd: ranks.thisYear, all: ranks.all },
      current: chartHistory.currentRank,
      peak: chartHistory.peakRank,
      peakTimes: chartHistory.timesAtPeak,
      weeksOnChart: chartHistory.weeksOnChart,
      rankHistory: rankHistory.history.slice(-RANK_MONTHS).map((h: Any) => ({ month: h.period, rank: h.rank })),
    };

    // ---------- insights (de siempre) ----------
    const [monthly, genres] = await Promise.all([get('/stats/listening-time', { range: 'all', granularity: 'month' }), get('/stats/top-genres', { range: 'all', limit: GENRES })]);
    const totalMs = monthly.reduce((s: number, m: Any) => s + m.total_ms, 0);
    const years = Object.entries(Object.groupBy(monthly as Any[], (m: Any) => m.period.slice(0, 4))).map(([y, ms]) => ({
      year: Number(y),
      hours: Math.round((ms as Any[]).reduce((s, m) => s + m.total_ms, 0) / MS_HOUR),
      plays: (ms as Any[]).reduce((s, m) => s + m.play_count, 0),
    }));
    // cuota de cada género dentro de los que se enseñan (un artista suma a varios: no hay un total común)
    const genrePlays = genres.reduce((s: number, g: Any) => s + g.play_count, 0);
    const spanDays = Math.max(1, Math.round((latest - Date.parse(`${monthly[0].period}-01`)) / MS_DAY));
    const insights = {
      totalHours: Math.round(totalMs / MS_HOUR),
      totalPlays: health.totalPlays,
      dailyAvgHours: round1(totalMs / MS_HOUR / spanDays),
      currentStreak: streaks.currentStreak,
      playsMonthly: monthly.slice(-MONTHLY_SPAN).map((m: Any) => ({ month: m.period, plays: m.play_count, hours: hours(m.total_ms) })),
      genres: genres.map((g: Any) => ({ name: g.genre, plays: g.play_count, pct: round1((g.play_count / genrePlays) * PCT) })),
      hoursByYear: years,
    };

    // ---------- conciertos ----------
    const { concerts: shows, stats: cstats } = await get('/concerts');
    const songs = shows.flatMap((c: Any) => c.songs);
    const knew = (list: Any[]) => list.filter((s) => s.playsBefore > 0).length;
    const concerts = {
      stats: { shows: cstats.total, artists: cstats.artists, venues: cstats.venues, cities: cstats.cities, countries: cstats.countries, songsLive: songs.length, knewPct: songs.length ? Math.round((knew(songs) / songs.length) * PCT) : null },
      shows: shows.slice(0, SHOWS).map((c: Any) => ({ artist: c.artistName, img: img(c.artistImageUrl), venue: c.venue, city: c.city, country: c.country, date: c.date, tour: c.tour, songs: c.songs.length, inLibrary: c.songs.filter((s: Any) => s.trackId).length, knew: knew(c.songs) })),
    };

    const snapshot = { asOf, user: { name: me.displayName }, settings: cal, dashboard, rankings, charts, report: reportOut, artist, insights, concerts };
    globalThis.fetch = realFetch;
    const dl = await download(realFetch);
    await writeFile(join(OUT, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`[snapshot] ${join(OUT, 'snapshot.json')} (hoy = ${asOf}, semana ${period}) · portadas ${dl.total - dl.failed}/${dl.total}`);
  } finally {
    closeReadWorker();
    await rm(scratch.dir, { recursive: true, force: true });
  }
};

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`[snapshot] fallido: ${e.stack ?? e.message}`);
    process.exit(1);
  },
);
