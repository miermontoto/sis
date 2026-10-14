import { bracketBlock, contenders, emptyMatch, nextPow2, playColumn, powerTier, seat, seededSlots } from './bracket';
import type { BracketBlock, BracketColumn, Slot, TournamentFormat } from './types';

const WINNERS = 'Winners';
const LOSERS = 'Losers';

// cuadro de perdedores de un cuadro de `size`: por cada ronda de ganadores tras
// la primera, una "major" (supervivientes contra los que caen de arriba)
// precedida de una "minor" (supervivientes entre sí); las dos con los mismos
// partidos, y cada pareja con la mitad que la anterior
function losersColumns(size: number): BracketColumn[] {
  const counts = Array.from({ length: Math.log2(size) - 1 }, (_, q) => size >> (q + 2)).flatMap((c) => [c, c]);
  return counts.map((count, i) => ({
    label: i === counts.length - 1 ? 'Final' : `Round ${i + 1}`,
    matches: Array.from({ length: count }, emptyMatch),
  }));
}

export const doubleFormat: TournamentFormat = {
  id: 'double',
  label: 'Double elim',
  board: 'bracket',
  minEntries: 3,
  tierOf: powerTier,
  byes: (n) => nextPow2(n) - n,
  describe: () =>
    'Double elimination: a first loss drops you to the losers bracket, a second knocks you out. Its winner has to beat the unbeaten finalist twice.',
  *run({ n }, board) {
    const slots = seededSlots(contenders(n));
    const upper = bracketBlock('Winners bracket', slots.length, false);
    const lower: BracketBlock = { kind: 'bracket', title: 'Losers bracket', columns: losersColumns(slots.length), crowns: false, champion: null };
    const final: BracketBlock = {
      kind: 'bracket', title: 'Grand final', columns: [{ label: 'Grand final', matches: [emptyMatch()] }], crowns: true, champion: null,
    };
    board.push(upper, lower, final);

    slots.forEach((s, i) => seat(upper.columns[0].matches[i >> 1], i, s));
    const firstLosers = yield* playColumn(upper.columns, 0, WINNERS);
    firstLosers.forEach((s, i) => seat(lower.columns[0].matches[i >> 1], i, s));
    yield* playColumn(lower.columns, 0, LOSERS);

    for (let r = 1; r < upper.columns.length; r++) {
      const dropped = yield* playColumn(upper.columns, r, WINNERS);
      // la primera caída entra invertida para no repetir enseguida el cruce de
      // la primera ronda; a partir de ahí se alterna
      const major = 2 * r - 1;
      const order = (r - 1) % 2 === 0 ? [...dropped].reverse() : dropped;
      order.forEach((s, j) => { lower.columns[major].matches[j].b = s; });
      yield* playColumn(lower.columns, major, LOSERS);
      if (major + 1 < lower.columns.length) yield* playColumn(lower.columns, major + 1, LOSERS);
    }

    const lastOf = (block: BracketBlock): Slot => block.columns[block.columns.length - 1].matches[0].winner;
    const top = lastOf(upper);
    const bottom = lastOf(lower);
    // con tres o más entradas los dos lados siempre llegan; la guarda es para el tipo
    if (top === null || bottom === null) return { champion: top ?? bottom, runnerUp: null };

    const [grand] = final.columns[0].matches;
    grand.a = top;
    grand.b = bottom;
    let champion = grand.winner = yield { a: top, b: bottom, label: 'Grand final', notes: ['Unbeaten', '1 loss'] };
    if (champion === bottom) {
      // el que viene de perdedores ha tumbado al invicto una vez: falta la segunda
      const reset = { a: top, b: bottom, winner: null as Slot };
      final.columns.push({ label: 'Reset', matches: [reset] });
      champion = reset.winner = yield { a: top, b: bottom, label: 'Grand final · reset', notes: ['1 loss', '1 loss'] };
    }
    final.champion = champion;
    return { champion, runnerUp: champion === top ? bottom : top };
  },
};
