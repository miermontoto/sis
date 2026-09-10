import { describe, it, expect } from 'vitest';
import { MILESTONE_THRESHOLDS, nextMilestone } from '@sis/shared';

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
