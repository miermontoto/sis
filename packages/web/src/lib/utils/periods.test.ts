import { describe, it, expect } from 'vitest';
import { weekKey, weekDateRange, prevPeriod, toIsoDate } from './periods';

// las claves de semana las genera el servidor con strftime('%Y-W%W') tras restar
// 0/1/4 días según weekStart. Los valores esperados de aquí salen de ejecutar esa
// misma expresión en sqlite: el cliente tenía dos copias del cálculo y las dos
// daban una semana de menos los años que empiezan en lunes (2024), porque
// contaban el 1 de enero como semana 00 cuando sqlite lo cuenta como 01.

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('weekKey', () => {
  // [fecha, monday, sunday, friday] tal cual los devuelve sqlite
  const cases: [string, string, string, string][] = [
    ['2024-01-01', '2024-W01', '2023-W52', '2023-W52'],
    ['2024-01-07', '2024-W01', '2024-W01', '2024-W01'],
    ['2024-01-08', '2024-W02', '2024-W01', '2024-W01'],
    ['2023-01-01', '2023-W00', '2022-W52', '2022-W52'],
    ['2023-01-02', '2023-W01', '2023-W00', '2022-W52'],
    ['2023-12-31', '2023-W52', '2023-W52', '2023-W52'],
    ['2024-12-30', '2024-W53', '2024-W52', '2024-W52'],
    ['2024-12-31', '2024-W53', '2024-W53', '2024-W52'],
    ['2018-12-31', '2018-W53', '2018-W52', '2018-W52'],
    ['2025-01-01', '2025-W00', '2024-W53', '2024-W52'],
    ['2025-01-05', '2025-W00', '2025-W00', '2025-W00'],
    ['2025-01-06', '2025-W01', '2025-W00', '2025-W00'],
  ];
  it.each(cases)('%s → %s / %s / %s', (date, monday, sunday, friday) => {
    expect(weekKey(utc(date), 'monday')).toBe(monday);
    expect(weekKey(utc(date), 'sunday')).toBe(sunday);
    expect(weekKey(utc(date), 'friday')).toBe(friday);
  });
});

describe('weekDateRange', () => {
  const range = (period: string, ws: 'monday' | 'sunday' | 'friday') => {
    const r = weekDateRange(period, ws);
    return r ? [toIsoDate(r.start), toIsoDate(r.end)] : null;
  };

  it('año que empieza en lunes: la W01 arranca el 1 de enero', () => {
    expect(range('2024-W01', 'monday')).toEqual(['2024-01-01', '2024-01-07']);
    expect(range('2024-W02', 'monday')).toEqual(['2024-01-08', '2024-01-14']);
  });

  it('recorta la semana 00 y la última al año natural', () => {
    expect(range('2023-W00', 'monday')).toEqual(['2023-01-01', '2023-01-01']);
    expect(range('2025-W00', 'monday')).toEqual(['2025-01-01', '2025-01-05']);
    expect(range('2024-W53', 'monday')).toEqual(['2024-12-30', '2024-12-31']);
  });

  it('aplica el desplazamiento de weekStart después del recorte', () => {
    expect(range('2024-W01', 'sunday')).toEqual(['2024-01-02', '2024-01-08']);
    expect(range('2023-W52', 'sunday')).toEqual(['2023-12-26', '2024-01-01']);
    expect(range('2024-W53', 'sunday')).toEqual(['2024-12-31', '2025-01-01']);
    expect(range('2024-W52', 'friday')).toEqual(['2024-12-27', '2025-01-02']);
    expect(range('2025-W00', 'friday')).toEqual(['2025-01-05', '2025-01-09']);
  });

  it('es la inversa de weekKey: cada día del rango vuelve a la misma clave', () => {
    for (const ws of ['monday', 'sunday', 'friday'] as const) {
      for (const period of ['2024-W01', '2024-W53', '2025-W00', '2023-W52', '2026-W10']) {
        const r = weekDateRange(period, ws)!;
        for (let t = r.start.getTime(); t <= r.end.getTime(); t += 86_400_000) {
          expect(weekKey(new Date(t), ws)).toBe(period);
        }
        // y los días de fuera, no
        expect(weekKey(new Date(r.start.getTime() - 86_400_000), ws)).not.toBe(period);
        expect(weekKey(new Date(r.end.getTime() + 86_400_000), ws)).not.toBe(period);
      }
    }
  });

  it('rechaza claves que no son semanas', () => {
    expect(weekDateRange('2024-03', 'monday')).toBeNull();
    expect(weekDateRange('2024', 'monday')).toBeNull();
  });
});

describe('prevPeriod (semanas)', () => {
  it('cruza el año hacia la última clave real, no siempre W52', () => {
    expect(prevPeriod('2024-W01', 'week')).toBe('2023-W52');
    expect(prevPeriod('2025-W00', 'week')).toBe('2024-W53');
    expect(prevPeriod('2025-W01', 'week')).toBe('2025-W00');
    expect(prevPeriod('2024-W02', 'week')).toBe('2024-W01');
  });
});
