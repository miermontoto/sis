import { isGranularity, isPeriodKey, isClosedPeriod } from '@sis/shared';
import { getReportCached } from '../../services/report-cache.js';
import { statsRouter, parseCalendar, parseSort } from './_shared.js';

const reports = statsRouter();

// report de un periodo cerrado, servido de la cache pre-horneada (report-cache.ts).
// el periodo en curso no se sirve: cambia con cada play, y el report es la lectura
// final del chart, no una vista en vivo. los apks publicados mandan además `tz` (el
// desfase en minutos para el reloj): ya no se lee, el reloj sale de la zona
reports.get('/report', async (c) => {
  const userId = c.get('userId');
  const granularity = c.req.query('granularity') ?? '';
  const period = c.req.query('period') ?? '';
  if (!isGranularity(granularity)) return c.json({ error: 'granularity must be week, month or year' }, 400);
  if (!isPeriodKey(period, granularity)) return c.json({ error: 'period format does not match granularity' }, 400);

  const calendar = parseCalendar(c);
  if (!isClosedPeriod(period, granularity, calendar.weekStart, calendar.timeZone)) return c.json({ error: 'period is still open' }, 400);

  const report = await getReportCached(userId, granularity, period, calendar, parseSort(c));
  if (!report) return c.json({ error: 'period does not exist' }, 404);
  return c.json(report);
});

export default reports;
