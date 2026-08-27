import type { EntityCardPoint, EntityType, RankingMetric } from '$lib/api';

// Lógica pura de la tarjeta de hover de entidad (ver EntityHoverCard.svelte):
// resolver a qué entidad apunta un enlace, densificar la serie de la sparkline y
// colocar la tarjeta en el viewport. Vive aparte del componente para poder
// probarse sin DOM: es donde se esconden los off-by-one.

// ancho fijo de la tarjeta: hace determinista la colocación horizontal (no
// depende de medir un contenido que además llega por red)
export const ENTITY_CARD_WIDTH = 300;
// separación entre ancla y tarjeta, y margen mínimo a los bordes del viewport
export const ENTITY_CARD_GAP = 8;
export const ENTITY_CARD_PAD = 8;

const DAY_MS = 86_400_000;
const ENTITY_TYPES = new Set<string>(['track', 'album', 'artist']);

export interface AnchorBox {
  top: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Entidad a la que apunta una ruta de la app, o null si no describe ninguna. */
export function parseEntityPath(pathname: string): { type: EntityType; id: string } | null {
  const [, type, id, ...rest] = pathname.split('/');
  if (!id || rest.length > 0 || !ENTITY_TYPES.has(type)) return null;
  return { type: type as EntityType, id: decodeURIComponent(id) };
}

/**
 * Serie densa para la sparkline. La respuesta sólo trae los días con plays, así
 * que rellenar los huecos a cero es lo que hace que la forma sea honesta y no un
 * gráfico de días contiguos falsos. Los buckets son días UTC (`date()` de
 * sqlite), de ahí que el eje se construya también en UTC.
 */
export function densifySeries(
  points: EntityCardPoint[],
  days: number,
  metric: RankingMetric,
  nowMs: number = Date.now(),
): number[] {
  const byDay = new Map(points.map(p => [p.day, metric === 'plays' ? p.playCount : p.totalMs]));
  const endUtc = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return Array.from({ length: days }, (_, i) =>
    byDay.get(new Date(endUtc - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10)) ?? 0
  );
}

/**
 * Coloca la tarjeta: debajo del ancla si cabe, si no encima, y clampada al
 * viewport. En horizontal se centra en el puntero y no en el ancla, porque una
 * fila de lista ocupa todo el ancho y centrarse en ella la dejaría lejos de
 * donde está mirando el usuario.
 */
export function placeCard(anchor: AnchorBox, pointerX: number, cardHeight: number, viewport: Viewport) {
  let top = anchor.bottom + ENTITY_CARD_GAP;
  if (top + cardHeight > viewport.height - ENTITY_CARD_PAD) {
    const above = anchor.top - ENTITY_CARD_GAP - cardHeight;
    top = above >= ENTITY_CARD_PAD ? above : Math.max(ENTITY_CARD_PAD, viewport.height - cardHeight - ENTITY_CARD_PAD);
  }
  const maxLeft = viewport.width - ENTITY_CARD_WIDTH - ENTITY_CARD_PAD;
  const left = Math.max(ENTITY_CARD_PAD, Math.min(pointerX - ENTITY_CARD_WIDTH / 2, maxLeft));
  return { top: Math.round(top), left: Math.round(left) };
}

/** Path de la sparkline en coordenadas normalizadas (x = índice, y = 0 arriba). */
export function sparkPath(values: number[]): { line: string; area: string; lastX: number } | null {
  const max = Math.max(...values);
  if (!(max > 0) || values.length < 2) return null;
  const lastX = values.length - 1;
  const line = `M${values.map((v, i) => `${i},${(1 - v / max).toFixed(4)}`).join(' L')}`;
  return { line, area: `${line} L${lastX},1 L0,1 Z`, lastX };
}
