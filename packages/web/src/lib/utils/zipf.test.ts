import { describe, it, expect } from 'vitest';
import { fitZipf } from './zipf';

// serie que sigue exacto value(rank) = head / rank^alpha
function powerLaw(n: number, alpha: number, head = 1000): number[] {
  return Array.from({ length: n }, (_, i) => head / (i + 1) ** alpha);
}

describe('fitZipf', () => {
  it('recupera el exponente de una ley de potencias exacta', () => {
    const zipf = fitZipf(powerLaw(20, 1));
    expect(zipf?.alpha).toBeCloseTo(1, 10);
    expect(zipf?.r2).toBeCloseTo(1, 10);
    expect(zipf?.n).toBe(20);

    // una cabeza más dominante da exponente mayor, no solo "mejor ajuste"
    expect(fitZipf(powerLaw(20, 1.8))?.alpha).toBeCloseTo(1.8, 10);
  });

  it('el exponente no depende de la escala de la métrica (ms vs minutos)', () => {
    const ms = powerLaw(15, 0.7, 3_600_000);
    const minutes = ms.map((v) => v / 60_000);
    expect(fitZipf(minutes)?.alpha).toBeCloseTo(fitZipf(ms)!.alpha, 10);
  });

  it('marca con r2 bajo un ranking que no es ley de potencias', () => {
    // caída lineal: la recta log-log no lo describe, el alpha solo no lo diría
    const linear = Array.from({ length: 20 }, (_, i) => 100 - i * 5);
    const zipf = fitZipf(linear);
    expect(zipf!.r2).toBeLessThan(0.9);
  });

  it('lee un ranking plano como alpha 0 y ajuste perfecto', () => {
    const flat = fitZipf(Array(10).fill(42));
    expect(flat?.alpha).toBeCloseTo(0, 10);
    expect(flat?.r2).toBe(1);
  });

  it('descarta los valores no positivos sin correr el rango de los siguientes', () => {
    // 1000/rank con el rango 3 a cero: los supervivientes siguen en su rango real
    // (1, 2, 4), así que el ajuste sigue siendo exacto. Si al filtrar se
    // recompactaran los rangos, el tercer punto caería en el rango 3 y el r2 bajaría
    const zipf = fitZipf([1000, 500, 0, 250]);
    expect(zipf?.n).toBe(3);
    expect(zipf?.alpha).toBeCloseTo(1, 10);
    expect(zipf?.r2).toBeCloseTo(1, 10);
  });

  it('no ajusta con menos de tres puntos utilizables', () => {
    expect(fitZipf([100, 50])).toBeNull();
    expect(fitZipf([100, 0, 0])).toBeNull();
    expect(fitZipf([])).toBeNull();
  });
});
