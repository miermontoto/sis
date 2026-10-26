import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { periodForDate, periodBounds, adjacentPeriod, isClosedPeriod, isPeriodKey, weekShiftModifier, UTC_TIME_ZONE, zoneOffsetMs, zoneSegments, fromWallTime } from '@sis/shared';
import type { Granularity, WeekStartOption } from '@sis/shared';

// la verdad es el propio strftime de sqlite con el mismo modificador que aplica
// periodExpr() en el servidor: una etiqueta calculada a mano que no coincida con
// la del chart abriría un report sobre plays distintos de los que rankea el chart
const db = new DatabaseSync(':memory:');
const stmt = db.prepare('SELECT strftime(?, ?, ?) AS p');

const FORMATS: Record<Granularity, string> = { week: '%Y-W%W', month: '%Y-%m', year: '%Y' };
const WEEK_STARTS: WeekStartOption[] = ['monday', 'sunday', 'friday'];
const GRANULARITIES: Granularity[] = ['week', 'month', 'year'];
const DAY_MS = 86_400_000;

function sqliteLabel(iso: string, gran: Granularity, ws: WeekStartOption): string {
  const modifier = gran === 'week' ? weekShiftModifier(ws) : '+0 days';
  return stmt.get(FORMATS[gran], iso, modifier)!.p as string;
}

// la etiqueta que da periodExpr en una zona: el desfase del instante como modificador
// (lo que elige el CASE de localPlayedAt) y luego el corte de semana
const zonedStmt = db.prepare('SELECT strftime(?, ?, ?, ?) AS p');
function sqliteZonedLabel(iso: string, gran: Granularity, ws: WeekStartOption, timeZone: string): string {
  const offsetMinutes = zoneOffsetMs(timeZone, Date.parse(iso)) / 60_000;
  const shift = gran === 'week' ? weekShiftModifier(ws) : '+0 days';
  return zonedStmt.get(FORMATS[gran], iso, `${offsetMinutes < 0 ? '-' : '+'}${Math.abs(offsetMinutes)} minutes`, shift)!.p as string;
}

// una década de días: cubre años que empiezan en lunes (2018, 2024), años con W53
// (2024) y bisiestos
const FIRST_DAY = Date.UTC(2017, 11, 25);
const LAST_DAY = Date.UTC(2027, 0, 10);
const days: number[] = [];
for (let t = FIRST_DAY; t <= LAST_DAY; t += DAY_MS) days.push(t);

describe('periodForDate', () => {
  for (const gran of GRANULARITIES) {
    for (const ws of WEEK_STARTS) {
      it(`coincide con strftime para ${gran}/${ws} en todo instante`, () => {
        for (const t of days) {
          // los tres instantes del día que pueden cambiar de etiqueta
          for (const offset of [0, 12 * 3_600_000, DAY_MS - 1]) {
            const iso = new Date(t + offset).toISOString();
            expect(periodForDate(new Date(iso), gran, ws), iso).toBe(sqliteLabel(iso, gran, ws));
          }
        }
      });
    }
  }
});

describe('periodBounds', () => {
  for (const gran of GRANULARITIES) {
    for (const ws of WEEK_STARTS) {
      it(`cada etiqueta cubre exactamente sus días para ${gran}/${ws}`, () => {
        // primer y último día (00:00 UTC) de cada etiqueta según sqlite
        const span = new Map<string, { first: number; last: number }>();
        for (const t of days) {
          const label = sqliteLabel(new Date(t).toISOString(), gran, ws);
          const s = span.get(label);
          if (!s) span.set(label, { first: t, last: t });
          else s.last = t;
        }
        const labels = [...span.keys()];
        // los extremos del muestreo están truncados: solo se comprueban etiquetas enteras
        for (const label of labels.slice(1, -1)) {
          const { first, last } = span.get(label)!;
          expect(isPeriodKey(label, gran)).toBe(true);
          expect(periodBounds(label, gran, ws), label).toEqual({
            start: new Date(first).toISOString(),
            end: new Date(last + DAY_MS).toISOString(),
          });
        }
        // navegación: la cadena de siguientes/anteriores recorre la secuencia real
        for (let i = 1; i < labels.length - 2; i++) {
          expect(adjacentPeriod(labels[i], gran, ws, 1), labels[i]).toBe(labels[i + 1]);
          expect(adjacentPeriod(labels[i + 1], gran, ws, -1), labels[i + 1]).toBe(labels[i]);
        }
      });
    }
  }

  it('devuelve null para etiquetas que no existen', () => {
    // 2024 empieza en lunes: no hay W00. 2025 acaba en miércoles: no hay W53
    expect(periodBounds('2024-W00', 'week', 'monday')).toBeNull();
    expect(periodBounds('2025-W53', 'week', 'monday')).toBeNull();
    expect(periodBounds('2024-W53', 'week', 'monday')).not.toBeNull();
    expect(periodBounds('2026-13', 'month', 'monday')).toBeNull();
    expect(periodBounds('2026-W1', 'week', 'monday')).toBeNull();
    expect(periodBounds('2026', 'week', 'monday')).toBeNull();
  });

  it('la semana friday va de viernes a jueves', () => {
    const b = periodBounds('2026-W35', 'week', 'friday')!;
    expect(b.start).toBe('2026-09-04T00:00:00.000Z');
    expect(b.end).toBe('2026-09-11T00:00:00.000Z');
    expect(new Date(b.start).getUTCDay()).toBe(5);
  });

  // cada semana entera empieza el día del ajuste (0 = domingo, como getUTCDay). las
  // semanas recortadas por nochevieja empiezan el 1 de enero y se saltan
  const FIRST_WEEKDAY: Record<WeekStartOption, number> = { monday: 1, sunday: 0, friday: 5 };
  for (const ws of WEEK_STARTS) {
    it(`toda semana ${ws} completa empieza en su día`, () => {
      for (const t of days) {
        const label = periodForDate(new Date(t), 'week', ws);
        const b = periodBounds(label, 'week', ws)!;
        if (Date.parse(b.end) - Date.parse(b.start) < 7 * DAY_MS) continue;
        expect(new Date(b.start).getUTCDay(), label).toBe(FIRST_WEEKDAY[ws]);
      }
    });
  }
});

describe('isClosedPeriod', () => {
  const now = new Date('2026-09-06T10:00:00.000Z');
  it('el periodo en curso está abierto y el anterior cerrado', () => {
    expect(isClosedPeriod('2026-W35', 'week', 'friday', UTC_TIME_ZONE, now)).toBe(false);
    expect(isClosedPeriod('2026-W34', 'week', 'friday', UTC_TIME_ZONE, now)).toBe(true);
    expect(isClosedPeriod('2026-09', 'month', 'friday', UTC_TIME_ZONE, now)).toBe(false);
    expect(isClosedPeriod('2026-08', 'month', 'friday', UTC_TIME_ZONE, now)).toBe(true);
    expect(isClosedPeriod('2026', 'year', 'friday', UTC_TIME_ZONE, now)).toBe(false);
    expect(isClosedPeriod('2025', 'year', 'friday', UTC_TIME_ZONE, now)).toBe(true);
  });
  it('un periodo futuro no está cerrado', () => {
    expect(isClosedPeriod('2027-W01', 'week', 'friday', UTC_TIME_ZONE, now)).toBe(false);
  });
  it('el mes cierra en la medianoche de la zona, no en la de UTC', () => {
    // 1 de octubre a las 00:30 en Madrid: allí septiembre ya cerró, en UTC aún no
    const madridMidnight = new Date('2026-09-30T22:30:00.000Z');
    expect(isClosedPeriod('2026-09', 'month', 'friday', 'Europe/Madrid', madridMidnight)).toBe(true);
    expect(isClosedPeriod('2026-09', 'month', 'friday', UTC_TIME_ZONE, madridMidnight)).toBe(false);
  });
});

// zonas con horario de verano, desfases de media hora y de 45 minutos, los dos
// extremos del día y una (Santiago) cuyo cambio de hora cae justo a medianoche
const ZONES = [
  'Europe/Madrid', 'America/New_York', 'America/Santiago', 'Asia/Kolkata', 'Asia/Kathmandu',
  'Australia/Lord_Howe', 'Pacific/Chatham', 'America/St_Johns', 'Pacific/Kiritimati', 'Pacific/Pago_Pago',
];
const HOUR_MS = 3_600_000;

describe('periodForDate en una zona', () => {
  // cada 3 horas durante un año y pico: pasa por los cambios de hora de todas las zonas
  const instants: number[] = [];
  for (let t = Date.UTC(2025, 11, 1); t <= Date.UTC(2027, 0, 10); t += 3 * HOUR_MS) instants.push(t);

  for (const timeZone of ZONES) {
    it(`coincide con strftime + el desfase del instante en ${timeZone}`, () => {
      for (const t of instants) {
        const iso = new Date(t).toISOString();
        for (const [gran, ws] of [['week', 'friday'], ['week', 'monday'], ['month', 'monday'], ['year', 'monday']] as const) {
          expect(periodForDate(new Date(t), gran, ws, timeZone), `${iso} ${gran}/${ws}`).toBe(sqliteZonedLabel(iso, gran, ws, timeZone));
        }
      }
    });
  }
});

describe('periodBounds en una zona', () => {
  for (const timeZone of ZONES) {
    it(`cada periodo empieza en su medianoche local en ${timeZone}`, () => {
      for (const [gran, ws] of [['week', 'friday'], ['week', 'sunday'], ['month', 'monday'], ['year', 'monday']] as const) {
        let label = periodForDate(new Date(Date.UTC(2026, 0, 15)), gran, ws, timeZone);
        for (let i = 0; i < 60 && label < '2027'; i++) {
          const b = periodBounds(label, gran, ws, timeZone)!;
          const start = Date.parse(b.start);
          // el primer instante es del periodo y el anterior, del de antes
          expect(periodForDate(new Date(start), gran, ws, timeZone), `${label} start`).toBe(label);
          expect(periodForDate(new Date(start - 1000), gran, ws, timeZone), `${label} start-1s`).not.toBe(label);
          label = adjacentPeriod(label, gran, ws, 1)!;
          expect(periodBounds(label, gran, ws, timeZone)!.start, `${label} contiguo`).toBe(b.end);
        }
      }
    });
  }

  it('septiembre en Madrid va de medianoche a medianoche locales', () => {
    expect(periodBounds('2026-09', 'month', 'friday', 'Europe/Madrid')).toEqual({
      start: '2026-08-31T22:00:00.000Z',
      end: '2026-09-30T22:00:00.000Z',
    });
  });

  it('la semana del cambio de hora mide 7 días más una hora', () => {
    // 2026-10-25 Europa vuelve a +01:00: la semana friday del 23 al 29 de octubre
    expect(periodBounds('2026-W42', 'week', 'friday', 'Europe/Madrid')).toEqual({
      start: '2026-10-22T22:00:00.000Z',
      end: '2026-10-29T23:00:00.000Z',
    });
  });

  it('una medianoche que no existe empieza en el instante del salto', () => {
    // Santiago adelanta el reloj el 6 de septiembre de 2026 a las 00:00 → 01:00; y una
    // hora repetida vale la primera vez (Madrid, 25 de octubre, 02:30 dos veces)
    expect(fromWallTime('America/Santiago', Date.UTC(2026, 8, 6))).toBe(Date.parse('2026-09-06T04:00:00.000Z'));
    expect(fromWallTime('Europe/Madrid', Date.UTC(2026, 9, 25, 2, 30))).toBe(Date.parse('2026-10-25T00:30:00.000Z'));
  });
});

describe('zoneSegments', () => {
  const start = Date.UTC(2015, 0, 1);
  const end = Date.UTC(2028, 0, 1);
  for (const timeZone of ZONES) {
    it(`cada tramo empieza justo en el cambio de desfase en ${timeZone}`, () => {
      const segments = zoneSegments(timeZone, start, end);
      segments.slice(1).forEach((s, i) => {
        expect(zoneOffsetMs(timeZone, s.from)).toBe(s.offsetMs);
        expect(zoneOffsetMs(timeZone, s.from - 1000)).toBe(segments[i].offsetMs);
      });
      // y entre cambios el desfase no se mueve: muestreo cada 5 horas
      for (let t = start; t < end; t += 5 * HOUR_MS) {
        const current = segments.findLast(s => s.from <= t)!;
        expect(zoneOffsetMs(timeZone, t), new Date(t).toISOString()).toBe(current.offsetMs);
      }
    });
  }
  it('UTC es un solo tramo sin desfase', () => {
    expect(zoneSegments(UTC_TIME_ZONE, start, end)).toEqual([{ from: start, offsetMs: 0 }]);
  });
});
