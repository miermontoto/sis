// escalera de ajuste vertical del sidebar de escritorio. Cuando la columna no
// cabe se aplica el siguiente escalón (now playing en línea, después nav
// compacto con un renglón por grupo, como las pestañas móviles); cada escalón
// se deshace solo cuando sobra al menos lo que ahorró al aplicarse, medido
// entonces por el layout. Sin esa histéresis, deshacer un escalón vuelve a
// desbordar la columna y el sidebar oscila entre los dos estados.
//
// Vive fuera del componente para que la histéresis se pueda testear sin DOM.

export const SIDEBAR_FIT_NP_INLINE = 1;
export const SIDEBAR_FIT_NAV_COMPACT = 2;
export const SIDEBAR_FIT_STEPS = SIDEBAR_FIT_NAV_COMPACT;

// px: por debajo de este ahorro no merece la pena deshacer un escalón. Cubre
// también un escalón que no ahorró nada (now playing apagado al aplicarlo): con
// umbral 0 se desharía al instante y, si el now playing aparece después, rebota
export const SIDEBAR_FIT_MIN_SAVING = 48;

// slack = alto libre de la columna en px, negativo cuando desborda.
// savings[i] = px que ahorró el escalón i + 1 al aplicarse
export function nextFitTier(tier: number, slack: number, savings: readonly number[]): number {
  if (slack < 0) return Math.min(tier + 1, SIDEBAR_FIT_STEPS);
  if (tier > 0 && slack >= Math.max(savings[tier - 1] ?? 0, SIDEBAR_FIT_MIN_SAVING)) return tier - 1;
  return tier;
}
