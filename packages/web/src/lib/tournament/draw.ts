export type DrawMode = 'seeded' | 'pots' | 'random';

export const DRAW_MODES: DrawMode[] = ['seeded', 'pots', 'random'];

// Fisher-Yates sobre una copia
export function shuffle<T>(items: T[], rand = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// orden del sorteo: en la posición i, el índice del ranking que la ocupa.
// `seeded` deja el ranking tal cual; `pots` baraja dentro de cada bombo del
// formato, así que la estructura (quién protege a quién) se conserva y aun
// así cada sorteo es distinto; `random` no protege a nadie
export function drawOrder(n: number, mode: DrawMode, tierOf: (i: number, n: number) => number, rand = Math.random): number[] {
  const ranked = Array.from({ length: n }, (_, i) => i);
  if (mode === 'seeded') return ranked;
  if (mode === 'random') return shuffle(ranked, rand);
  // los bombos son tramos contiguos del ranking, así que basta con agrupar en orden
  const pots = ranked.reduce((acc, i) => acc.set(tierOf(i, n), [...(acc.get(tierOf(i, n)) ?? []), i]), new Map<number, number[]>());
  return [...pots.values()].flatMap((pot) => shuffle(pot, rand));
}
