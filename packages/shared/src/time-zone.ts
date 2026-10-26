// zona horaria IANA del calendario de un usuario. los plays se guardan en UTC y los
// periodos (charts, reports, semanas de los records) se cortan en SU medianoche: con
// los límites en UTC, al este de Greenwich el último play de septiembre salía como
// "1 oct". el desfase cambia con el horario de verano, así que un número de minutos no
// basta para un año entero; todo sale de Intl (icu de node y del navegador)

export const UTC_TIME_ZONE = 'UTC';

const DAY_MS = 86_400_000;
const SECOND_MS = 1000;
// paso del muestreo de cambios de desfase: ninguna zona cambia dos veces en una semana
const SEGMENT_SAMPLE_MS = 7 * DAY_MS;

// un DateTimeFormat cuesta mucho más de crear que de usar: uno por zona
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Zona canónica, o UTC si viene vacía o no existe (un ajuste roto no puede tumbar los charts). */
export function resolveTimeZone(value: string | null | undefined): string {
  if (!value) return UTC_TIME_ZONE;
  try { return formatter(value).resolvedOptions().timeZone; }
  catch { return UTC_TIME_ZONE; }
}

/** Desfase de la zona en un instante: hora de pared − UTC, en ms. */
export function zoneOffsetMs(timeZone: string, t: number): number {
  if (timeZone === UTC_TIME_ZONE) return 0;
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(t)).map(part => [part.type, Number(part.value)]));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(t / SECOND_MS) * SECOND_MS;
}

/** Hora de pared de un instante, codificada como instante UTC (la que leen los getUTC*). */
export const toWallTime = (timeZone: string, t: number) => t + zoneOffsetMs(timeZone, t);

// primer instante (al segundo) que cumple `pred`, sabiendo que `lo` no lo cumple y `hi` sí
function firstInstant(lo: number, hi: number, pred: (t: number) => boolean): number {
  let a = Math.floor(lo / SECOND_MS) * SECOND_MS;
  let b = Math.ceil(hi / SECOND_MS) * SECOND_MS;
  while (b - a > SECOND_MS) {
    const mid = Math.floor((a + b) / 2 / SECOND_MS) * SECOND_MS;
    if (pred(mid)) b = mid; else a = mid;
  }
  return b;
}

/** Primer instante con esa hora de pared. En el retraso de otoño la hora existe dos
 *  veces y vale la primera; en el adelanto no existe y vale el instante del salto, que
 *  es donde empieza de verdad lo que viene detrás. */
export function fromWallTime(timeZone: string, wall: number): number {
  if (timeZone === UTC_TIME_ZONE) return wall;
  // a un día de distancia no hay dos cambios de hora: esos dos desfases son los únicos posibles
  const [early, late] = [wall - zoneOffsetMs(timeZone, wall + DAY_MS), wall - zoneOffsetMs(timeZone, wall - DAY_MS)].sort((a, b) => a - b);
  const exact = [early, late].find(t => toWallTime(timeZone, t) === wall);
  return exact ?? firstInstant(early, late, t => toWallTime(timeZone, t) >= wall);
}

export interface ZoneSegment {
  /** instante desde el que rige el desfase */
  from: number;
  offsetMs: number;
}

/** Tramos de desfase constante de la zona entre dos instantes, del más antiguo al más
 *  reciente. El primero rige también antes de `start`. */
export function zoneSegments(timeZone: string, start: number, end: number): ZoneSegment[] {
  const segments: ZoneSegment[] = [{ from: start, offsetMs: zoneOffsetMs(timeZone, start) }];
  if (timeZone === UTC_TIME_ZONE) return segments;
  for (let prev = start; prev < end;) {
    const next = Math.min(prev + SEGMENT_SAMPLE_MS, end);
    const current = segments[segments.length - 1].offsetMs;
    const offsetMs = zoneOffsetMs(timeZone, next);
    if (offsetMs !== current) segments.push({ from: firstInstant(prev, next, t => zoneOffsetMs(timeZone, t) !== current), offsetMs });
    prev = next;
  }
  return segments;
}
