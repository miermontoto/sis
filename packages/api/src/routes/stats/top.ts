import { dbRead } from '../../db/read-pool.js';
import { getLookbackPreviousPeriodRange } from '../../db/queries/index.js';
import type { TimeRange } from '../../constants.js';
import type { EntityType } from '@sis/shared';
import { statsRouter, parseParams, buildRankChangeMap, rankChangeFields } from './_shared.js';

const top = statsRouter();

const LOOKBACK_QUALIFYING_RANGES = new Set<string>(['3months', '6months', 'year', 'thisYear', 'all']);

async function handleTopEntities(c: any, entityType: EntityType, formatFn: string, batch = false) {
  const { range, limit, rangeStart, rangeEnd, sort } = parseParams(c);
  const userId = c.get('userId');

  const rows = await dbRead<{ entity_id: string; play_count: number; total_ms: number }[]>('getTopEntities', entityType, rangeStart, sort, limit, rangeEnd, userId);

  const lookbackParam = c.req.query('lookback');
  const lookbackDays = lookbackParam === '7d' ? 7 : lookbackParam === '30d' ? 30 : null;
  const qualifies = range !== 'custom' && LOOKBACK_QUALIFYING_RANGES.has(range);

  const prev = (lookbackDays && qualifies)
    ? getLookbackPreviousPeriodRange(range as TimeRange, lookbackDays)
    : null;
  const prevRankMap = prev
    ? buildRankChangeMap(await dbRead<{ entity_id: string }[]>('getPrevPeriodEntities', entityType, prev.prevStart, prev.prevEnd, sort, userId))
    : new Map<string, number>();

  const formatted = batch
    ? await dbRead<any[]>(formatFn, rows)
    : await Promise.all(rows.map(row => dbRead<any>(formatFn, row)));

  return c.json(formatted.map((f: any, i: number) => ({
    ...f,
    ...rankChangeFields(prev, prevRankMap, rows[i].entity_id, i + 1),
  })));
}

top.get('/top-tracks', (c) => handleTopEntities(c, 'track', 'formatTopTrackRows', true));
top.get('/top-artists', (c) => handleTopEntities(c, 'artist', 'formatTopArtistRow'));
top.get('/top-albums', (c) => handleTopEntities(c, 'album', 'formatTopAlbumRow'));

top.get('/top-genres', async (c) => {
  const { limit, rangeStart, rangeEnd } = parseParams(c);
  const userId = c.get('userId');
  return c.json(await dbRead('getTopGenres', rangeStart, rangeEnd, limit, userId));
});

export default top;
