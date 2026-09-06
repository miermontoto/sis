// cache de reports periódicos (semana / mes / año cerrados), pre-horneados como los
// records: un report son una docena de queries sobre el periodo y su contenido es la
// lectura final de un chart cerrado, así que se calcula una vez y se sirve durante
// REPORT_CACHE_TTL_MS. pasado el TTL se sirve igualmente y se rehornea en segundo
// plano (SWR): un report un día desfasado por un scrobble tardío o un merge es
// aceptable, esperar una docena de queries al abrirlo no. el reloj por horas depende
// de la zona horaria del cliente y queda fuera de lo horneado: es una query barata
// que se aplica encima al servir
import type { Granularity, WeekStartOption, RankingMetric, ReportResponse } from '@sis/shared';
import { adjacentPeriod, periodForDate } from '@sis/shared';
import { dbRead } from '../db/read-pool.js';
import { getDb } from '../db/connection.js';
import { getUserSettingsForUser } from './records-cache.js';
import { getAllActiveUsersWithTokens } from './user-manager.js';
import { REPORT_CACHE_TTL_MS, REPORT_CACHE_MAX_PER_USER } from '../constants.js';
import { createLogger } from './logger.js';

const log = createLogger('report-cache');

const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];
// desfase con el que se hornea: el reloj real se recalcula al servir con el del cliente
const BAKE_TZ_OFFSET = 0;

interface CacheEntry { report: ReportResponse; computedAt: number }

// "userId:granularity:period:weekStart:sort" → report horneado (reloj en UTC). Map
// itera en orden de inserción, que es lo que usa el recorte por usuario
const cache = new Map<string, CacheEntry>();
// horneados en vuelo por clave: dos peticiones simultáneas no computan lo mismo dos veces
const inflight = new Map<string, Promise<ReportResponse | null>>();

const cacheKey = (userId: number, granularity: Granularity, period: string, weekStart: WeekStartOption, sort: RankingMetric) =>
  `${userId}:${granularity}:${period}:${weekStart}:${sort}`;

const isFresh = (entry: CacheEntry) => Date.now() - entry.computedAt <= REPORT_CACHE_TTL_MS;

function store(userId: number, key: string, report: ReportResponse) {
  cache.delete(key);
  cache.set(key, { report, computedAt: Date.now() });
  // tope por usuario: fuera las entradas más antiguas
  const own = [...cache.keys()].filter(k => k.startsWith(`${userId}:`));
  own.slice(0, Math.max(0, own.length - REPORT_CACHE_MAX_PER_USER)).forEach(k => cache.delete(k));
}

function bake(userId: number, granularity: Granularity, period: string, weekStart: WeekStartOption, sort: RankingMetric): Promise<ReportResponse | null> {
  const key = cacheKey(userId, granularity, period, weekStart, sort);
  const pending = inflight.get(key);
  if (pending) return pending;

  const startedAt = performance.now();
  const task = dbRead('getReport', userId, granularity, period, weekStart, sort, BAKE_TZ_OFFSET)
    .then((report) => {
      if (report) {
        store(userId, key, report);
        log.info(`report ${granularity} ${period} del usuario ${userId} horneado en ${(performance.now() - startedAt).toFixed(0)}ms`);
      }
      return report;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

// reloj en la zona del cliente encima del report horneado en UTC (y la hora punta que
// se deriva de él)
async function withClientClock(report: ReportResponse, userId: number, tzOffsetMinutes: number): Promise<ReportResponse> {
  if (tzOffsetMinutes === BAKE_TZ_OFFSET) return report;
  const clock = await dbRead('getReportClock', userId, report.period.start, report.period.end, tzOffsetMinutes);
  const max = Math.max(...clock);
  return { ...report, clock, facts: { ...report.facts, busiestHour: max > 0 ? clock.indexOf(max) : null } };
}

/** Report de un periodo cerrado, de cache si existe (caducado se sirve y se rehornea
 *  detrás); si no, se hornea en el momento. null = la etiqueta no existe. */
export async function getReportCached(userId: number, granularity: Granularity, period: string, weekStart: WeekStartOption, sort: RankingMetric, tzOffsetMinutes: number): Promise<ReportResponse | null> {
  const hit = cache.get(cacheKey(userId, granularity, period, weekStart, sort));
  if (hit) {
    if (!isFresh(hit)) bake(userId, granularity, period, weekStart, sort).catch(err => log.error(`error rehorneando ${granularity} ${period} del usuario ${userId}:`, err));
    return withClientClock(hit.report, userId, tzOffsetMinutes);
  }
  const report = await bake(userId, granularity, period, weekStart, sort);
  return report ? withClientClock(report, userId, tzOffsetMinutes) : null;
}

/** Hornea los últimos periodos cerrados (semana, mes y año) de un usuario con sus
 *  ajustes de chart, si no están frescos. Arranque diferido + tick horario. */
export async function warmLatestReports(userId: number, spotifyId: string): Promise<void> {
  const { weekStart, sort } = getUserSettingsForUser(getDb(), spotifyId);
  const now = new Date();
  for (const granularity of GRANULARITIES) {
    const period = adjacentPeriod(periodForDate(now, granularity, weekStart), granularity, weekStart, -1);
    if (!period) continue;
    const hit = cache.get(cacheKey(userId, granularity, period, weekStart, sort));
    if (hit && isFresh(hit)) continue;
    await bake(userId, granularity, period, weekStart, sort);
  }
}

/** Tick periódico: últimos cerrados de todos los usuarios activos, en secuencia para
 *  no ocupar el pool de lectura entero. */
export async function warmAllLatestReports(): Promise<void> {
  for (const { userId, spotifyId } of getAllActiveUsersWithTokens()) {
    try { await warmLatestReports(userId, spotifyId); }
    catch (err) { log.error(`error horneando reports del usuario ${userId}:`, err); }
  }
}

/** Descarta lo horneado de un usuario (ediciones del historial: scrobbles manuales,
 *  borrados, imports). Los merges y scrobbles tardíos los absorbe el TTL. */
export function invalidateReportCacheForUser(userId: number) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}
