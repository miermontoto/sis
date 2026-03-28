import { getDb } from '../db/connection.js';
import { getRecords } from '../db/queries/index.js';
import type { RecordsResponse } from '../db/queries/index.js';
import { userSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

type WeekStart = 'monday' | 'sunday' | 'friday';
type Sort = 'plays' | 'time';
type EntityTypeFilter = 'tracks' | 'albums' | 'artists';

// cache: "weekStart:sort" → resultado completo (all types, limit 50)
const cache = new Map<string, RecordsResponse>();

function key(ws: WeekStart, sort: Sort) {
  return `${ws}:${sort}`;
}

function getUserSettings(db: ReturnType<typeof getDb>): { weekStart: WeekStart; sort: Sort } {
  const rows = db.select().from(userSettings)
    .where(eq(userSettings.userId, 'default'))
    .all();

  const map = new Map(rows.map(r => [r.key, r.value]));
  return {
    weekStart: (map.get('weekStart') as WeekStart) || 'friday',
    sort: ((map.get('rankingMetric') === 'plays' ? 'plays' : 'time') as Sort),
  };
}

/** Computa records para las settings activas y los guarda en cache */
export function computeAndCacheRecords() {
  const db = getDb();
  const { weekStart, sort } = getUserSettings(db);
  const k = key(weekStart, sort);

  console.log(`[records-cache] computing records (${k})...`);
  const start = performance.now();
  const result = getRecords(db, weekStart, sort, 50) as RecordsResponse;
  const ms = (performance.now() - start).toFixed(0);
  console.log(`[records-cache] done in ${ms}ms`);

  cache.clear(); // solo cacheamos la combinación activa
  cache.set(k, result);
}

/** Devuelve records cacheados si los params coinciden, o null */
export function getCachedRecords(weekStart: WeekStart, sort: Sort, limit: number, type?: EntityTypeFilter): Partial<RecordsResponse> | null {
  const cached = cache.get(key(weekStart, sort));
  if (!cached) return null;

  const sliceEntity = (e: RecordsResponse['tracks']) => ({
    peakWeekPlays: e.peakWeekPlays.slice(0, limit),
    biggestDebuts: e.biggestDebuts.slice(0, limit),
    mostWeeksAtNo1: e.mostWeeksAtNo1.slice(0, limit),
    mostWeeksInTop5: e.mostWeeksInTop5.slice(0, limit),
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
  type: string;   // peakWeek | biggestDebut | weeksAtNo1 | weeksInChart | mostNo1Tracks | mostNo1Albums
  rank: number;   // posición en la lista de records (1-indexed)
  value: number;  // valor del record
  week: string | null; // periodo (si aplica)
}

/** Resultado de accolades: incluye la métrica usada para formatear valores */
export interface AccoladesResult {
  metric: 'plays' | 'time';
  accolades: Accolade[];
}

/** Busca en la cache qué records tiene una entidad */
export function getEntityAccolades(entityType: 'track' | 'album' | 'artist', entityId: string): AccoladesResult {
  // buscar en cualquier cache entry disponible
  const cacheEntry = [...cache.entries()][0];
  if (!cacheEntry) return { metric: 'time', accolades: [] };
  const [cacheKey, cached] = cacheEntry;
  const metric = cacheKey.split(':')[1] as 'plays' | 'time';

  const accolades: Accolade[] = [];
  const plural = entityType === 'track' ? 'tracks' : entityType === 'album' ? 'albums' : 'artists';
  const data = cached[plural];
  if (!data) return { metric, accolades: [] };

  // records base (peakWeekPlays, biggestDebuts, mostWeeksAtNo1, mostWeeksInTop5)
  const checks: [string, { entityId?: string; artistId?: string; value: number; week: string | null }[]][] = [
    ['peakWeek', data.peakWeekPlays as any[]],
    ['biggestDebut', data.biggestDebuts as any[]],
    ['weeksAtNo1', data.mostWeeksAtNo1 as any[]],
    ['weeksInChart', data.mostWeeksInTop5 as any[]],
  ];

  for (const [type, list] of checks) {
    const idx = list.findIndex((e: any) => e.entityId === entityId);
    if (idx !== -1) {
      const entry = list[idx] as any;
      accolades.push({ type, rank: idx + 1, value: entry.value, week: entry.week ?? null });
    }
  }

  // records exclusivos de artistas
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

/** Invalida la cache (llamar cuando cambian settings relevantes) */
export function invalidateRecordsCache() {
  cache.clear();
}
