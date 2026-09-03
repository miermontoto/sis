import { getLocale } from '$lib/api';

// formatear duración en ms a minutos con separador de miles
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${formatNumber(minutes)} min`;
}

// formatear duración de track individual: "Xm Ys"
export function formatTrackLength(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

// formatear tiempo de reproducción estilo reloj: "m:ss" (o "h:mm:ss")
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const mmss = `${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

// formatear duración total en horas con decimal
export function formatHours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export type DurationUnit = 'hours' | 'minutes' | 'days' | 'weeks' | 'months' | 'years';
export const DURATION_UNITS: DurationUnit[] = ['hours', 'minutes', 'days', 'weeks', 'months', 'years'];

export function formatDurationAs(ms: number, unit: DurationUnit): string {
  switch (unit) {
    case 'minutes': return `${formatNumber(Math.round(ms / 60_000))} min`;
    case 'hours': return `${(ms / 3_600_000).toFixed(1)}h`;
    case 'days': return `${(ms / 86_400_000).toFixed(1)}d`;
    case 'weeks': return `${(ms / 604_800_000).toFixed(1)}w`;
    case 'months': return `${(ms / 2_629_746_000).toFixed(1)}mo`;
    case 'years': return `${(ms / 31_556_952_000).toFixed(2)}y`;
  }
}

// formatear número con separador de miles
export function formatNumber(n: number): string {
  return n.toLocaleString(getLocale());
}

// formatear fecha relativa: "5m ago", "2h ago", "yesterday"
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return formatShortDate(dateStr);
}

// formatear fecha completa con hora y zona horaria
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z');
  return d.toLocaleString(getLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

// "Jan 5" o "Jan 5, 2024" si no es el año actual
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(getLocale(), opts);
}

// fecha de CALENDARIO (YYYY-MM-DD sin hora: la de un concierto, por ejemplo).
// Se formatea en UTC a propósito: 'new Date("2024-07-12")' es medianoche UTC y
// pintarla en horario local adelantaría el día en cualquier zona al oeste de
// Greenwich — un bolo del 12 se vería como del 11. El año aparece sólo cuando no
// es el actual, igual que en formatShortDate.
export function formatCalendarDate(dateStr: string): string {
  const date = new Date(dateStr);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (date.getUTCFullYear() !== new Date().getUTCFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(getLocale(), opts);
}

// combina fecha + hora para items del historial: sólo hora si es dentro de las
// últimas 24h, "Yesterday, 9:12" si ya pasaron >24h pero cae en el día anterior,
// "Jan 5, 15:45" (mismo año) o "Jan 5, 2024, 15:45" (otro año) para el resto.
export function formatHistoryStamp(dateStr: string): string {
  const locale = getLocale();
  const date = new Date(dateStr);
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const within24h = now.getTime() - date.getTime() < 24 * 3_600_000;
  if (within24h) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isYesterday) return `Yesterday, ${time}`;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${date.toLocaleDateString(locale, opts)}, ${time}`;
}

export function formatSmartDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
  }
  return formatShortDate(dateStr);
}

// true si la fecha cae en el día local actual (mismo criterio que formatSmartDate)
export function isToday(dateStr: string): boolean {
  return new Date(dateStr).toDateString() === new Date().toDateString();
}

// "January 2024"
export function formatMonthYear(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' });
}

// "Friday, January 5, 2024"
export function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getLocale(), {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

// "Jan 5" con timeZone explícita (para charts UTC)
export function formatShortDateUTC(date: Date): string {
  return date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// YYYY-MM-DD en timezone local (evita off-by-one al filtrar por fecha)
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// nombres de días de la semana localizados [Sun, Mon, ..., Sat]
export function getLocalizedDayNames(): string[] {
  const locale = getLocale();
  const base = new Date(2017, 0, 1); // domingo
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString(locale, { weekday: 'short' });
  });
}

export function getLocalizedMonthNames(): string[] {
  const locale = getLocale();
  return Array.from({ length: 12 }, (_, i) =>
    new Date(2017, i, 1).toLocaleDateString(locale, { month: 'short' })
  );
}

// variante larga de formatCalendarDate ("Saturday, October 18, 2025"), también
// en UTC: la fecha de un concierto es de calendario, no un instante
export function formatCalendarDateLong(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getLocale(), {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

// "Oct 18" sin año, para listas ya agrupadas por año (repetirlo en cada fila sobra)
export function formatCalendarDayMonth(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// día y mes por separado ("18", "Oct"), para pintar la fecha como ficha en el
// hueco de la carátula de una fila
export function calendarDayMonth(dateStr: string): { day: string; month: string } {
  const date = new Date(dateStr);
  return {
    day: date.toLocaleDateString(getLocale(), { day: 'numeric', timeZone: 'UTC' }),
    month: date.toLocaleDateString(getLocale(), { month: 'short', timeZone: 'UTC' }),
  };
}
