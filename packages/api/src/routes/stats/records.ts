import { getDb } from '../../db/connection.js';
import { dbRead } from '../../db/read-pool.js';
import { RECORDS_LIMIT, RECENT_CHANGES_DEFAULT_DAYS, RECENT_CHANGES_MAX_DAYS, RANKINGS_BATCH_LIMIT } from '../../constants.js';
import { getCachedRecords, getEntityAccolades, getUserSettingsForUser, computeAndCacheForUserAsync } from '../../services/records-cache.js';
import { getRecentRankChangesCached } from '../../services/recent-changes-cache.js';
import { getProjectedRankings } from '../../services/projection-cache.js';
import type { EntityType, RecentRankChangesResponse } from '@sis/shared';
import { statsRouter, parseWeekStart, parseSort, parseRecordsUnique, toEntityType } from './_shared.js';

const records = statsRouter();

records.get('/records', async (c) => {
  const userId = c.get('userId');
  const weekStart = parseWeekStart(c);
  const sort = parseSort(c);
  const unique = parseRecordsUnique(c);
  const limit = Math.min(parseInt(c.req.query('limit') || String(RECORDS_LIMIT)), 50);
  const rawType = c.req.query('type');
  const type = rawType ? toEntityType(rawType) : undefined;

  const cached = getCachedRecords(userId, weekStart, sort, limit, type, unique);
  if (cached) return c.json(cached);
  // con los ajustes del usuario la respuesta es justo la que hornea la cache: esperar a
  // ese horneado (deduplicado por usuario) en vez de lanzar otro escaneo completo por
  // tipo en paralelo con él, que es lo que pasaba en cada arranque con la cache fría
  const spotifyId = c.get('spotifyId');
  const own = getUserSettingsForUser(getDb(), spotifyId);
  if (own.weekStart === weekStart && own.sort === sort && own.unique === unique) {
    await computeAndCacheForUserAsync(userId, spotifyId, true);
    const baked = getCachedRecords(userId, weekStart, sort, limit, type, unique);
    if (baked) return c.json(baked);
  }
  return c.json(await dbRead('getRecords', weekStart, sort, limit, type, userId, unique));
});

records.get('/accolades/:type/:id', async (c) => {
  const userId = c.get('userId');
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  return c.json(await getEntityAccolades(entityType, id, userId, c.get('spotifyId')));
});

records.get('/rankings/:type/:id', async (c) => {
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  const userId = c.get('userId');
  return c.json(await dbRead('computeRankings', entityType, id, parseSort(c), userId));
});

// ranking all-time por lotes: posición global de cada entidad listada en una vista
// de detalle (top tracks/albums del artista, tracks del álbum) con un solo scan.
records.get('/rankings-batch', async (c) => {
  const userId = c.get('userId');
  const type = c.req.query('type');
  if (type !== 'track' && type !== 'album') return c.json({ error: 'invalid type' }, 400);
  const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean).slice(0, RANKINGS_BATCH_LIMIT);
  if (ids.length === 0) return c.json({});
  return c.json(await dbRead('computeRankingsBatch', type, ids, parseSort(c), userId));
});

records.get('/ranking-history/:type/:id', async (c) => {
  const entityType = c.req.param('type') as EntityType;
  const id = c.req.param('id');
  const userId = c.get('userId');
  const fn = c.req.query('crossovers') === 'true' ? 'getRankingHistoryWithCrossovers' : 'getRankingHistory';
  return c.json(await dbRead(fn, entityType, id, parseSort(c), userId));
});

// cambios de posición recientes: ranking actual vs hace N días, por tipo de entidad.
// mismo espíritu que projected-rankings pero permanente (no depende de la sesión).
// respeta los mismos límites de rank que la session card y sirve desde la cache SWR.
records.get('/recent-rank-changes', async (c) => {
  const userId = c.get('userId');
  const spotifyId = c.get('spotifyId');
  const sort = parseSort(c);
  const rawDays = parseInt(c.req.query('days') || String(RECENT_CHANGES_DEFAULT_DAYS), 10);
  const days = Math.min(Math.max(Number.isNaN(rawDays) ? RECENT_CHANGES_DEFAULT_DAYS : rawDays, 1), RECENT_CHANGES_MAX_DAYS);

  const data = await getRecentRankChangesCached(userId, spotifyId, days, sort);
  return c.json(data satisfies RecentRankChangesResponse);
});

// proyecciones de la session card: base pre-sesión cacheada + delta de la sesión, en
// workers (ver services/projection-cache.ts)
records.get('/projected-rankings', async (c) => {
  return c.json(await getProjectedRankings(c.get('userId'), c.get('spotifyId'), parseSort(c)));
});

export default records;
