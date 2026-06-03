import { dbRead } from '../../db/read-pool.js';
import { CHART_SIZE } from '../../constants.js';
import type { Granularity } from '@sis/shared';
import { statsRouter, parseWeekStart, parseSort, periodMatchesGranularity, toEntityType } from './_shared.js';

const charts = statsRouter();

charts.get('/charts/periods', async (c) => {
  const userId = c.get('userId');
  const granularity = (c.req.query('granularity') || 'week') as Granularity;
  return c.json({ periods: await dbRead('getAvailablePeriods', granularity, parseWeekStart(c), userId) });
});

charts.get('/charts', async (c) => {
  const userId = c.get('userId');
  const type = toEntityType(c.req.query('type') || 'tracks');
  const granularity = (c.req.query('granularity') || 'week') as Granularity;
  const limit = Math.min(parseInt(c.req.query('limit') || String(CHART_SIZE)), CHART_SIZE);
  const period = c.req.query('period');

  if (!period) return c.json({ error: 'period is required' }, 400);
  if (!periodMatchesGranularity(period, granularity)) return c.json({ error: 'period format does not match granularity' }, 400);

  return c.json(await dbRead('getChart', type, granularity, parseWeekStart(c), period, parseSort(c), userId, limit));
});

charts.get('/charts/peaks', async (c) => {
  const userId = c.get('userId');
  const type = toEntityType(c.req.query('type') || 'tracks');
  const granularity = (c.req.query('granularity') || 'week') as Granularity;
  const period = c.req.query('period');
  const ids = c.req.query('ids');

  if (!period) return c.json({ error: 'period is required' }, 400);
  if (!ids) return c.json({ error: 'ids is required' }, 400);

  const entityIds = ids.split(',').filter(Boolean);
  return c.json(await dbRead('getChartPeaks', type, granularity, parseWeekStart(c), period, parseSort(c), userId, entityIds));
});

charts.get('/chart-history/:type/:id', async (c) => {
  const userId = c.get('userId');
  const entityType = toEntityType(c.req.param('type'));
  const id = c.req.param('id');

  return c.json(await dbRead('getEntityChartHistory', entityType, id, parseWeekStart(c), parseSort(c), userId));
});

export default charts;
