import { describe, it, expect } from 'vitest';
import { nextFitTier, SIDEBAR_FIT_STEPS, SIDEBAR_FIT_MIN_SAVING } from './sidebar-fit';

// la escalera se mide en el layout con ResizeObserver; aquí sólo la histéresis,
// que es donde estaba el bucle (compactar → sobra → expandir → no cabe → …)

describe('nextFitTier', () => {
  it('baja un escalón cuando la columna desborda y se detiene en el último', () => {
    expect(nextFitTier(0, -1, [])).toBe(1);
    expect(nextFitTier(1, -200, [150])).toBe(2);
    expect(nextFitTier(SIDEBAR_FIT_STEPS, -500, [150, 300])).toBe(SIDEBAR_FIT_STEPS);
  });

  it('no deshace un escalón hasta que sobra lo que ahorró', () => {
    expect(nextFitTier(2, 120, [150, 300])).toBe(2);
    expect(nextFitTier(2, 300, [150, 300])).toBe(1);
    expect(nextFitTier(1, 149, [150, 300])).toBe(1);
    expect(nextFitTier(1, 150, [150, 300])).toBe(0);
  });

  it('con la columna justa se queda como está', () => {
    expect(nextFitTier(0, 0, [])).toBe(0);
    expect(nextFitTier(1, 0, [150])).toBe(1);
  });

  it('un escalón que no ahorró nada exige al menos el umbral mínimo', () => {
    expect(nextFitTier(1, SIDEBAR_FIT_MIN_SAVING - 1, [0])).toBe(1);
    expect(nextFitTier(1, SIDEBAR_FIT_MIN_SAVING, [0])).toBe(0);
    // sin medida aún (escalón aplicado pero DOM sin actualizar) cuenta como 0
    expect(nextFitTier(1, SIDEBAR_FIT_MIN_SAVING, [])).toBe(0);
  });
});
