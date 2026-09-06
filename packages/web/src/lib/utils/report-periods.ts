// helpers de periodo para las páginas de reports, sobre el modelo compartido con el
// servidor (@sis/shared): la misma regla y el mismo UTC que etiquetan los plays, así
// que "último cerrado" aquí coincide con lo que el endpoint acepta como cerrado
import type { Granularity, WeekStartOption } from '$lib/api';
import { periodForDate, periodBounds, adjacentPeriod, isClosedPeriod } from '@sis/shared';
import { formatMonthYear, formatShortDateUTC } from './format';

const DAY_MS = 86_400_000;

export const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];
export const GRANULARITY_LABELS: Record<Granularity, string> = { week: 'Weekly', month: 'Monthly', year: 'Yearly' };
export const GRANULARITY_NOUNS: Record<Granularity, string> = { week: 'Week', month: 'Month', year: 'Year' };

/** Último periodo cerrado: el anterior al que contiene ahora mismo. */
export function latestClosedPeriod(gran: Granularity, ws: WeekStartOption, now = new Date()): string | null {
  return adjacentPeriod(periodForDate(now, gran, ws), gran, ws, -1);
}

/** Rango de fechas de un periodo para leer: "Sep 4 – Sep 10", "August 2026", "2025". */
export function periodDateRange(period: string, gran: Granularity, ws: WeekStartOption): string {
  if (gran === 'year') return period;
  if (gran === 'month') return periodBounds(period, gran, ws) ? formatMonthYear(period + '-01') : period;
  const bounds = periodBounds(period, gran, ws);
  if (!bounds) return period;
  // el fin es exclusivo: el último día del periodo es el anterior
  return `${formatShortDateUTC(new Date(bounds.start))} – ${formatShortDateUTC(new Date(Date.parse(bounds.end) - DAY_MS))}`;
}

/** Periodo de otra granularidad que contiene el inicio de este (cambiar de semana a
 *  mes conserva el contexto temporal); si ese aún no ha cerrado, el último cerrado. */
export function siblingPeriod(period: string, from: Granularity, to: Granularity, ws: WeekStartOption): string | null {
  const bounds = periodBounds(period, from, ws);
  if (!bounds) return latestClosedPeriod(to, ws);
  const sibling = periodForDate(new Date(bounds.start), to, ws);
  return isClosedPeriod(sibling, to, ws) ? sibling : latestClosedPeriod(to, ws);
}

/** Claves de todos los buckets de un periodo (días 'YYYY-MM-DD' o meses 'YYYY-MM'),
 *  para rellenar con ceros los que no tienen plays. */
export function periodBuckets(period: string, gran: Granularity, ws: WeekStartOption): string[] {
  const bounds = periodBounds(period, gran, ws);
  if (!bounds) return [];
  const start = Date.parse(bounds.start);
  const end = Date.parse(bounds.end);
  if (gran === 'year') {
    const year = new Date(start).getUTCFullYear();
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  }
  const keys: string[] = [];
  for (let t = start; t < end; t += DAY_MS) keys.push(new Date(t).toISOString().slice(0, 10));
  return keys;
}
