import type { Granularity, WeekStartOption } from '$lib/api';
import { getWeekStart, setLastPeriod } from '$lib/api';
import { formatMonthYear } from './format';

const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];
const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
// días que periodExpr() resta a played_at antes de calcular %W (espejo del servidor)
const WEEK_START_SHIFT: Record<WeekStartOption, number> = { monday: 0, sunday: 1, friday: 4 };
const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
// lunes = 0 … domingo = 6, como el `wd` de strftime('%W')
const mondayBasedDay = (d: Date) => (d.getUTCDay() + 6) % DAYS_PER_WEEK;
const dayOfYear = (d: Date) => Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS);

/** 'YYYY-MM-DD' de una fecha UTC (el formato de startDate/endDate en la API) */
export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Clave de semana de una fecha UTC: réplica exacta de strftime('%Y-W%W') tras el
 * desplazamiento de periodExpr(). Semanas de lunes; la que contiene el 1 de enero
 * es la 01 si ese día cae en lunes y la 00 si no. SQLite calcula
 * (día_del_año + 7 - día_de_semana) / 7, y no (día_del_año + desfase_de_ene_1) / 7:
 * la segunda fórmula da una semana de menos los años que empiezan en lunes (2024).
 */
export function weekKey(date: Date, ws: WeekStartOption): string {
  const shifted = addDays(date, -WEEK_START_SHIFT[ws]);
  const week = Math.floor((dayOfYear(shifted) + DAYS_PER_WEEK - mondayBasedDay(shifted)) / DAYS_PER_WEEK);
  return `${shifted.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Días reales que cubre una clave de semana: la inversa de weekKey(). En el
 * espacio desplazado la semana N va del lunes N al domingo, recortada al año
 * (la 00 empieza el 1 de enero y la última acaba el 31 de diciembre: los días de
 * fuera pertenecen a la clave del año vecino); después se deshace el desplazamiento.
 */
export function weekDateRange(period: string, ws: WeekStartOption): { start: Date; end: Date } | null {
  const match = period.match(WEEK_KEY_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const dec31 = new Date(Date.UTC(year, 11, 31));
  // primer lunes del año (el propio 1 de enero si cae en lunes) + 7 días por semana
  const monday = addDays(jan1, (DAYS_PER_WEEK - mondayBasedDay(jan1)) % DAYS_PER_WEEK + (week - 1) * DAYS_PER_WEEK);
  const shift = WEEK_START_SHIFT[ws];
  return {
    start: addDays(new Date(Math.max(monday.getTime(), jan1.getTime())), shift),
    end: addDays(new Date(Math.min(addDays(monday, DAYS_PER_WEEK - 1).getTime(), dec31.getTime())), shift),
  };
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
