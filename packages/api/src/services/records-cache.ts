import { getDb } from '../db/connection.js';
import { getRecords } from '../db/queries/index.js';
import { dbRead } from '../db/read-pool.js';
import type { RecordsResponse, EntityRecords, Accolade, AccoladesResponse } from '@sis/shared';
import { ACCOLADE_RECORD_KEYS } from '@sis/shared';
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
// generación por usuario: la sube cada invalidación para que un horneado en vuelo
// sepa que su resultado ya nació viejo (ver bakeForUser)
const generation = new Map<number, number>();

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

export function getUserSettingsForUser(db: ReturnType<typeof getDb>, spotifyId: string): { weekStart: WeekStart; sort: Sort; unique: boolean } {
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

// horneados en vuelo, por usuario. Un detalle pide accolades de artista, álbum y tema
// casi a la vez, y el arranque diferido lanza el suyo: sin esto, cada uno arrancaría un
// escaneo completo del historial (~12s) para acabar escribiendo lo mismo.
const baking = new Map<number, Promise<void>>();

/** Computa records en worker threads (prod) para no bloquear el event loop principal.
 *  Lanza tracks/albums/artists en paralelo sobre el pool de workers.
 *  Deduplicado por usuario: varias llamadas concurrentes comparten un solo horneado. */
export function computeAndCacheForUserAsync(userId: number, spotifyId: string): Promise<void> {
  const inFlight = baking.get(userId);
  if (inFlight) return inFlight;
  const p = bakeForUser(userId, spotifyId).finally(() => { baking.delete(userId); });
  baking.set(userId, p);
  return p;
}

async function bakeForUser(userId: number, spotifyId: string) {
  const db = getDb();

  // el horneado dura ~12s y una mutación de colección o de bolo puede caer dentro:
  // su invalidación se perdería al escribir un resultado pre-mutación, que ya nadie
  // volvería a recomputar (la marca de agua es MAX(played_at) y no se ha movido).
  // Por eso se compara la generación al entrar y al escribir, y se repite si cambió.
  for (;;) {
    const gen = generation.get(userId) ?? 0;
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

    if ((generation.get(userId) ?? 0) !== gen) {
      log.info(`descartado user ${userId} — invalidado durante el horneado, recomputando`);
      continue;
    }

    updateDataTimestamp(db, userId);

    for (const [key] of cache) {
      if (key.startsWith(`${userId}:`)) cache.delete(key);
    }
    cache.set(k, result);

    // notificaciones: 'record' cuando una entidad entra por primera vez al top de una
    // categoría. el baseline del diff solo avanza si hay dispositivos activos.
    runRecordNotifications(userId, spotifyId, result);
    return;
  }
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
    mostHeardLive: e.mostHeardLive.slice(0, limit),
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
    mostConcerts: e.mostConcerts.slice(0, limit),
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
function findUserEntry(userId: number): [string, RecordsResponse] | undefined {
  for (const [key, val] of cache) {
    if (key.startsWith(`${userId}:`)) return [key, val];
  }
  return undefined;
}

export async function getEntityAccolades(entityType: 'track' | 'album' | 'artist', entityId: string, userId: number, spotifyId: string): Promise<AccoladesResponse> {
  // la cache está fría al arrancar el proceso y cada vez que una mutación de
  // colección o de bolo la invalida. Devolver [] ahí sería MENTIR: una lista vacía
  // no se distingue de "esta entidad no tiene records", y el cliente la cachea una
  // hora, así que el badge desaparecía de todas las entidades visitadas hasta 6h
  // (el siguiente tick de polling). Se espera al horneado, deduplicado por usuario.
  let cacheEntry = findUserEntry(userId);
  if (!cacheEntry) {
    await computeAndCacheForUserAsync(userId, spotifyId);
    cacheEntry = findUserEntry(userId);
  }
  if (!cacheEntry) return { metric: 'time', accolades: [] };
  const [key, cached] = cacheEntry;
  const metric = key.split(':')[2] as 'plays' | 'time';

  const accolades: Accolade[] = [];
  const plural = entityType === 'track' ? 'tracks' : entityType === 'album' ? 'albums' : 'artists';
  const data = cached[plural];
  if (!data) return { metric, accolades: [] };

  // una entrada por lista de la tabla compartida. Las que no existen en este
  // payload (mostConcerts en tracks, mostHeardLive en artistas…) se saltan solas.
  // mostNo1Tracks/Albums son ArtistRecordEntry: id en artistId y valor en count
  type Entry = { entityId?: string; artistId?: string; value?: number; count?: number; week?: string | null };
  const lists = data as unknown as Record<string, Entry[] | undefined>;
  for (const [type, listKey] of Object.entries(ACCOLADE_RECORD_KEYS)) {
    const list = lists[listKey];
    if (!list) continue;
    const idx = list.findIndex((e) => (e.entityId ?? e.artistId) === entityId);
    if (idx === -1 || idx >= RECORDS_LIMIT) continue;
    const entry = list[idx];
    accolades.push({ type, rank: idx + 1, value: entry.value ?? entry.count ?? 0, week: entry.week ?? null });
  }

  // year-end finishes (todos los años completos en los que la entidad entró en top-10)
  for (const f of data.yearEndFinishes) {
    if (f.entityId === entityId) {
      accolades.push({ type: 'yearEnd', rank: f.rank, value: f.value, week: null, year: f.year });
    }
  }

  return { metric, accolades };
}

/** Invalida la cache de un usuario. Necesario para los records de directo: no salen
 *  del historial, así que registrar un bolo no mueve la marca de agua (MAX(played_at))
 *  y sin borrarla el siguiente ciclo vería "no hay datos nuevos" y no recomputaría. */
export function invalidateRecordsCacheForUser(userId: number) {
  for (const [key] of cache) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
  lastDataTs.delete(userId);
  generation.set(userId, (generation.get(userId) ?? 0) + 1);
}

/** Invalida la cache de todos los usuarios (fuerza recomputo en el siguiente ciclo) */
export function invalidateRecordsCache() {
  cache.clear();
  lastDataTs.clear();
  // sólo importan los horneados en vuelo: son los que escribirían un resultado
  // anterior a esta invalidación
  for (const userId of baking.keys()) {
    generation.set(userId, (generation.get(userId) ?? 0) + 1);
  }
}
