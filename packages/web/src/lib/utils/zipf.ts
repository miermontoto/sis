// ajuste de ley de potencias sobre un ranking: value(rank) ≈ C · rank^-alpha.
// se estima por mínimos cuadrados sobre log(value) vs log(rank), que es la
// lectura habitual de zipf: alpha = 1 es la ley clásica (el nº2 acumula la mitad
// que el nº1), alpha < 1 un reparto plano y alpha > 1 una cabeza que domina.
// r2 dice cuánto se puede confiar en ese alpha: sin buen ajuste el exponente no
// describe la distribución, solo la recta que se le ha forzado encima.

export interface ZipfFit {
  /** exponente de la ley de potencias (pendiente de la recta log-log, en positivo) */
  alpha: number;
  /** bondad del ajuste en escala log-log, 0..1 */
  r2: number;
  /** puntos que han entrado en el ajuste */
  n: number;
}

// con menos de tres puntos la recta pasa exacta por todos y el r2 sale 1 sin
// informar de nada
const MIN_ZIPF_POINTS = 3;

/**
 * Ajusta `values` (ya ordenados de mayor a menor; el rango es la posición) a una
 * ley de potencias. Devuelve null si no hay puntos positivos suficientes.
 */
export function fitZipf(values: number[]): ZipfFit | null {
  // el rango se fija antes de filtrar: un valor a cero queda fuera del ajuste
  // (log(0) = -Infinity) pero no corre el rango de los que vienen detrás
  const points = values
    .map((value, i) => ({ x: Math.log(i + 1), y: Math.log(value) }))
    .filter((p) => Number.isFinite(p.y));

  const n = points.length;
  if (n < MIN_ZIPF_POINTS) return null;

  const meanX = points.reduce((acc, p) => acc + p.x, 0) / n;
  const meanY = points.reduce((acc, p) => acc + p.y, 0) / n;

  // solo es cero si todos los puntos comparten rango, que aquí no puede pasar,
  // pero divide la pendiente: se comprueba en vez de confiar en la precondición
  const varX = points.reduce((acc, p) => acc + (p.x - meanX) ** 2, 0);
  if (varX === 0) return null;

  const ssTot = points.reduce((acc, p) => acc + (p.y - meanY) ** 2, 0);

  // ranking plano (todos los valores iguales): no hay dispersión que explicar, así
  // que la lectura es "no decae" y no el 0/0 de la fórmula. El umbral es relativo a
  // la magnitud de los datos porque restar su media a N logs idénticos deja ruido de
  // coma flotante, no un cero exacto, y ese ruido dividido por sí mismo daba r2 ≈ 0
  // justo para el ranking más plano posible
  const scale = points.reduce((acc, p) => acc + p.y ** 2, 0);
  if (ssTot <= Number.EPSILON * scale) return { alpha: 0, r2: 1, n };

  const slope = points.reduce((acc, p) => acc + (p.x - meanX) * (p.y - meanY), 0) / varX;
  const ssRes = points.reduce((acc, p) => acc + (p.y - meanY - slope * (p.x - meanX)) ** 2, 0);

  return { alpha: -slope, r2: 1 - ssRes / ssTot, n };
}
