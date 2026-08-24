import { Hono } from 'hono';
import type { AppVariables } from '../../app.js';
import type { WeekStartOption, EntityType, RankingMetric } from '@sis/shared';
import type { TimeRange } from '../../constants.js';
import { DEFAULT_PAGE_LIMIT, DEFAULT_TIME_RANGE, isTimeRange } from '../../constants.js';
import { getRangeStart, getPreviousPeriodRange } from '../../db/queries/index.js';
import type { Sort } from '../../db/queries/index.js';

export type WeekStart = WeekStartOption;
export type { Sort };

/** Hono factory tipado con AppVariables. Usar en cada sub-router de /stats. */
export const statsRouter = () => new Hono<{ Variables: AppVariables }>();

/** Convertir param plural ('tracks') a EntityType singular ('track') */
export function toEntityType(plural: string): EntityType {
  if (plural === 'tracks') return 'track';
  if (plural === 'albums') return 'album';
  return 'artist';
}

export function parseWeekStart(c: any): WeekStart {
  const ws = c.req.query('weekStart');
  return ws === 'sunday' ? 'sunday' : ws === 'friday' ? 'friday' : 'monday';
}

export function parseSort(c: any): RankingMetric {
  return c.req.query('sort') === 'plays' ? 'plays' : 'time';
}

// records: unicidad de registros. por defecto true (un registro por entidad);
// 'false' permite que la misma entidad aparezca varias veces (peak week / longest run)
export function parseRecordsUnique(c: any): boolean {
  return c.req.query('unique') !== 'false';
}

export function periodMatchesGranularity(period: string, granularity: 'week' | 'month' | 'year'): boolean {
  if (granularity === 'year') return /^\d{4}$/.test(period);
  if (granularity === 'month') return /^\d{4}-\d{2}$/.test(period);
  return /^\d{4}-W\d{2}$/.test(period);
}

export function parseParams(c: any) {
  const limit = Math.min(parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT)), 200);
  const sortRaw = c.req.query('sort');
  const sort = (sortRaw === 'plays' ? 'plays' : sortRaw === 'natural' ? 'natural' : 'time') as Sort;

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  if (startDate && endDate) {
    const rangeStart = startDate + 'T00:00:00.000Z';
    const rangeEnd = endDate + 'T23:59:59.999Z';
    const customDays = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    return { range: 'custom' as const, limit, rangeStart, rangeEnd, sort, customDays };
  }

  // sin startDate/endDate, un `range=custom` (o cualquier valor no reconocido)
  // no describe ninguna ventana: se cae al rango por defecto en vez de devolver
  // en la respuesta un `range` que no corresponde a los datos servidos.
  const rangeRaw = c.req.query('range') || DEFAULT_TIME_RANGE;
  const range: TimeRange = isTimeRange(rangeRaw) ? rangeRaw : DEFAULT_TIME_RANGE;
  const rangeStart = getRangeStart(range);
  return { range, limit, rangeStart, rangeEnd: null as string | null, sort, customDays: undefined as number | undefined };
}

// helper: calcular rank changes entre periodo actual y anterior
export function buildRankChangeMap(prevRows: { entity_id: string }[]) {
  const map = new Map<string, number>();
  prevRows.forEach((r, i) => map.set(r.entity_id, i + 1));
  return map;
}

export function rankChangeFields(prev: ReturnType<typeof getPreviousPeriodRange>, prevRankMap: Map<string, number>, entityId: string, currentRank: number) {
  const previousRank = prevRankMap.get(entityId) ?? null;
  return {
    rankChange: prev === null ? null : previousRank === null ? null : previousRank - currentRank,
    previousRank,
    isNew: prev !== null && previousRank === null,
  };
}
