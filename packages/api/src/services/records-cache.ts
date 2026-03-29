import { getDb } from '../db/connection.js';
import { getRecords } from '../db/queries/index.js';
import type { RecordsResponse } from '../db/queries/index.js';
import { userSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getAllActiveUsersWithTokens } from './user-manager.js';

type WeekStart = 'monday' | 'sunday' | 'friday';
type Sort = 'plays' | 'time';
type EntityTypeFilter = 'tracks' | 'albums' | 'artists';

// cache: "userId:weekStart:sort" → resultado completo (all types, limit 50)
const cache = new Map<string, RecordsResponse>();

function cacheKey(userId: number, ws: WeekStart, sort: Sort) {
  return `${userId}:${ws}:${sort}`;
}

function getUserSettingsForUser(db: ReturnType<typeof getDb>, spotifyId: string): { weekStart: WeekStart; sort: Sort } {
  const rows = db.select().from(userSettings)
    .where(eq(userSettings.userId, spotifyId))
    .all();

  const map = new Map(rows.map(r => [r.key, r.value]));
  return {
    weekStart: (map.get('weekStart') as WeekStart) || 'friday',
    sort: ((map.get('rankingMetric') === 'plays' ? 'plays' : 'time') as Sort),
  };
}

/** Computa records para todos los usuarios activos */
export function computeAndCacheRecords() {
  const activeUsers = getAllActiveUsersWithTokens();
  if (activeUsers.length === 0) return;

  const db = getDb();

  for (const { userId, spotifyId } of activeUsers) {
    const { weekStart, sort } = getUserSettingsForUser(db, spotifyId);
    const k = cacheKey(userId, weekStart, sort);

    console.log(`[records-cache] computing records for user ${userId} (${k})...`);
    const start = performance.now();
    const result = getRecords(db, weekStart, sort, 50, undefined, userId) as RecordsResponse;
    const ms = (performance.now() - start).toFixed(0);
    console.log(`[records-cache] done in ${ms}ms`);

    // limpiar cache anterior de este usuario
    for (const [key] of cache) {
      if (key.startsWith(`${userId}:`)) cache.delete(key);
    }
    cache.set(k, result);
  }
}

/** Devuelve records cacheados para un usuario, o null si no hay cache */
export function getCachedRecords(userId: number, weekStart: WeekStart, sort: Sort, limit: number, type?: EntityTypeFilter): Partial<RecordsResponse> | null {
  const cached = cache.get(cacheKey(userId, weekStart, sort));
  if (!cached) return null;

  const sliceEntity = (e: RecordsResponse['tracks']) => ({
    peakWeekPlays: e.peakWeekPlays.slice(0, limit),
    biggestDebuts: e.biggestDebuts.slice(0, limit),
    mostWeeksAtNo1: e.mostWeeksAtNo1.slice(0, limit),
    mostWeeksInTop5: e.mostWeeksInTop5.slice(0, limit),
    longestChartRun: e.longestChartRun.slice(0, limit),
  });

  const sliceArtist = (e: RecordsResponse['artists']) => ({
    ...sliceEntity(e),
    mostNo1Tracks: e.mostNo1Tracks.slice(0, limit),
    mostNo1Albums: e.mostNo1Albums.slice(0, limit),
  });

  if (type === 'tracks') return { tracks: sliceEntity(cached.tracks) };
  if (type === 'albums') return { albums: sliceEntity(cached.albums) };
  if (type === 'artists') return { artists: sliceArtist(cached.artists) };
  return {
    tracks: sliceEntity(cached.tracks),
    albums: sliceEntity(cached.albums),
    artists: sliceArtist(cached.artists),
  };
}

/** Accolade de una entidad individual */
export interface Accolade {
  type: string;
  rank: number;
  value: number;
  week: string | null;
}

export interface AccoladesResult {
  metric: 'plays' | 'time';
  accolades: Accolade[];
}

/** Busca en la cache qué records tiene una entidad para un usuario */
export function getEntityAccolades(entityType: 'track' | 'album' | 'artist', entityId: string, userId: number): AccoladesResult {
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
    ['biggestDebut', data.biggestDebuts as any[]],
    ['weeksAtNo1', data.mostWeeksAtNo1 as any[]],
    ['weeksInChart', data.mostWeeksInTop5 as any[]],
    ['longestRun', data.longestChartRun as any[]],
  ];

  for (const [type, list] of checks) {
    const idx = list.findIndex((e: any) => e.entityId === entityId);
    if (idx !== -1) {
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
      const idx = list.findIndex((e: any) => e.artistId === entityId);
      if (idx !== -1) {
        accolades.push({ type, rank: idx + 1, value: list[idx].count, week: null });
      }
    }
  }

  return { metric, accolades };
}

/** Invalida la cache de todos los usuarios */
export function invalidateRecordsCache() {
  cache.clear();
}
