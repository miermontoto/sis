import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { periodForDate, periodBounds, adjacentPeriod, isClosedPeriod, isPeriodKey, WEEK_START_SHIFT_DAYS } from '@sis/shared';
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
  const modifier = gran === 'week' ? `-${WEEK_START_SHIFT_DAYS[ws]} days` : '+0 days';
  return stmt.get(FORMATS[gran], iso, modifier)!.p as string;
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
});

describe('isClosedPeriod', () => {
  const now = new Date('2026-09-06T10:00:00.000Z');
  it('el periodo en curso está abierto y el anterior cerrado', () => {
    expect(isClosedPeriod('2026-W35', 'week', 'friday', now)).toBe(false);
    expect(isClosedPeriod('2026-W34', 'week', 'friday', now)).toBe(true);
    expect(isClosedPeriod('2026-09', 'month', 'friday', now)).toBe(false);
    expect(isClosedPeriod('2026-08', 'month', 'friday', now)).toBe(true);
    expect(isClosedPeriod('2026', 'year', 'friday', now)).toBe(false);
    expect(isClosedPeriod('2025', 'year', 'friday', now)).toBe(true);
  });
  it('un periodo futuro no está cerrado', () => {
    expect(isClosedPeriod('2027-W01', 'week', 'friday', now)).toBe(false);
  });
});
