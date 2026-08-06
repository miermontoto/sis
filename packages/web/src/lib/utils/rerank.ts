import type { RankingMetric } from '@sis/shared';
import { metricValue, type LibraryItem } from './library-items.js';

// duración media por play cuando no hay datos (3:30, media típica de un track)
const FALLBACK_MS_PER_PLAY = 210_000;
// incremento mínimo para adelantar a otro en el ranking: 1 ms o 1 play
const TIE_BREAK = 1;

export interface RerankRow {
  item: LibraryItem;
  currentRank: number;
  targetRank: number;
  // positivo = sube en el ranking, negativo = baja
  delta: number;
  value: number;
  // valor mínimo de la métrica que sostiene la posición elegida
  requiredValue: number;
  deficit: number;
  deficitMs: number;
  deficitPlays: number;
}

// ms medios por escucha del propio historial; es mejor estimador que la duración
// del track porque incorpora las escuchas parciales
export function msPerPlay(item: LibraryItem): number {
  if (item.playCount > 0 && item.totalMs > 0) return item.totalMs / item.playCount;
  return item.durationMs ?? FALLBACK_MS_PER_PLAY;
}

// coste mínimo para que `order` (de mejor a peor) sea el ranking real.
//
// se recorre de abajo arriba: cada uno necesita, como mucho, superar por 1 al que
// queda justo debajo. como el de debajo ya está minimizado, minimizar cada paso
// da el óptimo global. las bajadas salen gratis: no se puede des-escuchar, uno
// cae porque otros le adelantan. ojo: un elemento que NO se mueve también puede
// tener coste, si el que le queda debajo le alcanza al ser promocionado.
//
// nada de fuera de la lista se cuela entre medias: la métrica solo sube, así que
// el conjunto cargado nunca pierde posiciones frente a lo que quedaba por debajo.
export function computeRows(
  order: LibraryItem[],
  currentRanks: Map<string, number>,
  metric: RankingMetric,
): RerankRow[] {
  const values = order.map((i) => metricValue(i, metric));
  const required = new Array<number>(order.length);

  for (let k = order.length - 1; k >= 0; k--) {
    required[k] = k === order.length - 1
      ? values[k]
      : Math.max(values[k], required[k + 1] + TIE_BREAK);
  }

  return order.map((item, k) => {
    const targetRank = k + 1;
    const currentRank = currentRanks.get(item.key) ?? targetRank;
    const deficit = required[k] - values[k];
    const per = msPerPlay(item);
    return {
      item,
      currentRank,
      targetRank,
      delta: currentRank - targetRank,
      value: values[k],
      requiredValue: required[k],
      deficit,
      deficitMs: metric === 'time' ? deficit : Math.round(deficit * per),
      deficitPlays: metric === 'time' ? Math.ceil(deficit / per) : deficit,
    };
  });
}

// --- plan de escucha ---

export interface PlanCandidate {
  id: string;
  name: string;
  subtitle: string;
  imageUrl: string | null;
  durationMs: number;
}

export interface PlanSlot {
  candidate: PlanCandidate;
  count: number;
}

export interface PlanGroup {
  key: string;
  item: LibraryItem;
  targetRank: number;
  deficitMs: number;
  slots: PlanSlot[];
  coveredMs: number;
  // true si el tope de tracks cortó el grupo antes de cubrir el objetivo
  truncated: boolean;
}

// lo que aporta una escucha al objetivo. rankeando por tiempo cada play suma su
// duración; rankeando por plays suma 1, dure lo que dure
export type PlanWeight = (candidate: PlanCandidate) => number;
export const WEIGHT_TIME: PlanWeight = (c) => c.durationMs;
export const WEIGHT_PLAYS: PlanWeight = () => 1;

// reparte el objetivo entre los candidatos en round-robin: repartir a vueltas en
// vez de agotar el primero da una playlist escuchable en vez de un bucle
export function fillGoal(
  candidates: PlanCandidate[],
  target: number,
  maxTracks: number,
  weight: PlanWeight = WEIGHT_TIME,
): PlanSlot[] {
  if (candidates.length === 0 || target <= 0 || maxTracks <= 0) return [];

  const counts = new Array<number>(candidates.length).fill(0);
  let covered = 0;
  let placed = 0;

  while (covered < target && placed < maxTracks) {
    const i = placed % candidates.length;
    counts[i]++;
    covered += weight(candidates[i]);
    placed++;
  }

  return counts
    .map((count, i) => ({ candidate: candidates[i], count }))
    .filter((s) => s.count > 0);
}

export const slotsDuration = (slots: PlanSlot[]): number =>
  slots.reduce((ms, s) => ms + s.candidate.durationMs * s.count, 0);

export const slotsCount = (slots: PlanSlot[]): number =>
  slots.reduce((n, s) => n + s.count, 0);

// aplana los grupos a la lista de trackIds en orden de escucha: dentro de cada
// grupo se intercalan los candidatos (una vuelta por ronda) en vez de encadenar
// N copias seguidas del mismo track
export function planTrackIds(groups: PlanGroup[]): string[] {
  return groups.flatMap((g) => {
    const ids: string[] = [];
    const remaining = g.slots.map((s) => s.count);
    let pending = remaining.reduce((a, b) => a + b, 0);
    while (pending > 0) {
      remaining.forEach((n, i) => {
        if (n <= 0) return;
        ids.push(g.slots[i].candidate.id);
        remaining[i]--;
        pending--;
      });
    }
    return ids;
  });
}
