import { describe, expect, it, vi } from 'vitest';
import { createDurationUnit } from './duration-unit.svelte';
import { durationRoundsToZero } from './format';

// formatear minutos pasa por `formatNumber` -> locale del usuario -> localStorage,
// que no existe en el entorno node de vitest
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// pulsa la tarjeta `clicks` veces y devuelve la unidad en la que queda cada vez
function cycle(ms: number, from: Parameters<typeof createDurationUnit>[0], clicks: number) {
  const unit = createDurationUnit(from);
  return Array.from({ length: clicks }, () => { unit.next(ms); return unit.unit; });
}

describe('durationRoundsToZero', () => {
  it('detecta la cifra que se pintaría como cero', () => {
    expect(durationRoundsToZero(40 * MIN, 'weeks')).toBe(true);     // 0.0w
    expect(durationRoundsToZero(40 * MIN, 'hours')).toBe(false);    // 0.7h
    expect(durationRoundsToZero(20 * 1000, 'minutes')).toBe(true);  // 0 min
  });

  // el corte lo ponen los decimales de cada unidad, no la magnitud: un día es
  // cero en años y en meses, pero no en semanas
  it('respeta los decimales de cada unidad', () => {
    expect(durationRoundsToZero(DAY, 'years')).toBe(true);       // 0.00y
    expect(durationRoundsToZero(DAY, 'months')).toBe(true);      // 0.0mo
    expect(durationRoundsToZero(DAY, 'weeks')).toBe(false);      // 0.1w
    expect(durationRoundsToZero(2 * DAY, 'years')).toBe(false);  // 0.01y
  });
});

describe('createDurationUnit', () => {
  it('sube por la escalera desde la unidad inicial', () => {
    expect(cycle(400 * DAY, 'minutes', 5)).toEqual(['hours', 'days', 'weeks', 'months', 'years']);
  });

  it('se salta las unidades que dejan la cifra en cero y vuelve a empezar', () => {
    // 40 min: sólo minutos y horas dicen algo, de días en adelante es 0.0
    expect(cycle(40 * MIN, 'minutes', 3)).toEqual(['hours', 'minutes', 'hours']);
  });

  it('no se mueve cuando ninguna otra unidad dice nada', () => {
    // un día sin plays: cero en todas las unidades
    expect(cycle(0, 'hours', 2)).toEqual(['hours', 'hours']);
    expect(createDurationUnit('hours').canCycle(0)).toBe(false);
    expect(createDurationUnit('minutes').canCycle(400 * DAY)).toBe(true);
  });

  it('formatea con la unidad actual', () => {
    const unit = createDurationUnit('minutes');
    expect(unit.format(90 * MIN)).toBe('90 min');
    unit.next(90 * MIN);
    expect(unit.format(90 * MIN)).toBe('1.5h');
  });
});
