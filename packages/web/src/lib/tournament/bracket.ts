import type { BoardMatch, BracketBlock, BracketColumn, Match, Outcome, Slot } from './types';

// nombres clásicos de ronda según cuántos entran en ella
const ROUND_NAMES: Record<number, string> = {
  2: 'Final',
  4: 'Final Four',
  8: 'Elite Eight',
  16: 'Sweet 16',
};

export const roundName = (entrants: number): string => ROUND_NAMES[entrants] ?? `Round of ${entrants}`;

export const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(n, 2)));

export const contenders = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

// bombos del cuadro: 1, 2, 3-4, 5-8, 9-16… Barajar dentro de cada uno conserva
// lo que protege el orden de seeds (los 2^k primeros en secciones distintas)
export const powerTier = (i: number): number => (i === 0 ? 0 : Math.ceil(Math.log2(i + 1)));

// orden de seeds estándar: espeja recursivamente para que los cabezas de
// serie no se crucen hasta lo más tarde posible ([1,8,4,5,2,7,3,6] para 8)
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

// primera ronda sembrada con `ranked` por orden; los huecos sobrantes son byes
export const seededSlots = (ranked: number[], size = nextPow2(ranked.length)): Slot[] =>
  seedOrder(size).map((s) => ranked[s - 1] ?? null);

export const emptyMatch = (): BoardMatch => ({ a: null, b: null, winner: null });

// sienta al i-ésimo de una lista en su partido: pares a la izquierda, impares a la derecha
export function seat(match: BoardMatch, i: number, slot: Slot) {
  if (i % 2 === 0) match.a = slot;
  else match.b = slot;
}

// cuadro de `size` huecos con todas sus rondas por decidir
export function bracketBlock(title: string, size: number, crowns: boolean): BracketBlock {
  const columns = Array.from({ length: Math.log2(size) }, (_, r): BracketColumn => {
    const matches = size >> (r + 1);
    return { label: roundName(matches * 2), matches: Array.from({ length: matches }, emptyMatch) };
  });
  return { kind: 'bracket', title, columns, crowns, champion: null };
}

// juega la columna r y empuja cada ganador a la siguiente: a la mitad si esta
// tiene la mitad de partidos, al mismo índice (lado a) si tiene los mismos, que
// son las rondas del cuadro de perdedores donde entra quien cae de arriba. Los
// byes pasan solos sin consumir elección. Devuelve el perdedor de cada partido
export function* playColumn(columns: BracketColumn[], r: number, stage = ''): Generator<Match, Slot[], number> {
  const { label, matches } = columns[r];
  const next = columns[r + 1];
  const losers: Slot[] = [];
  for (const [j, m] of matches.entries()) {
    m.winner = m.a !== null && m.b !== null
      ? yield { a: m.a, b: m.b, label: stage ? `${stage} · ${label}` : label }
      : (m.a ?? m.b);
    losers.push(m.winner === m.a ? m.b : m.a);
    if (!next) continue;
    if (next.matches.length === matches.length) next.matches[j].a = m.winner;
    else seat(next.matches[j >> 1], j, m.winner);
  }
  return losers;
}

// eliminación directa completa sobre un cuadro recién creado
export function* knockout(slots: Slot[], block: BracketBlock, stage = ''): Generator<Match, Outcome, number> {
  slots.forEach((s, i) => seat(block.columns[0].matches[i >> 1], i, s));
  for (let r = 0; r < block.columns.length; r++) yield* playColumn(block.columns, r, stage);
  const final = block.columns[block.columns.length - 1].matches[0];
  block.champion = final.winner;
  return { champion: final.winner, runnerUp: final.winner === final.a ? final.b : final.a };
}
