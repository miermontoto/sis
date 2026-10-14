import { periodBounds, type WeekStartOption } from '@sis/shared';
import { MIN_BAR_SLOT_PX, periodToQuarter, periodToYear } from './chart';

// calendario de las gráficas del detalle: la de actividad (escuchas y acumulado) y la de
// ranking (posición all-time) van sobre los mismos meses, del primer play al mes en curso,
// para que el enlace por mes entre las dos (y con el chart run) case. Aquí se llevan a
// meses y de ahí al bucket que quepa en el ancho. módulo puro: las gráficas sólo pintan

export type TimelineGranularity = 'month' | 'year';

export interface TimelineBucket {
  /** YYYY-MM | YYYY-Qn | YYYY: el mismo formato que dateToPeriodKey (ReleaseRail, markLine) */
  key: string;
  /** meses YYYY-MM que cubre, en orden */
  months: string[];
  plays: number;
  ms: number;
  /** acumulado all-time al cierre del bucket */
  cumPlays: number;
  cumMs: number;
  /** posición all-time al cierre del bucket; null antes del primer play */
  rank: number | null;
}

export interface TimelineSources {
  /** serie mensual del detalle (range=all) */
  series: { period: string; play_count: number; total_ms: number }[];
  /** ranking all-time acumulado, mensual */
  rankHistory: { period: string; rank: number }[];
  /** fin del eje: el mes en curso, aunque la entidad lleve años sin sonar */
  now: Date;
}

const MONTH_KEY = /^\d{4}-\d{2}$/;
const MONTHS_PER_YEAR = 12;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** mes YYYY-MM en UTC, como etiqueta el servidor */
export const utcMonth = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;

/** meses de first a last, ambos incluidos */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  const [ey, em] = last.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad2(m)}`);
    if (++m > MONTHS_PER_YEAR) { m = 1; y++; }
  }
  return out;
}

/** mes al que pertenece una semana del chart: el de su primer día, con el corte de weekStart.
 *  ChartStats lo usa para casar sus celdas con las columnas de las gráficas */
export function weekMonth(period: string, weekStart: WeekStartOption): string | null {
  const bounds = periodBounds(period, 'week', weekStart);
  return bounds ? bounds.start.slice(0, 7) : null;
}

/**
 * Una fila por mes, del primer mes con datos al mes en curso. El ranking es acumulado:
 * un mes en el que nadie escuchó nada no tiene fila en el historial (el servidor sólo
 * emite meses con plays) y su posición es la del mes anterior, así que se arrastra.
 */
export function timelineMonths({ series, rankHistory, now }: TimelineSources): TimelineBucket[] {
  const firsts = [series[0]?.period, rankHistory[0]?.period].filter((p): p is string => !!p && MONTH_KEY.test(p));
  if (!firsts.length) return [];
  const lasts = [series.at(-1)?.period, rankHistory.at(-1)?.period, utcMonth(now)].filter((p): p is string => !!p && MONTH_KEY.test(p));

  const plays = new Map(series.map(s => [s.period, s]));
  const ranks = new Map(rankHistory.map(h => [h.period, h.rank]));

  let cumPlays = 0;
  let cumMs = 0;
  let rank: number | null = null;
  return monthRange(firsts.sort()[0], lasts.sort().at(-1)!).map(month => {
    const s = plays.get(month);
    cumPlays += s?.play_count ?? 0;
    cumMs += s?.total_ms ?? 0;
    rank = ranks.get(month) ?? rank;
    return {
      key: month,
      months: [month],
      plays: s?.play_count ?? 0,
      ms: s?.total_ms ?? 0,
      cumPlays,
      cumMs,
      rank,
    };
  });
}

/**
 * Agrupa meses consecutivos por clave de calendario. Sin pérdida: las escuchas se suman,
 * y el acumulado y la posición all-time son los del último mes (son acumulados, así que
 * el cierre del bucket ES su valor).
 */
export function bucketTimeline(months: TimelineBucket[], keyFn: (month: string) => string): TimelineBucket[] {
  const out: TimelineBucket[] = [];
  for (const m of months) {
    const key = keyFn(m.key);
    const b = out.at(-1);
    if (b?.key === key) {
      b.months.push(m.key);
      b.plays += m.plays;
      b.ms += m.ms;
      b.cumPlays = m.cumPlays;
      b.cumMs = m.cumMs;
      b.rank = m.rank ?? b.rank;
    } else {
      out.push({ ...m, key, months: [m.key] });
    }
  }
  return out;
}

/**
 * Columnas que se pintan. `year` agrupa por año; `month` es el mes cuando cabe con un
 * slot legible y si no baja a trimestre y a año, igual que fitSeries. Con un año
 * enfocado (el drill-down de la vista por años) son sus meses, sin agregar.
 */
export function fitTimeline(months: TimelineBucket[], width: number, granularity: TimelineGranularity, focusYear: string | null): TimelineBucket[] {
  if (focusYear) return months.filter(m => m.key.startsWith(`${focusYear}-`));
  if (granularity === 'year') return bucketTimeline(months, periodToYear);
  if (!width) return months;
  const maxBars = Math.floor(width / MIN_BAR_SLOT_PX);
  if (months.length <= maxBars) return months;
  const quarters = bucketTimeline(months, periodToQuarter);
  return quarters.length <= maxBars ? quarters : bucketTimeline(months, periodToYear);
}

/** columna que contiene el mes, o -1 */
export function bucketIndexOf(buckets: TimelineBucket[], month: string): number {
  return buckets.findIndex(b => b.months[0] <= month && month <= b.months.at(-1)!);
}

export const isMonthBucket = (b: TimelineBucket) => MONTH_KEY.test(b.key);
