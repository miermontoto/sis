// cache stale-while-revalidate de /stats/recent-rank-changes: los 3 scans completos
// de listening_history tardan segundos, pero el ranking se mueve play a play — servir
// un resultado de <10 min y refrescarlo en background es indistinguible de fresco.
// el warmup diferido precomputa la ventana por defecto para que ni el primer request
// tras un deploy pague el coste.
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { dbRead } from '../db/read-pool.js';
import { userSettings } from '../db/schema.js';
import {
  RECENT_CHANGES_LIMIT,
  RECENT_CHANGES_CACHE_MS,
  RECENT_CHANGES_DEFAULT_DAYS,
} from '../constants.js';
import type { RecentRankChangesResponse, RankingMetric } from '@sis/shared';
import { createLogger } from './logger.js';

const log = createLogger('recent-changes');

const cache = new Map<string, { data: RecentRankChangesResponse; computedAt: number }>();
const inFlight = new Map<string, Promise<RecentRankChangesResponse>>();

/** Límites de rank de la session card (sessionRankLimitYear/All de user_settings),
 *  compartidos entre /projected-rankings y /recent-rank-changes. */
export function readRankLimits(spotifyId: string): Record<string, number> {
  const db = getDb();
  const rows = db.select().from(userSettings)
    .where(eq(userSettings.userId, spotifyId))
    .all();
  const settingsMap = new Map(rows.map(r => [r.key, r.value]));
  return {
    thisYear: parseInt(settingsMap.get('sessionRankLimitYear') ?? '50', 10) || 50,
    all: parseInt(settingsMap.get('sessionRankLimitAll') ?? '200', 10) || 200,
  };
}

async function compute(userId: number, days: number, sort: RankingMetric, rankLimits: Record<string, number>): Promise<RecentRankChangesResponse> {
  const [artistItems, albumItems, trackItems] = await Promise.all([
    dbRead('getRecentRankChanges', 'artist', days, sort, userId, RECENT_CHANGES_LIMIT, rankLimits),
    dbRead('getRecentRankChanges', 'album', days, sort, userId, RECENT_CHANGES_LIMIT, rankLimits),
    dbRead('getRecentRankChanges', 'track', days, sort, userId, RECENT_CHANGES_LIMIT, rankLimits),
  ]);
  // mismo orden que la session card: artistas, álbumes, tracks (cada tipo ya viene ordenado)
  return { days, items: [...artistItems, ...albumItems, ...trackItems] };
}

// computa y guarda con single-flight: peticiones concurrentes de la misma clave
// comparten una sola ejecución
function computeAndStore(key: string, userId: number, days: number, sort: RankingMetric, rankLimits: Record<string, number>): Promise<RecentRankChangesResponse> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = compute(userId, days, sort, rankLimits)
    .then(data => {
      cache.set(key, { data, computedAt: Date.now() });
      return data;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** Resultado cacheado al instante (refrescando en background si está stale) o
 *  computado si aún no existe. */
export function getRecentRankChangesCached(userId: number, spotifyId: string, days: number, sort: RankingMetric): Promise<RecentRankChangesResponse> {
  const rankLimits = readRankLimits(spotifyId);
  const key = `${userId}:${days}:${sort}:${rankLimits.thisYear}:${rankLimits.all}`;
  const cached = cache.get(key);

  if (cached) {
    if (Date.now() - cached.computedAt > RECENT_CHANGES_CACHE_MS) {
      void computeAndStore(key, userId, days, sort, rankLimits)
        .catch(err => log.error(`error refrescando usuario ${userId}:`, err));
    }
    return Promise.resolve(cached.data);
  }

  return computeAndStore(key, userId, days, sort, rankLimits);
}

/** Warmup diferido: precomputa la ventana por defecto con el metric del usuario. */
export async function warmRecentRankChanges(userId: number, spotifyId: string): Promise<void> {
  const db = getDb();
  const metricRow = db.select().from(userSettings)
    .where(eq(userSettings.userId, spotifyId))
    .all()
    .find(r => r.key === 'rankingMetric');
  const sort: RankingMetric = metricRow?.value === 'plays' ? 'plays' : 'time';
  await getRecentRankChangesCached(userId, spotifyId, RECENT_CHANGES_DEFAULT_DAYS, sort);
}
