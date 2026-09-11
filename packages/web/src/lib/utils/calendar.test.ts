import { describe, it, expect } from 'vitest';
import {
  firstDayForRegion, firstDayOfWeek, monthGrid, GRID_CELLS, shiftMonth, weekdayLabels,
  splitValue, joinValue, clampTime, to24Hour, to12Hour, formatPickerValue, uses12HourClock,
  keyParts, dateKey,
} from './calendar';

describe('firstDayOfWeek', () => {
  it('sigue a CLDR: lunes en europa, domingo en américa, sábado en el golfo', () => {
    expect(firstDayForRegion('ES')).toBe(1);
    expect(firstDayForRegion('US')).toBe(0);
    expect(firstDayForRegion('BR')).toBe(0);
    expect(firstDayForRegion('EG')).toBe(6);
    expect(firstDayForRegion('')).toBe(1);
  });

  it('resuelve por locale, con región implícita y con tag inválido', () => {
    expect(firstDayOfWeek('es-ES')).toBe(1);
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('en')).toBe(0);
    expect(firstDayOfWeek('fr')).toBe(1);
    expect(firstDayOfWeek('not a tag')).toBe(1);
  });
});

describe('monthGrid', () => {
  it('tiene 6 semanas y arranca en el primer día de la semana pedido', () => {
    // septiembre de 2026 empieza en martes
    const monday = monthGrid(2026, 8, 1);
    expect(monday).toHaveLength(GRID_CELLS);
    expect(monday[0]).toEqual({ key: '2026-08-31', day: 31, inMonth: false });
    expect(monday[1]).toEqual({ key: '2026-09-01', day: 1, inMonth: true });
    expect(monday[30]).toEqual({ key: '2026-09-30', day: 30, inMonth: true });
    expect(monday[31].inMonth).toBe(false);

    const sunday = monthGrid(2026, 8, 0);
    expect(sunday[0].key).toBe('2026-08-30');
    expect(sunday[2].key).toBe('2026-09-01');
  });

  it('cruza el cambio de año en las dos direcciones', () => {
    const jan = monthGrid(2026, 0, 1);
    expect(jan[0].key).toBe('2025-12-29');
    const dec = monthGrid(2025, 11, 1);
    expect(dec.at(-1)!.key).toBe('2026-01-11');
  });
});

describe('shiftMonth', () => {
  it('envuelve el año', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 3, -12)).toEqual({ year: 2025, month: 3 });
  });
});

describe('weekdayLabels', () => {
  it('rota los nombres al primer día de la semana', () => {
    expect(weekdayLabels('en-US', 0)[0]).toBe('Sun');
    expect(weekdayLabels('en-GB', 1)[0]).toBe('Mon');
    expect(weekdayLabels('en-GB', 1)[6]).toBe('Sun');
  });
});

describe('value contract', () => {
  it('conserva los formatos de los inputs nativos', () => {
    expect(splitValue('2026-09-11T21:30')).toEqual({ date: '2026-09-11', time: '21:30' });
    expect(splitValue('2026-09-11')).toEqual({ date: '2026-09-11', time: '' });
    expect(splitValue('')).toEqual({ date: '', time: '' });
    expect(joinValue('2026-09-11', '21:30', true)).toBe('2026-09-11T21:30');
    expect(joinValue('2026-09-11', '', true)).toBe('2026-09-11T00:00');
    expect(joinValue('2026-09-11', '21:30', false)).toBe('2026-09-11');
    expect(joinValue('', '21:30', true)).toBe('');
    expect(keyParts('2026-09-11')).toEqual({ year: 2026, month: 8, day: 11 });
    expect(dateKey(2026, 0, 5)).toBe('2026-01-05');
  });

  it('acota la hora y convierte el reloj de 12', () => {
    expect(clampTime(25, 70)).toBe('23:59');
    expect(clampTime(-1, Number.NaN)).toBe('00:00');
    expect(clampTime(9, 5)).toBe('09:05');
    expect(to24Hour(12, false)).toBe(0);
    expect(to24Hour(12, true)).toBe(12);
    expect(to24Hour(3, true)).toBe(15);
    expect(to12Hour(0)).toEqual({ hour: 12, pm: false });
    expect(to12Hour(13)).toEqual({ hour: 1, pm: true });
  });
});

describe('formatting', () => {
  it('pinta el valor en el locale de la app, no en el del sistema', () => {
    expect(formatPickerValue('2026-09-11', 'en-US', false)).toBe('Sep 11, 2026');
    expect(formatPickerValue('2026-09-11', 'es-ES', false)).toBe('11 sept 2026');
    expect(formatPickerValue('2026-09-11T21:05', 'en-GB', true)).toBe('11 Sept 2026, 21:05');
    expect(formatPickerValue('', 'en-US', true)).toBe('');
  });

  it('detecta el reloj de 12 horas por locale', () => {
    expect(uses12HourClock('en-US')).toBe(true);
    expect(uses12HourClock('es-ES')).toBe(false);
  });
});
