import type { HistoryItem } from '$lib/api';

// tolerancia al emparejar un pendiente con su fila ya aterrizada. Las dos marcas
// miden el mismo corte con relojes distintos —la nuestra es el instante en que
// el poller vio cambiar el track, la de spotify el played_at que acaba
// guardando— y en producción se han visto separadas varios segundos
const PENDING_MATCH_MS = 90_000;

// Antepone los plays pendientes (medidos por el servidor, todavía sin fila) a
// una lista de historial.
//
// El servidor ya descarta el pendiente en cuanto existe la fila, pero su
// respuesta viaja en el tick de now-playing y la lista en el suyo, así que
// durante unos segundos las dos pueden traer el mismo play. Sin este filtro se
// vería dos veces, una como hecho y otra como pendiente, que es precisamente el
// ruido que la marca pretende evitar.
export function mergePendingPlays(pending: HistoryItem[], items: HistoryItem[]): HistoryItem[] {
  if (pending.length === 0) return items;
  const fresh = pending.filter(p => !items.some(i =>
    i.track?.id === p.track?.id
    && Math.abs(new Date(i.playedAt).getTime() - new Date(p.playedAt).getTime()) < PENDING_MATCH_MS
  ));
  return fresh.length === 0 ? items : [...fresh, ...items];
}
