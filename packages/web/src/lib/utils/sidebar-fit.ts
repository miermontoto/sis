// ajuste vertical del sidebar de escritorio: dos partes plegables (el now
// playing, que pasa a línea, y el nav, que se compacta a un renglón por grupo
// como las pestañas móviles) y una elección entre sus cuatro combinaciones.
// Se elige la primera que quepa por orden de preferencia, con las alturas
// MEDIDAS de cada parte en cada modo. Al decidir con alturas y no con
// "¿desborda ahora?" no hay bucle compactar → sobra → expandir → no cabe: la
// predicción de una combinación es la misma antes y después de pintarla.
//
// Un escalón estricto (primero now playing, luego nav, y deshacer en orden
// inverso) dejaba el now playing en línea junto a la nav compacta aunque
// cupiera entero: en 1080p, con sesión y amigos, la columna acababa con las
// dos partes compactas y 300px vacíos.
//
// Vive fuera del componente para que la elección se pueda testear sin DOM.

export interface FitChoice {
  navCompact: boolean;
  npInline: boolean;
}

// alturas en px. Una desconocida (ese modo aún no se ha pintado) se omite y
// cuenta como 0: la combinación se prueba, se pinta y se mide
export interface FitSizes {
  // todo lo que no es nav ni now playing
  base: number;
  navFull?: number;
  navCompact?: number;
  // desconocida cuando el now playing está forzado a línea: cuenta como la de línea
  npFull?: number;
  npInline?: number;
}

// orden de preferencia: primero se sacrifica el now playing; la nav, que es la
// navegación principal, es el último recurso
export const FIT_CANDIDATES: readonly FitChoice[] = [
  { navCompact: false, npInline: false },
  { navCompact: false, npInline: true },
  { navCompact: true, npInline: false },
  { navCompact: true, npInline: true },
];

// px de más que han de sobrar para EXPANDIR una parte. Las alturas van
// redondeadas, y en el límite exacto la expandida desbordaría 1px, se
// compactaría y volvería a predecir que cabe: con este margen no oscila
export const SIDEBAR_FIT_SLOP = 4;

export function chooseFit(available: number, s: FitSizes, current: FitChoice): FitChoice {
  const navH = (c: FitChoice) => (c.navCompact ? s.navCompact : s.navFull) ?? 0;
  const npH = (c: FitChoice) => (c.npInline ? s.npInline : s.npFull ?? s.npInline) ?? 0;
  const expands = (c: FitChoice) => (current.navCompact && !c.navCompact) || (current.npInline && !c.npInline);
  return FIT_CANDIDATES.find(c => s.base + navH(c) + npH(c) + (expands(c) ? SIDEBAR_FIT_SLOP : 0) <= available)
    ?? FIT_CANDIDATES[FIT_CANDIDATES.length - 1];
}

export function sameFit(a: FitChoice, b: FitChoice): boolean {
  return a.navCompact === b.navCompact && a.npInline === b.npInline;
}
