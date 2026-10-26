// modelo de periodo compartido con los charts: la etiqueta que sqlite asigna a un
// play con periodExpr() (YYYY-Www / YYYY-MM / YYYY) y sus límites [start, end).
// reproduce la regla %W de sqlite: semanas que empiezan en lunes, numeradas
// desde la primera que empieza dentro del año (un 1 de enero en lunes ya es la
// W01); los días anteriores son la W00, y la última semana se parte en nochevieja
// (la 2025-W52 acaba el 31 de dic y el 1 de enero ya es 2026-W00). weekStart
// desplaza el calendario antes de etiquetar (sunday: -1 día, friday: -4), igual
// que hace periodExpr con el modificador de strftime, así que una semana "friday"
// va de viernes a jueves. las etiquetas son de calendario (fechas de pared) y la
// zona del usuario dice dónde cae su medianoche, como periodExpr con localPlayedAt.
// sin zona es UTC, que también sirve para cuentas de calendario en el cliente
// (rangos legibles, buckets por día): las fechas de pared codificadas en UTC
import type { Granularity, WeekStartOption } from './settings.js';
import { UTC_TIME_ZONE, toWallTime, fromWallTime } from './time-zone.js';

// días que periodExpr resta antes de strftime('%W') para mover el corte de semana
export const WEEK_START_SHIFT_DAYS: Record<WeekStartOption, number> = { monday: 0, sunday: 1, friday: 4 };

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const MONTHS = 12;

const PERIOD_PATTERN: Record<Granularity, RegExp> = {
  week: /^(\d{4})-W(\d{2})$/,
  month: /^(\d{4})-(\d{2})$/,
  year: /^(\d{4})$/,
};

export interface PeriodBounds {
  /** ISO UTC, inclusivo */
  start: string;
  /** ISO UTC, exclusivo */
  end: string;
}

/** Calendario con el que se cortan los periodos de un usuario: corte de semana + zona IANA. */
export interface PeriodCalendar {
  weekStart: WeekStartOption;
  timeZone: string;
}

export function isGranularity(value: string): value is Granularity {
  return value === 'week' || value === 'month' || value === 'year';
}

export function isPeriodKey(period: string, granularity: Granularity): boolean {
  return PERIOD_PATTERN[granularity].test(period);
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const utcDay = (year: number, month: number, day: number) => Date.UTC(year, month, day);
// límites de pared → instantes de la zona
const toBounds = (start: number, end: number, timeZone: string): PeriodBounds => ({
  start: new Date(fromWallTime(timeZone, start)).toISOString(),
  end: new Date(fromWallTime(timeZone, end)).toISOString(),
});

// día de la semana con lunes = 0, como el %W de sqlite
const mondayBasedDow = (t: number) => (new Date(t).getUTCDay() + 6) % 7;

// número %W de un instante ya desplazado: floor((díaDelAño + 7 - dow) / 7)
function sqliteWeek(t: number): { year: number; week: number } {
  const year = new Date(t).getUTCFullYear();
  const dayOfYear = Math.floor((t - utcDay(year, 0, 1)) / DAY_MS);
  return { year, week: Math.floor((dayOfYear + WEEK_DAYS - mondayBasedDow(t)) / WEEK_DAYS) };
}

/** Etiqueta de periodo de un instante en la zona, idéntica a la de periodExpr() del servidor. */
export function periodForDate(date: Date, granularity: Granularity, weekStart: WeekStartOption, timeZone = UTC_TIME_ZONE): string {
  const wall = toWallTime(timeZone, date.getTime());
  const local = new Date(wall);
  if (granularity === 'year') return String(local.getUTCFullYear());
  if (granularity === 'month') return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}`;
  const { year, week } = sqliteWeek(wall - WEEK_START_SHIFT_DAYS[weekStart] * DAY_MS);
  return `${year}-W${pad2(week)}`;
}

/** Límites [start, end) de un periodo: sus medianoches en la zona. null si la etiqueta
 *  no existe: una W53 en un año que acaba en W52, la W00 de un año que empieza en
 *  lunes, un mes 13. */
export function periodBounds(period: string, granularity: Granularity, weekStart: WeekStartOption, timeZone = UTC_TIME_ZONE): PeriodBounds | null {
  const match = PERIOD_PATTERN[granularity].exec(period);
  if (!match) return null;
  const year = Number(match[1]);

  if (granularity === 'year') return toBounds(utcDay(year, 0, 1), utcDay(year + 1, 0, 1), timeZone);
  if (granularity === 'month') {
    const month = Number(match[2]);
    if (month < 1 || month > MONTHS) return null;
    return toBounds(utcDay(year, month - 1, 1), utcDay(year, month, 1), timeZone);
  }

  // semana: se calcula en el calendario desplazado y luego se deshace el desplazamiento
  const week = Number(match[2]);
  const jan1 = utcDay(year, 0, 1);
  const nextJan1 = utcDay(year + 1, 0, 1);
  // primer lunes del año (el propio 1 de enero si cae en lunes)
  const firstMonday = jan1 + ((WEEK_DAYS - mondayBasedDow(jan1)) % WEEK_DAYS) * DAY_MS;
  const start = week === 0 ? jan1 : firstMonday + (week - 1) * WEEK_DAYS * DAY_MS;
  const end = Math.min(week === 0 ? firstMonday : start + WEEK_DAYS * DAY_MS, nextJan1);
  if (start >= end) return null;
  const shift = WEEK_START_SHIFT_DAYS[weekStart] * DAY_MS;
  return toBounds(start + shift, end + shift, timeZone);
}

/** Periodo anterior (-1) o siguiente (+1), por límites y no por aritmética de
 *  etiquetas: restar 1 a la W00 no dice si el año anterior acabó en W52 o W53. La
 *  secuencia de etiquetas es de calendario, así que no depende de la zona. */
export function adjacentPeriod(period: string, granularity: Granularity, weekStart: WeekStartOption, direction: -1 | 1): string | null {
  const bounds = periodBounds(period, granularity, weekStart);
  if (!bounds) return null;
  const t = direction < 0 ? Date.parse(bounds.start) - DAY_MS : Date.parse(bounds.end);
  return periodForDate(new Date(t), granularity, weekStart);
}

/** Un periodo está cerrado cuando es anterior al que contiene `now` en la zona. Las
 *  etiquetas van year-first y zero-padded, así que el orden lexicográfico es el cronológico. */
export function isClosedPeriod(period: string, granularity: Granularity, weekStart: WeekStartOption, timeZone = UTC_TIME_ZONE, now = new Date()): boolean {
  return period < periodForDate(now, granularity, weekStart, timeZone);
}
