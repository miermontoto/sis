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

/** Detectar charts cerrados comparando periodo actual vs último visto en localStorage */
export function getClosedCharts(weekStart?: WeekStartOption): ClosedChart[] {
  const ws = weekStart ?? getWeekStart();
  const closed: ClosedChart[] = [];

  for (const gran of GRANULARITIES) {
    const current = computeCurrentPeriod(gran, ws);
    const lastSeen = localStorage.getItem(lsKey(gran));

    if (lastSeen === null) {
      // primera vez — guardar periodo actual, no notificar
      localStorage.setItem(lsKey(gran), current);
      setLastPeriod(gran, current);
      continue;
    }

    if (lastSeen !== current) {
      // el periodo cambió — lastSeen es el chart que acaba de cerrar
      closed.push({
        granularity: gran,
        period: lastSeen,
        label: `${granLabel(gran)} chart closed — ${periodLabel(lastSeen, gran)}`,
      });
    }
  }

  return closed;
}

/** Descartar notificación de un chart cerrado */
export function dismissClosedChart(gran: Granularity, weekStart?: WeekStartOption) {
  const ws = weekStart ?? getWeekStart();
  const current = computeCurrentPeriod(gran, ws);
  localStorage.setItem(lsKey(gran), current);
  setLastPeriod(gran, current);
}

/** Descartar todas las notificaciones de charts cerrados */
export function dismissAllClosedCharts(weekStart?: WeekStartOption) {
  for (const gran of GRANULARITIES) {
    dismissClosedChart(gran, weekStart);
  }
}
