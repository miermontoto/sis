import { isGranularity, isPeriodKey, isClosedPeriod } from '@sis/shared';
import { getReportCached } from '../../services/report-cache.js';
import { statsRouter, parseWeekStart, parseSort } from './_shared.js';

const reports = statsRouter();

// desfase horario del cliente en minutos (mismo param que /stats/history), acotado
// al rango real de zonas horarias
const TZ_OFFSET_MAX_MINUTES = 14 * 60;

// report de un periodo cerrado, servido de la cache pre-horneada (report-cache.ts).
// el periodo en curso no se sirve: cambia con cada play, y el report es la lectura
// final del chart, no una vista en vivo
reports.get('/report', async (c) => {
  const userId = c.get('userId');
  const granularity = c.req.query('granularity') ?? '';
  const period = c.req.query('period') ?? '';
  if (!isGranularity(granularity)) return c.json({ error: 'granularity must be week, month or year' }, 400);
  if (!isPeriodKey(period, granularity)) return c.json({ error: 'period format does not match granularity' }, 400);

  const weekStart = parseWeekStart(c);
  if (!isClosedPeriod(period, granularity, weekStart)) return c.json({ error: 'period is still open' }, 400);

  const tzRaw = Number.parseInt(c.req.query('tz') ?? '0');
  const tz = Number.isFinite(tzRaw) ? Math.max(-TZ_OFFSET_MAX_MINUTES, Math.min(TZ_OFFSET_MAX_MINUTES, tzRaw)) : 0;

  const report = await getReportCached(userId, granularity, period, weekStart, parseSort(c), tz);
  if (!report) return c.json({ error: 'period does not exist' }, 404);
  return c.json(report);
});

export default reports;
