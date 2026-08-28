import { getDb } from '../db/connection.js';
import { getRecords } from '../db/queries/index.js';
import { dbRead } from '../db/read-pool.js';
import type { RecordsResponse, EntityRecords, Accolade, AccoladesResponse } from '@sis/shared';
import { userSettings } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { getAllActiveUsersWithTokens } from './user-manager.js';
import { emitRecordEvents } from './notification-events.js';
import { hasDeliverableChannel } from './push-dispatch.js';
import { RECORDS_LIMIT } from '../constants.js';

import type { RankingMetric, WeekStartOption, EntityType } from '@sis/shared';
import { createLogger } from './logger.js';

const log = createLogger('records-cache');
type WeekStart = WeekStartOption;
type Sort = RankingMetric;
type EntityTypeFilter = EntityType;

// cache: "userId:weekStart:sort" → resultado completo (all types, limit 50)
const cache = new Map<string, RecordsResponse>();
// marca de agua: MAX(played_at) en el momento de la última computación por usuario
const lastDataTs = new Map<number, string>();
// baseline del diff de notificaciones 'record': último snapshot con el que se emitió.
// solo avanza cuando hay dispositivos activos, para que un instante transitorio sin tokens
// no consuma el edge (la entrada nueva se re-detecta cuando aparece un dispositivo).
const notifyBaseline = new Map<number, RecordsResponse>();

function cacheKey(userId: number, ws: WeekStart, sort: Sort, unique: boolean) {
  return `${userId}:${ws}:${sort}:${unique ? 'u' : 'a'}`;
}

function getLatestPlayedAt(db: ReturnType<typeof getDb>, userId: number): string | null {
  const row = db.all(sql`SELECT MAX(played_at) as latest FROM listening_history WHERE user_id = ${userId}`);
  return (row[0] as any)?.latest ?? null;
}

function hasNewData(db: ReturnType<typeof getDb>, userId: number): boolean {
  const latest = getLatestPlayedAt(db, userId);
  if (!latest) return false;
  return latest !== lastDataTs.get(userId);
}

function updateDataTimestamp(db: ReturnType<typeof getDb>, userId: number) {
  const latest = getLatestPlayedAt(db, userId);
  if (latest) lastDataTs.set(userId, latest);
}

function getUserSettingsForUser(db: ReturnType<typeof getDb>, spotifyId: string): { weekStart: WeekStart; sort: Sort; unique: boolean } {
  const rows = db.select().from(userSettings)
    .where(eq(userSettings.userId, spotifyId))
    .all();

  const map = new Map(rows.map(r => [r.key, r.value]));
  return {
    weekStart: (map.get('weekStart') as WeekStart) || 'friday',
    sort: ((map.get('rankingMetric') === 'plays' ? 'plays' : 'time') as Sort),
    // recordsUnique: por defecto true (un registro por entidad)
    unique: map.get('recordsUnique') !== 'false',
  };
}

// ejecuta el diff de 'record' contra el baseline de notificaciones. envuelto para que
// nunca lance hacia el path de la cache. sin canal entregable (sin dispositivo activo o
// sin credenciales) no emite ni avanza el baseline (edge preservado); la primera vez con
// canal entregable siembra sin emitir para evitar el spam de backfill.
function runRecordNotifications(userId: number, spotifyId: string, result: RecordsResponse) {
  if (!hasDeliverableChannel(userId)) return;

  const base = notifyBaseline.get(userId);
  if (base) {
    try { emitRecordEvents(userId, spotifyId, base, result); }
    catch (err) { log.error('error en emitRecordEvents:', err); }
  }
  notifyBaseline.set(userId, result);
}

/** Computa records para todos los usuarios activos (síncrono, bloquea el event loop) */
export function computeAndCacheRecords() {
  const activeUsers = getAllActiveUsersWithTokens();
  if (activeUsers.length === 0) return;

  const db = getDb();

  for (const { userId, spotifyId } of activeUsers) {
    computeAndCacheForUser(db, userId, spotifyId);
  }
}

export function computeAndCacheForUser(db: ReturnType<typeof getDb>, userId: number, spotifyId: string) {
  const { weekStart, sort, unique } = getUserSettingsForUser(db, spotifyId);
  const k = cacheKey(userId, weekStart, sort, unique);

  if (cache.has(k) && !hasNewData(db, userId)) {
    log.info(`skip user ${userId} — no new data`);
    return;
  }

  log.info(`computing records for user ${userId} (${k})...`);
  const start = performance.now();
  const result = getRecords(db, weekStart, sort, 50, undefined, userId, unique) as RecordsResponse;
  const ms = (performance.now() - start).toFixed(0);
  log.info(`done in ${ms}ms`);

  updateDataTimestamp(db, userId);

  for (const [key] of cache) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
  cache.set(k, result);

  // notificaciones: 'record' cuando una entidad entra por primera vez al top de una
  // categoría. el baseline del diff solo avanza si hay dispositivos activos.
  runRecordNotifications(userId, spotifyId, result);
}

/** Computa records en worker threads (prod) para no bloquear el event loop principal.
 *  Lanza tracks/albums/artists en paralelo sobre el pool de workers. */
export async function computeAndCacheForUserAsync(userId: number, spotifyId: string) {
  const db = getDb();
  const { weekStart, sort, unique } = getUserSettingsForUser(db, spotifyId);
  const k = cacheKey(userId, weekStart, sort, unique);

  if (cache.has(k) && !hasNewData(db, userId)) {
    log.info(`skip user ${userId} — no new data`);
    return;
  }

  log.info(`computing records for user ${userId} (${k}) [worker]...`);
  const start = performance.now();
  const [trackResult, albumResult, artistResult] = await Promise.all([
    dbRead('getRecords', weekStart, sort, 50, 'track', userId, unique),
    dbRead('getRecords', weekStart, sort, 50, 'album', userId, unique),
    dbRead('getRecords', weekStart, sort, 50, 'artist', userId, unique),
  ]);
  const result = { ...trackResult, ...albumResult, ...artistResult } as RecordsResponse;
  const ms = (performance.now() - start).toFixed(0);
  log.info(`done in ${ms}ms`);

  updateDataTimestamp(db, userId);

  for (const [key] of cache) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
  cache.set(k, result);

  // notificaciones: 'record' cuando una entidad entra por primera vez al top de una
  // categoría. el baseline del diff solo avanza si hay dispositivos activos.
  runRecordNotifications(userId, spotifyId, result);
}

/** Devuelve records cacheados para un usuario, o null si no hay cache */
export function getCachedRecords(userId: number, weekStart: WeekStart, sort: Sort, limit: number, type?: EntityTypeFilter, unique = true): Partial<RecordsResponse> | null {
  const cached = cache.get(cacheKey(userId, weekStart, sort, unique));
  if (!cached) return null;

  const sliceBase = (e: EntityRecords) => ({
    peakWeekPlays: e.peakWeekPlays.slice(0, limit),
    dominance: e.dominance.slice(0, limit),
    biggestDebuts: e.biggestDebuts.slice(0, limit),
    mostWeeksAtNo1: e.mostWeeksAtNo1.slice(0, limit),
    bubblingUnder: e.bubblingUnder.slice(0, limit),
    mostWeeksInTop5: e.mostWeeksInTop5.slice(0, limit),
    longestChartRun: e.longestChartRun.slice(0, limit),
    inMostPlaylists: e.inMostPlaylists.slice(0, limit),
    // extensiones
    longestGap: e.longestGap.slice(0, limit),
    goldenOldies: e.goldenOldies.slice(0, limit),
    latestDiscoveries: e.latestDiscoveries.slice(0, limit),
    mostUniquePerMonth: e.mostUniquePerMonth.slice(0, limit),
    // year-end finishes no se recortan por `limit` — siempre son top-10 por año
    yearEndFinishes: e.yearEndFinishes,
    mostAccolades: e.mostAccolades.slice(0, limit),
  });

  const sliceTrack = (e: RecordsResponse['tracks']) => ({
    ...sliceBase(e),
  });

  const sliceAlbum = (e: RecordsResponse['albums']) => ({
    ...sliceBase(e),
  });

  const sliceArtist = (e: RecordsResponse['artists']) => ({
    ...sliceBase(e),
    mostNo1Tracks: e.mostNo1Tracks.slice(0, limit),
    mostNo1Albums: e.mostNo1Albums.slice(0, limit),
    mostDistinctTracks: e.mostDistinctTracks.slice(0, limit),
    oneHitWonders: e.oneHitWonders.slice(0, limit),
  });

  if (type === 'track') return { tracks: sliceTrack(cached.tracks) };
  if (type === 'album') return { albums: sliceAlbum(cached.albums) };
  if (type === 'artist') return { artists: sliceArtist(cached.artists) };
  return {
    tracks: sliceTrack(cached.tracks),
    albums: sliceAlbum(cached.albums),
    artists: sliceArtist(cached.artists),
  };
}

/** Busca en la cache qué records tiene una entidad para un usuario */
export function getEntityAccolades(entityType: 'track' | 'album' | 'artist', entityId: string, userId: number): AccoladesResponse {
  // buscar cache entry del usuario
  let cacheEntry: [string, RecordsResponse] | undefined;
  for (const [key, val] of cache) {
    if (key.startsWith(`${userId}:`)) {
      cacheEntry = [key, val];
      break;
    }
  }
  if (!cacheEntry) return { metric: 'time', accolades: [] };
  const [key, cached] = cacheEntry;
  const metric = key.split(':')[2] as 'plays' | 'time';

  const accolades: Accolade[] = [];
  const plural = entityType === 'track' ? 'tracks' : entityType === 'album' ? 'albums' : 'artists';
  const data = cached[plural];
  if (!data) return { metric, accolades: [] };

  const checks: [string, { entityId?: string; artistId?: string; value: number; week: string | null }[]][] = [
    ['peakWeek', data.peakWeekPlays as any[]],
    ['dominance', data.dominance as any[]],
    ['biggestDebut', data.biggestDebuts as any[]],
    ['weeksAtNo1', data.mostWeeksAtNo1 as any[]],
    ['bubblingUnder', data.bubblingUnder as any[]],
    ['weeksInChart', data.mostWeeksInTop5 as any[]],
    ['longestRun', data.longestChartRun as any[]],
    ['inMostPlaylists', data.inMostPlaylists as any[]],
    ['longestGap', data.longestGap as any[]],
    ['goldenOldies', data.goldenOldies as any[]],
    ['latestDiscoveries', data.latestDiscoveries as any[]],
    ['mostAccolades', data.mostAccolades as any[]],
  ];

  for (const [type, list] of checks) {
    const idx = list.findIndex((e) => e.entityId === entityId);
    if (idx !== -1 && idx < RECORDS_LIMIT) {
      const entry = list[idx] as any;
      accolades.push({ type, rank: idx + 1, value: entry.value, week: entry.week ?? null });
    }
  }

  if (entityType === 'artist' && 'mostNo1Tracks' in data) {
    const artistData = data as RecordsResponse['artists'];
    const artistChecks: [string, { artistId: string; count: number }[]][] = [
      ['mostNo1Tracks', artistData.mostNo1Tracks as any[]],
      ['mostNo1Albums', artistData.mostNo1Albums as any[]],
    ];
    for (const [type, list] of artistChecks) {
      const idx = list.findIndex((e) => e.artistId === entityId);
      if (idx !== -1 && idx < RECORDS_LIMIT) {
        accolades.push({ type, rank: idx + 1, value: list[idx].count, week: null });
      }
    }
  }

  // mostDistinctTracks exclusivo de artists (tras quitarlo de albums)
  if (entityType === 'artist' && 'mostDistinctTracks' in data) {
    const artistData = data as RecordsResponse['artists'];
    const idx = artistData.mostDistinctTracks.findIndex((e) => e.entityId === entityId);
    if (idx !== -1 && idx < RECORDS_LIMIT) {
      accolades.push({ type: 'mostDistinctTracks', rank: idx + 1, value: artistData.mostDistinctTracks[idx].value, week: null });
    }
  }

  // oneHitWonders exclusivo de artists (tras quitarlo de albums)
  if (entityType === 'artist' && 'oneHitWonders' in data) {
    const artistData = data as RecordsResponse['artists'];
    const idx = artistData.oneHitWonders.findIndex((e) => e.entityId === entityId);
    if (idx !== -1 && idx < RECORDS_LIMIT) {
      accolades.push({ type: 'oneHitWonders', rank: idx + 1, value: artistData.oneHitWonders[idx].value, week: null });
    }
  }

  // year-end finishes (todos los años completos en los que la entidad entró en top-10)
  for (const f of data.yearEndFinishes) {
    if (f.entityId === entityId) {
      accolades.push({ type: 'yearEnd', rank: f.rank, value: f.value, week: null, year: f.year });
    }
  }

  return { metric, accolades };
}

/** Invalida la cache de todos los usuarios (fuerza recomputo en el siguiente ciclo) */
export function invalidateRecordsCache() {
  cache.clear();
  lastDataTs.clear();
}
