import type { Granularity, WeekStartOption } from '$lib/api';
import { getWeekStart, setLastPeriod } from '$lib/api';
import { periodForDate, periodBounds } from '@sis/shared';
import { formatMonthYear } from './format';

const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];
const DAY_MS = 86_400_000;

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/** 'YYYY-MM-DD' de una fecha UTC (el formato de startDate/endDate en la API) */
export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Clave de semana de una fecha UTC: la misma que strftime('%Y-W%W') tras el
 * desplazamiento de periodExpr(). El cálculo vive en @sis/shared (periods.ts),
 * compartido con el servidor y testeado contra el propio sqlite; aquí solo se fija
 * la granularidad.
 */
export function weekKey(date: Date, ws: WeekStartOption): string {
  return periodForDate(date, 'week', ws);
}

/**
 * Días reales que cubre una clave de semana, ambos extremos inclusivos a las 00:00
 * UTC (el límite compartido es exclusivo). null si la clave no es una semana o no
 * existe en ese año (la W00 de un año que empieza en lunes, una W53 de más).
 */
export function weekDateRange(period: string, ws: WeekStartOption): { start: Date; end: Date } | null {
  const bounds = periodBounds(period, 'week', ws);
  return bounds ? { start: new Date(bounds.start), end: new Date(Date.parse(bounds.end) - DAY_MS) } : null;
}

/** Periodo actual: el que el servidor asignaría a un play de hoy */
export function computeCurrentPeriod(gran: Granularity, ws: WeekStartOption): string {
  const now = new Date();
  if (gran === 'year') return String(now.getFullYear());
  if (gran === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // el día natural local, llevado a UTC para que weekKey() no vuelva a aplicar la zona
  return weekKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())), ws);
}

/** Periodo anterior */
export function prevPeriod(period: string, granularity: Granularity): string | null {
  if (granularity === 'year') return String(parseInt(period) - 1);
  if (granularity === 'month') {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // el desplazamiento no cambia la secuencia de claves, sólo qué días cubre cada
  // una: basta retroceder un día desde el arranque de la semana en espacio de lunes
  const range = weekDateRange(period, 'monday');
  return range ? weekKey(addDays(range.start, -1), 'monday') : null;
}

export interface ClosedChart {
  granularity: Granularity;
  period: string;
  label: string;
}

function lsKey(gran: Granularity): string {
  return `sis:lastPeriod:${gran}`;
}

/** Label legible para un periodo */
export function periodLabel(period: string, gran: Granularity): string {
  if (gran === 'year') return period;
  if (gran === 'month') {
    if (!/^\d{4}-\d{2}$/.test(period)) return period;
    return formatMonthYear(period + '-01');
  }
  const match = period.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return period;
  return `Week ${parseInt(match[2])}, ${match[1]}`;
}

/** Granularity label */
function granLabel(gran: Granularity): string {
  if (gran === 'week') return 'Weekly';
  if (gran === 'month') return 'Monthly';
  return 'Yearly';
}

/**
 * Periodo cerrado más reciente: el inmediatamente anterior al actual.
 * Es un periodo pasado y absoluto, no depende de la hora local de cada
 * dispositivo (a diferencia de `current`).
 */
function justClosedPeriod(gran: Granularity, ws: WeekStartOption): string | null {
  return prevPeriod(computeCurrentPeriod(gran, ws), gran);
}

/**
 * El marcador guardado (`lsKey`) es el último periodo cerrado que el usuario
 * descartó. Comparamos por orden — los formatos YYYY, YYYY-MM y YYYY-Www van
 * zero-padded y year-first, así que el orden lexicográfico = orden cronológico.
 * Al comparar periodos pasados absolutos (no `current`), el resultado es
 * idéntico en todos los dispositivos: descartar en uno se respeta en el resto.
 */
export function getClosedCharts(weekStart?: WeekStartOption): ClosedChart[] {
  const ws = weekStart ?? getWeekStart();
  const closed: ClosedChart[] = [];

  for (const gran of GRANULARITIES) {
    const justClosed = justClosedPeriod(gran, ws);
    if (justClosed === null) continue;
    const marker = localStorage.getItem(lsKey(gran));

    if (marker === null) {
      // primera vez — marcar el cierre actual como visto, no notificar
      localStorage.setItem(lsKey(gran), justClosed);
      setLastPeriod(gran, justClosed);
      continue;
    }

    if (justClosed > marker) {
      // hay un cierre más reciente que el último descartado
      closed.push({
        granularity: gran,
        period: justClosed,
        label: `${granLabel(gran)} chart closed — ${periodLabel(justClosed, gran)}`,
      });
    }
  }

  return closed;
}

/** Descartar notificación de un chart cerrado */
export function dismissClosedChart(gran: Granularity, weekStart?: WeekStartOption) {
  const ws = weekStart ?? getWeekStart();
  const justClosed = justClosedPeriod(gran, ws);
  if (justClosed === null) return;
  localStorage.setItem(lsKey(gran), justClosed);
  setLastPeriod(gran, justClosed);
}

/** Descartar todas las notificaciones de charts cerrados */
export function dismissAllClosedCharts(weekStart?: WeekStartOption) {
  for (const gran of GRANULARITIES) {
    dismissClosedChart(gran, weekStart);
  }
}
