// Trayectoria en chart (peak, weeks on chart, racha) resuelta por trozos.
//
// El coste de estas stats es un único ROW_NUMBER() OVER (PARTITION BY period)
// sobre todo el historial del usuario: ~1,4 s con 350 k plays. Como el ranking
// está particionado POR PERIODO, trocear ese escaneo en ventanas de fecha
// disjuntas no repite trabajo — ningún periodo se rankea dos veces — y además
// cada ventana sí puede usar el índice (user_id, played_at), así que el coste
// baja proporcionalmente al tramo escaneado.
//
// Recorriendo los trozos del más reciente al más antiguo, una entidad queda
// cerrada en cuanto hemos escaneado más atrás de su primer play: la mayoría de
// entradas del chart se resuelven en el primer trozo, lo que permite emitirlas
// en streaming en vez de esperar al escaneo completo.
import type { Granularity, WeekStartOption, ChartPeak } from '@sis/shared';
import { CHART_SIZE } from '../constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// periodExpr() desplaza played_at estos días antes de calcular %W. El año del
// label lo decide la fecha YA desplazada, así que el corte entre los labels de
// un año y los del anterior cae exactamente en 1-ene + shift, y nunca parte un
// periodo por la mitad. Espejo exacto de periodExpr(): cualquier weekStart que
// no sea monday/sunday cae en la rama de -4 días.
const WEEK_SHIFT_DAYS: Record<WeekStartOption, number> = { monday: 0, sunday: 1, friday: 4 };

/** Año de un label de periodo (YYYY, YYYY-MM, YYYY-Www comparten prefijo). */
export function periodYear(period: string): number {
  return parseInt(period.slice(0, 4), 10);
}

/** Ventana de fechas que cubre exactamente los labels de un año. */
export interface PeakSlice {
  year: number;
  startAt: string;
  endAt: string;
}

function yearBoundary(year: number, shiftDays: number): string {
  return new Date(Date.UTC(year, 0, 1) + shiftDays * DAY_MS).toISOString();
}

/** Trozos de un año de labels cada uno, del más reciente al más antiguo. */
export function peakSlices(oldestYear: number, newestYear: number, granularity: Granularity, weekStart: WeekStartOption): PeakSlice[] {
  const shift = granularity === 'week' ? WEEK_SHIFT_DAYS[weekStart] : 0;
  const slices: PeakSlice[] = [];
  for (let year = newestYear; year >= oldestYear; year--) {
    slices.push({ year, startAt: yearBoundary(year, shift), endAt: yearBoundary(year + 1, shift) });
  }
  return slices;
}

export interface RankSliceRow {
  period: string;
  entityId: string;
  rank: number;
}

/** Filas + labels de periodo de un trozo (ver getChartRankSlice). */
export interface ChartRankSlice {
  rows: RankSliceRow[];
  periods: string[];
}

/**
 * Acumula trozos de ranking (del más reciente al más antiguo) y va cerrando las
 * entidades cuyo historial ya está cubierto por completo.
 */
export class ChartPeaksAccumulator {
  private readonly pending: Set<string>;
  private readonly firstYear = new Map<string, number>();
  private readonly ranks = new Map<string, Map<string, number>>();
  // labels con datos, de más reciente a más antiguo
  private readonly labelsDesc: string[] = [];

  constructor(
    entityIds: string[],
    firstPeriods: Record<string, string>,
    private readonly currentPeriod: string,
    private readonly previousPeriod: string | null,
  ) {
    this.pending = new Set(entityIds);
    for (const id of entityIds) {
      // sin plays hasta currentPeriod: se cierra en el primer trozo con los defaults
      this.firstYear.set(id, periodYear(firstPeriods[id] ?? currentPeriod));
    }
  }

  get done(): boolean {
    return this.pending.size === 0;
  }

  /** Los trozos llegan en orden descendente, así que las labels se concatenan ya ordenadas. */
  addSlice(slice: ChartRankSlice): void {
    for (const period of [...slice.periods].sort().reverse()) this.labelsDesc.push(period);
    for (const row of slice.rows) {
      let byPeriod = this.ranks.get(row.entityId);
      if (!byPeriod) {
        byPeriod = new Map();
        this.ranks.set(row.entityId, byPeriod);
      }
      byPeriod.set(row.period, row.rank);
    }
  }

  /** Entidades cerrables tras escanear hasta `sliceYear`. `isLast` fuerza el cierre de las que queden. */
  drain(sliceYear: number, isLast: boolean): ChartPeak[] {
    const closed: ChartPeak[] = [];
    for (const id of this.pending) {
      if (!isLast && (this.firstYear.get(id) ?? 0) < sliceYear) continue;
      const peak = this.finalize(id, isLast);
      if (!peak) continue;
      closed.push(peak);
      this.pending.delete(id);
    }
    return closed;
  }

  private finalize(id: string, isLast: boolean): ChartPeak | null {
    const byPeriod = this.ranks.get(id);
    if (!byPeriod || byPeriod.size === 0) {
      return { entityId: id, peakRank: CHART_SIZE, peakPeriod: this.currentPeriod, peakPeriods: [], timesAtPeak: 0, weeksOnChart: 0, consecutiveWeeks: 0, isReentry: false };
    }

    const peakRank = Math.min(...byPeriod.values());
    // orden ascendente: peakPeriod es el primer periodo en el que se alcanzó el peak
    const peakPeriods = [...byPeriod.keys()].sort().filter(p => byPeriod.get(p) === peakRank);

    // racha hacia atrás desde el periodo actual, parando en el primer hueco.
    // sólo cuentan periodos con datos (los que aparecen en labelsDesc): una
    // semana sin ni un play no rompe la racha
    let consecutive = 0;
    if (this.labelsDesc[0] === this.currentPeriod) {
      while (consecutive < this.labelsDesc.length && byPeriod.has(this.labelsDesc[consecutive])) consecutive++;
      // agotó las labels conocidas sin encontrar hueco: la racha puede seguir más atrás
      if (consecutive === this.labelsDesc.length && !isLast) return null;
    }

    const weeksOnChart = byPeriod.size;
    return {
      entityId: id,
      peakRank,
      peakPeriod: peakPeriods[0],
      peakPeriods,
      timesAtPeak: peakPeriods.length,
      weeksOnChart,
      consecutiveWeeks: consecutive,
      // reentrada: estuvo en chart antes pero no en el periodo inmediatamente anterior
      isReentry: this.previousPeriod !== null && !byPeriod.has(this.previousPeriod) && weeksOnChart > 1,
    };
  }
}
