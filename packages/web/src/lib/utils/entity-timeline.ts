import { periodBounds, type WeekStartOption } from '@sis/shared';
import { MIN_BAR_SLOT_PX, periodToQuarter, periodToYear } from './chart';

// eje compartido de la timeline del detalle: escuchas, acumulado, posición all-time y
// posición en los charts semanales sobre las MISMAS columnas. Las cuatro fuentes llegan
// con calendarios distintos (serie mensual del detalle, historial mensual de ranking,
// semanas del chart) y aquí se llevan a meses y de ahí al bucket que quepa en el ancho.
// módulo puro: la gráfica sólo pinta lo que sale de aquí

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
  /** mejor posición semanal dentro del bucket; null si no entró en ningún chart */
  chartRank: number | null;
}

export interface TimelineSources {
  /** serie mensual del detalle (range=all) */
  series: { period: string; play_count: number; total_ms: number }[];
  /** ranking all-time acumulado, mensual */
  rankHistory: { period: string; rank: number }[];
  /** trayectoria semanal en charts (rank null = fuera del chart esa semana) */
  chartWeeks: { period: string; rank: number | null }[];
  weekStart: WeekStartOption;
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

/** mes al que pertenece una semana del chart: el de su primer día, con el corte de weekStart */
export function weekMonth(period: string, weekStart: WeekStartOption): string | null {
  const bounds = periodBounds(period, 'week', weekStart);
  return bounds ? bounds.start.slice(0, 7) : null;
}

/**
 * Una fila por mes, del primer mes con datos al mes en curso. El ranking es acumulado:
 * un mes en el que nadie escuchó nada no tiene fila en el historial (el servidor sólo
 * emite meses con plays) y su posición es la del mes anterior, así que se arrastra.
 */
export function timelineMonths({ series, rankHistory, chartWeeks, weekStart, now }: TimelineSources): TimelineBucket[] {
  const firsts = [series[0]?.period, rankHistory[0]?.period].filter((p): p is string => !!p && MONTH_KEY.test(p));
  if (!firsts.length) return [];
  const lasts = [series.at(-1)?.period, rankHistory.at(-1)?.period, utcMonth(now)].filter((p): p is string => !!p && MONTH_KEY.test(p));

  const plays = new Map(series.map(s => [s.period, s]));
  const ranks = new Map(rankHistory.map(h => [h.period, h.rank]));
  const chartBest = new Map<string, number>();
  for (const w of chartWeeks) {
    if (w.rank == null) continue;
    const month = weekMonth(w.period, weekStart);
    if (month) chartBest.set(month, Math.min(chartBest.get(month) ?? Infinity, w.rank));
  }

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
      chartRank: chartBest.get(month) ?? null,
    };
  });
}

/**
 * Agrupa meses consecutivos por clave de calendario. Sin pérdida: las escuchas se suman,
 * el acumulado y la posición all-time son los del último mes (son acumulados, así que el
 * cierre del bucket ES su valor), y del chart semanal queda la mejor posición.
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
      if (m.chartRank != null) b.chartRank = Math.min(b.chartRank ?? Infinity, m.chartRank);
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
