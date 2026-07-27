// cuántas veces más probable es que salga lo más escuchado frente a la cola:
// inclina el sorteo sin volverlo determinista
export const WEIGHT_SPREAD = 8;

// muestreo ponderado sin reemplazo (Efraimidis-Spirakis): con clave u^(1/w) por
// elemento, quedarse con las k claves más altas da exactamente una selección
// proporcional al peso, en una sola pasada y sin rechazos
export function weightedSample<T>(
  items: T[],
  k: number,
  weight: (item: T) => number,
  spread = WEIGHT_SPREAD,
): T[] {
  if (items.length <= k) return [...items];
  // los pesos crudos (ms escuchados) se van a millones y saturarían la clave
  // hasta hacer el sorteo determinista, así que se normalizan a [1, spread]
  const max = Math.max(...items.map(weight), 1);
  return items
    .map((item) => {
      const w = 1 + (weight(item) / max) * (spread - 1);
      return { item, key: Math.random() ** (1 / w) };
    })
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map((e) => e.item);
}
