// utilidades puras del selector de fecha (DatePicker.svelte). trabajan con
// componentes de calendario (año, mes, día) y con los strings que producían los
// inputs nativos ('YYYY-MM-DD' y 'YYYY-MM-DDTHH:mm' en hora local), nunca con
// instantes: la fecha que el usuario elige es de calendario y pasarla por
// Date.toISOString() la desplazaría un día al oeste de Greenwich. no importa
// $lib/api para poder testearse en node: el locale llega por parámetro.

/** 0 = domingo … 6 = sábado, como Date.getDay() */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface GridCell {
  key: string;
  day: number;
  inMonth: boolean;
}

const DAYS_PER_WEEK = 7;
const GRID_ROWS = 6;
export const GRID_CELLS = GRID_ROWS * DAYS_PER_WEEK;
const MONTHS_PER_YEAR = 12;
const HOURS_PER_DAY = 24;
const HOURS_PER_HALF_DAY = 12;
const MINUTES_PER_HOUR = 60;
// Intl.Locale#getWeekInfo numera los días 1 = lunes … 7 = domingo (ISO)
const ISO_SUNDAY = 7;
// mediodía: la aritmética de días se hace a esa hora para que un cambio de
// horario de verano a medianoche (Santiago, Teherán) no mueva el día
const NOON = 12;
const MONDAY: Weekday = 1;
const SUNDAY: Weekday = 0;
const SATURDAY: Weekday = 6;

// regiones cuya semana empieza en domingo o sábado según CLDR (el resto, lunes).
// es el fallback cuando el navegador no expone Intl.Locale#getWeekInfo (firefox)
const SUNDAY_FIRST_REGIONS = new Set([
  'AG', 'AS', 'AU', 'BD', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CN', 'CO', 'DM', 'DO', 'ET',
  'GT', 'GU', 'HK', 'HN', 'ID', 'IL', 'IN', 'JM', 'JP', 'KE', 'KH', 'KR', 'LA', 'MH', 'MM',
  'MO', 'MT', 'MX', 'MZ', 'NI', 'NP', 'PA', 'PE', 'PH', 'PK', 'PR', 'PT', 'PY', 'SA', 'SG',
  'SV', 'TH', 'TT', 'TW', 'UM', 'US', 'VE', 'VI', 'WS', 'YE', 'ZA', 'ZW',
]);
const SATURDAY_FIRST_REGIONS = new Set([
  'AE', 'AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY',
]);

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' a partir de componentes (mes 0-11) */
export const dateKey = (year: number, month: number, day: number) =>
  `${year}-${pad2(month + 1)}-${pad2(day)}`;

/** componentes de un 'YYYY-MM-DD' (mes 0-11) */
export function keyParts(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

/** primer día de la semana por región CLDR (fallback sin getWeekInfo) */
export function firstDayForRegion(region: string): Weekday {
  if (SUNDAY_FIRST_REGIONS.has(region)) return SUNDAY;
  if (SATURDAY_FIRST_REGIONS.has(region)) return SATURDAY;
  return MONDAY;
}

/** primer día de la semana del locale: getWeekInfo si existe, si no por región */
export function firstDayOfWeek(locale: string): Weekday {
  let tag: Intl.Locale;
  try {
    tag = new Intl.Locale(locale);
  } catch {
    return MONDAY;
  }
  // getWeekInfo() en chrome/safari/node ≥ 21; weekInfo (getter) en versiones anteriores
  const withWeek = tag as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
  const info = withWeek.getWeekInfo?.() ?? withWeek.weekInfo;
  if (info?.firstDay) return (info.firstDay % ISO_SUNDAY) as Weekday;
  return firstDayForRegion(tag.maximize().region ?? '');
}

/** rejilla fija de 6 semanas del mes (mes 0-11), arrancando en firstDay */
export function monthGrid(year: number, month: number, firstDay: Weekday): GridCell[] {
  const lead = (new Date(year, month, 1, NOON).getDay() - firstDay + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return Array.from({ length: GRID_CELLS }, (_, i) => {
    const d = new Date(year, month, 1 - lead + i, NOON);
    return { key: dateKey(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === month };
  });
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * MONTHS_PER_YEAR + month + delta;
  return { year: Math.floor(total / MONTHS_PER_YEAR), month: ((total % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR };
}

/** nombres cortos de los días en el orden de la semana del locale */
export function weekdayLabels(locale: string, firstDay: Weekday): string[] {
  const sunday = new Date(2017, 0, 1, NOON);
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + ((firstDay + i) % DAYS_PER_WEEK));
    return d.toLocaleDateString(locale, { weekday: 'short' });
  });
}

/** "septiembre de 2026" / "September 2026" */
export function monthLabel(year: number, month: number, locale: string): string {
  return new Date(year, month, 1, NOON).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

export function uses12HourClock(locale: string): boolean {
  const opts = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
  return opts.hour12 ?? (opts.hourCycle === 'h12' || opts.hourCycle === 'h11');
}

/** separa 'YYYY-MM-DD[THH:mm]' en sus dos mitades ('' si faltan) */
export function splitValue(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.split('T');
  return { date, time };
}

export function joinValue(date: string, time: string, withTime: boolean): string {
  if (!date) return '';
  return withTime ? `${date}T${time || '00:00'}` : date;
}

/** hora de reloj 0-23 y minutos de un 'HH:mm' ('' → 0:00) */
export function timeParts(time: string): { hours: number; minutes: number } {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

export function clampTime(hours: number, minutes: number): string {
  const h = Math.min(HOURS_PER_DAY - 1, Math.max(0, Math.trunc(hours) || 0));
  const m = Math.min(MINUTES_PER_HOUR - 1, Math.max(0, Math.trunc(minutes) || 0));
  return `${pad2(h)}:${pad2(m)}`;
}

/** hora de reloj de 12 → 24 según el toggle am/pm (12 am = 0, 12 pm = 12) */
export function to24Hour(displayHour: number, pm: boolean): number {
  return (displayHour % HOURS_PER_HALF_DAY) + (pm ? HOURS_PER_HALF_DAY : 0);
}

export function to12Hour(hours: number): { hour: number; pm: boolean } {
  return { hour: hours % HOURS_PER_HALF_DAY || HOURS_PER_HALF_DAY, pm: hours >= HOURS_PER_HALF_DAY };
}

/** 'YYYY-MM-DD' de hoy en hora local */
export function todayKey(now = new Date()): string {
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 'YYYY-MM-DDTHH:mm' de ahora en hora local, el valor inicial de un datetime */
export function nowLocalValue(now = new Date()): string {
  return `${todayKey(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/** etiqueta del valor en el locale de la app: "11 sept 2026" / "Sep 11, 2026, 21:30" */
export function formatPickerValue(value: string, locale: string, withTime: boolean): string {
  const { date, time } = splitValue(value);
  if (!date) return '';
  const { year, month, day } = keyParts(date);
  const { hours, minutes } = timeParts(time);
  const d = new Date(year, month, day, hours, minutes);
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString(locale, opts);
}
