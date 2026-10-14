import { powerTier } from './bracket';
import type { ListBlock, Slot, TournamentFormat } from './types';

const streakNote = (streak: number) => (streak === 0 ? 'Opens the gauntlet' : `${streak} straight ${streak === 1 ? 'win' : 'wins'}`);

export const kothFormat: TournamentFormat = {
  id: 'koth',
  label: 'King of the hill',
  board: 'ladder',
  minEntries: 2,
  tierOf: powerTier,
  byes: () => 0,
  describe: () =>
    'Winner stays on: challengers come up from the bottom of the draw one at a time, and whoever holds the throne after the last one is champion.',
  *run({ n }, board) {
    // el último del sorteo abre el trono y los retadores suben hasta el
    // primero, que llega al final como jefe
    const queue = Array.from({ length: n }, (_, i) => n - 1 - i);
    const list: ListBlock = {
      kind: 'list', title: 'The gauntlet', matches: queue.slice(1).map((b) => ({ a: null, b, winner: null })),
    };
    board.push(list);

    let holder = queue[0];
    let streak = 0;
    let runnerUp: Slot = null;
    for (const [i, m] of list.matches.entries()) {
      const challenger = queue[i + 1];
      m.a = holder;
      const w = yield {
        a: holder, b: challenger, label: `Challenger ${i + 1} of ${list.matches.length}`, notes: [streakNote(streak), 'Challenger'],
      };
      m.winner = w;
      runnerUp = w === holder ? challenger : holder;
      streak = w === holder ? streak + 1 : 1;
      holder = w;
    }
    return { champion: holder, runnerUp };
  },
};
