import { api, getRankingMetric, type EntityCard, type EntityType, type Rankings } from '$lib/api';

// Estado de la tarjeta de detalle que se abre al pasar el ratón por una entidad.
// Una sola instancia monta <EntityHoverCard /> en el layout y es ella quien decide
// CUÁNDO abrir (listener delegado + retardos); aquí sólo vive QUÉ se muestra.
export interface HoverCardState {
  type: EntityType;
  id: string;
  // rect del ancla y x del puntero: una fila de lista ocupa todo el ancho, así que
  // la tarjeta se apoya en el borde de la fila pero se centra en el puntero
  rect: DOMRect;
  pointerX: number;
}

let state = $state<HoverCardState | null>(null);
let card = $state<EntityCard | null>(null);
let ranks = $state<Rankings | null>(null);
let failed = $state(false);
let controller: AbortController | null = null;

// carga en dos tramos: la tarjeta (queries indexadas por entidad, milisegundos) y
// después el rank, que es un scan del historial. Pedirlos juntos retrasaría todo
// lo barato detrás de lo caro, así que el rank rellena su hueco cuando llega.
async function load(type: EntityType, id: string) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const isCurrent = () => !signal.aborted && state?.id === id && state?.type === type;

  try {
    const data = await api.entityCard(type, id, signal);
    if (!isCurrent()) return;
    card = data;
  } catch {
    if (isCurrent()) failed = true;
    return;
  }

  try {
    const data = await api.rankings(type, id, getRankingMetric(), signal);
    if (isCurrent()) ranks = data;
  } catch {
    // sin rank la tarjeta sigue siendo útil: no se marca como fallida
  }
}

export const hoverCard = {
  get state() { return state; },
  get card() { return card; },
  get ranks() { return ranks; },
  get failed() { return failed; },

  open(type: EntityType, id: string, rect: DOMRect, pointerX: number) {
    // reabrir sobre la misma entidad (el puntero pasa por otro enlace suyo) sólo
    // recoloca: tirar los datos haría parpadear una tarjeta ya cargada
    const same = state?.type === type && state?.id === id;
    state = { type, id, rect, pointerX };
    if (same) return;
    card = null;
    ranks = null;
    failed = false;
    load(type, id);
  },

  close() {
    controller?.abort();
    controller = null;
    state = null;
    card = null;
    ranks = null;
    failed = false;
  },
};
