import { stream } from 'hono/streaming';
import { dbRead } from '../../db/read-pool.js';
import { prevPeriod } from '../../db/queries/index.js';
import { CHART_SIZE, PEAKS_SLICE_LOOKAHEAD } from '../../constants.js';
import type { Granularity } from '@sis/shared';
import { ChartPeaksAccumulator, type ChartRankSlice } from '../../services/chart-peaks.js';
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

// mismas stats que /charts/peaks pero en NDJSON, una línea por entidad conforme
// se cierra. El escaneo va del año más reciente al más antiguo y una entidad
// queda cerrada en cuanto se ha escaneado más atrás de su primer play, así que
// la mayoría del chart se pinta con el primer trozo en vez de esperar al total.
charts.get('/charts/peaks/stream', async (c) => {
  const userId = c.get('userId');
  const type = toEntityType(c.req.query('type') || 'tracks');
  const granularity = (c.req.query('granularity') || 'week') as Granularity;
  const weekStart = parseWeekStart(c);
  const sort = parseSort(c);
  const period = c.req.query('period');
  const ids = c.req.query('ids');

  if (!period) return c.json({ error: 'period is required' }, 400);
  if (!ids) return c.json({ error: 'ids is required' }, 400);

  const entityIds = ids.split(',').filter(Boolean);
  const { slices, firstPeriods } = await dbRead('chartPeakSlices', type, granularity, weekStart, period, userId, entityIds);
  const acc = new ChartPeaksAccumulator(entityIds, firstPeriods, period, prevPeriod(period, granularity));

  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  // el cliente ya cachea el resultado ensamblado; y nginx no debe bufferizar
  // la respuesta o el streaming se pierde en el proxy
  c.header('Cache-Control', 'no-store');
  c.header('X-Accel-Buffering', 'no');

  return stream(c, async (s) => {
    const pending: (Promise<ChartRankSlice> | null)[] = new Array(slices.length).fill(null);
    const fetchSlice = (i: number) => {
      if (i >= slices.length || pending[i]) return;
      pending[i] = dbRead('getChartRankSlice', type, granularity, weekStart, period, sort, userId, entityIds, slices[i].startAt, slices[i].endAt);
    };

    for (let i = 0; i < slices.length; i++) {
      fetchSlice(i);
      acc.addSlice(await pending[i]!);
      for (const peak of acc.drain(slices[i].year, i === slices.length - 1)) await s.writeln(JSON.stringify(peak));
      if (acc.done || s.aborted) break;
      // ceder el turno de event loop para que lo ya escrito salga por el socket
      // antes de encadenar el siguiente trozo: en dev las queries corren en
      // modo directo (síncronas, sin worker pool) y sin esto bloquearían el
      // flush hasta el final, entregando la respuesta entera de golpe
      await new Promise(resolve => setImmediate(resolve));
      // el siguiente trozo se calcula en otro worker mientras se emite este
      for (let k = 1; k <= PEAKS_SLICE_LOOKAHEAD; k++) fetchSlice(i + k);
    }
  });
});

charts.get('/chart-history/:type/:id', async (c) => {
  const userId = c.get('userId');
  const entityType = toEntityType(c.req.param('type'));
  const id = c.req.param('id');

  return c.json(await dbRead('getEntityChartHistory', entityType, id, parseWeekStart(c), parseSort(c), userId));
});

export default charts;
