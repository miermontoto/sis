import { describe, it, expect } from 'vitest';
import { MILESTONE_THRESHOLDS, nextMilestone, previousMilestone } from '@sis/shared';

describe('nextMilestone', () => {
  it('devuelve el primer peldaño por encima del total', () => {
    expect(nextMilestone(0)).toBe(100);
    expect(nextMilestone(99)).toBe(100);
    // justo en un hito, el siguiente es el de arriba
    expect(nextMilestone(100)).toBe(250);
    expect(nextMilestone(12_345)).toBe(25_000);
  });

  it('más allá de la escalera sigue en múltiplos del último peldaño', () => {
    const last = MILESTONE_THRESHOLDS[MILESTONE_THRESHOLDS.length - 1];
    expect(nextMilestone(last)).toBe(last * 2);
    expect(nextMilestone(349_370)).toBe(400_000);
    expect(nextMilestone(400_000)).toBe(500_000);
  });
});

describe('previousMilestone', () => {
  it('es el hito alcanzado más alto, o cero sin ninguno', () => {
    expect(previousMilestone(0)).toBe(0);
    expect(previousMilestone(99)).toBe(0);
    expect(previousMilestone(100)).toBe(100);
    expect(previousMilestone(12_345)).toBe(10_000);
  });

  it('más allá de la escalera, el múltiplo de abajo: la barra va de 300k a 400k', () => {
    expect(previousMilestone(349_370)).toBe(300_000);
    expect(nextMilestone(349_370) - previousMilestone(349_370)).toBe(100_000);
  });
});
