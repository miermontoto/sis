import type { Context } from 'hono';
import { dbRead } from '../../db/read-pool.js';
import { getLookbackPreviousPeriodRange } from '../../db/queries/index.js';
import type { AggregateRow } from '../../db/queries/index.js';
import type { TimeRange } from '../../constants.js';
import type { EntityType } from '@sis/shared';
import { statsRouter, parseParams, buildRankChangeMap, rankChangeFields } from './_shared.js';

const top = statsRouter();

const LOOKBACK_QUALIFYING_RANGES = new Set<string>(['3months', '6months', 'year', 'thisYear', 'all']);

// El formateo se recibe como callback en vez de como nombre suelto + flag `batch`:
// así el par (entidad, formateador) queda fijado en la propia ruta y el dispatch es
// estático. `object[]` es lo que de verdad necesita el handler — sólo decora cada
// fila con los campos de rank change antes de serializarla.
type FormatTopRows = (rows: AggregateRow[]) => Promise<object[]>;

async function handleTopEntities(c: Context, entityType: EntityType, format: FormatTopRows) {
  const { range, limit, rangeStart, rangeEnd, sort } = parseParams(c);
  const userId = c.get('userId');

  const rows = await dbRead('getTopEntities', entityType, rangeStart, sort, limit, rangeEnd, userId);

  const lookbackParam = c.req.query('lookback');
  const lookbackDays = lookbackParam === '7d' ? 7 : lookbackParam === '30d' ? 30 : null;
  const qualifies = range !== 'custom' && LOOKBACK_QUALIFYING_RANGES.has(range);

  const prev = (lookbackDays && qualifies)
    ? getLookbackPreviousPeriodRange(range as TimeRange, lookbackDays)
    : null;
  const prevRankMap = prev
    ? buildRankChangeMap(await dbRead('getPrevPeriodEntities', entityType, prev.prevStart, prev.prevEnd, sort, userId))
    : new Map<string, number>();

  const formatted = await format(rows);

  return c.json(formatted.map((f, i) => ({
    ...f,
    ...rankChangeFields(prev, prevRankMap, rows[i].entity_id, i + 1),
  })));
}

// los tracks se formatean en batch: enrichTracksBatch resuelve álbum y artistas de
// todas las filas en dos queries. artistas y álbumes van fila a fila.
top.get('/top-tracks', (c) => handleTopEntities(c, 'track', rows => dbRead('formatTopTrackRows', rows)));
top.get('/top-artists', (c) => handleTopEntities(c, 'artist', rows => Promise.all(rows.map(row => dbRead('formatTopArtistRow', row)))));
top.get('/top-albums', (c) => handleTopEntities(c, 'album', rows => Promise.all(rows.map(row => dbRead('formatTopAlbumRow', row)))));

top.get('/top-genres', async (c) => {
  const { limit, rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  return c.json(await dbRead('getTopGenres', rangeStart, rangeEnd, limit, userId));
});

export default top;
