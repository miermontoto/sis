import { bracketBlock, contenders, knockout, nextPow2, powerTier, seededSlots } from './bracket';
import type { TournamentFormat } from './types';

export const knockoutFormat: TournamentFormat = {
  id: 'knockout',
  label: 'Knockout',
  board: 'bracket',
  minEntries: 2,
  tierOf: powerTier,
  byes: (n) => nextPow2(n) - n,
  describe: () => "Single elimination: lose once and you're out.",
  *run({ n }, board) {
    const slots = seededSlots(contenders(n));
    const block = bracketBlock('', slots.length, true);
    board.push(block);
    return yield* knockout(slots, block);
  },
};
