import type { Granularity, WeekStartOption } from '$lib/api';
import { getWeekStart, setLastPeriod } from '$lib/api';
import { formatMonthYear } from './format';

const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];

/** Replicar strftime('%Y-W%W', date, offset) de SQLite */
export function computeCurrentPeriod(gran: Granularity, ws: WeekStartOption): string {
  const now = new Date();
  if (gran === 'year') return String(now.getFullYear());
  if (gran === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const d = new Date(now);
  if (ws === 'sunday') d.setDate(d.getDate() - 1);
  else if (ws === 'friday') d.setDate(d.getDate() - 4);

  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
  const jan1DayMon = jan1Day === 0 ? 6 : jan1Day - 1;
  const daysFromJan1 = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.floor((daysFromJan1 + jan1DayMon) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/** Periodo anterior */
export function prevPeriod(period: string, granularity: Granularity): string | null {
  if (granularity === 'year') return String(parseInt(period) - 1);
  if (granularity === 'month') {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const match = period.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const [, ys, ws] = match;
  const wn = parseInt(ws);
  if (wn <= 0) return `${parseInt(ys) - 1}-W52`;
  return `${ys}-W${String(wn - 1).padStart(2, '0')}`;
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
