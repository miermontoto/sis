import { bracketBlock, contenders, knockout, seedOrder } from './bracket';
import type { Slot, TablesBlock, TournamentFormat } from './types';

const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// con menos de tres por grupo la liguilla sería un único partido
const MIN_GROUP_SIZE = 3;
// pasan los dos primeros de cada grupo
const ADVANCE = 2;

// la potencia de dos más alta que deja grupos de al menos MIN_GROUP_SIZE: así
// la fase final (dos por grupo) cuadra sin byes
export const groupCount = (n: number): number => 2 ** Math.floor(Math.log2(Math.max(n / MIN_GROUP_SIZE, 1)));

// reparto en serpiente: un bombo va de A a H y el siguiente de H a A, así cada
// grupo recibe uno de cada bombo y las sumas de seeds quedan parejas
function groupOf(i: number, groups: number): number {
  const pot = Math.floor(i / groups);
  const j = i % groups;
  return pot % 2 === 0 ? j : groups - 1 - j;
}

// método del círculo: el primero queda fijo y el resto rota; con impares, un
// hueco vacío hace de descanso. Rotando hacia atrás, los dos primeros del
// grupo se cruzan en la última jornada
export function roundRobin(members: number[]): [number, number][][] {
  const ring: Slot[] = members.length % 2 ? [...members, null] : [...members];
  const spin = ring.length - 1;
  return Array.from({ length: spin }, (_, day) => {
    const rot = [ring[0], ...ring.slice(1).map((_slot, i) => ring[1 + ((((i - day) % spin) + spin) % spin)])];
    return Array.from({ length: rot.length / 2 }, (_pair, i): [Slot, Slot] => [rot[i], rot[rot.length - 1 - i]])
      .filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
  });
}

const sizeLabel = (n: number, groups: number) =>
  n % groups ? `${Math.floor(n / groups)}–${Math.ceil(n / groups)}` : String(n / groups);

export const groupsFormat: TournamentFormat = {
  id: 'groups',
  label: 'Groups',
  board: 'groups',
  minEntries: 4,
  tierOf: (i, n) => Math.floor(i / groupCount(n)),
  byes: () => 0,
  describe: ({ n }) => {
    const groups = groupCount(n);
    return groups === 1
      ? 'One group: everyone plays everyone, then the top two meet in the final.'
      : `${groups} groups of ${sizeLabel(n, groups)}: everyone plays their group, and the top two of each go to a knockout where groupmates can only meet in the final.`;
  },
  *run({ n }, board) {
    const count = groupCount(n);
    const members = Array.from({ length: count }, (_, g) => contenders(n).filter((i) => groupOf(i, count) === g));
    const wins = new Array<number>(n).fill(0);
    const losses = new Array<number>(n).fill(0);
    // ganador de cada cruce, para deshacer empates por enfrentamiento directo
    const beat = new Map<string, number>();
    const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const unplayed = members.map((m) => (m.length * (m.length - 1)) / 2);
    const record = (c: number) => `${wins[c]}–${losses[c]}`;
    // victorias primero; los empates, por la liguilla entre empatados y luego por sorteo
    const standings = (group: number[]) => {
      const mini = (c: number) => group.filter((o) => o !== c && wins[o] === wins[c] && beat.get(pairKey(c, o)) === c).length;
      return [...group].sort((x, y) => wins[y] - wins[x] || mini(y) - mini(x) || x - y);
    };

    const block: TablesBlock = { kind: 'tables', title: 'Groups', headers: ['W–L'], tables: [] };
    const refresh = () => {
      block.tables = members.map((group, g) => ({
        title: `Group ${GROUP_LETTERS[g]}`,
        rows: standings(group).map((c, pos) => ({ c, cells: [record(c)], qualified: unplayed[g] === 0 && pos < ADVANCE })),
      }));
    };
    board.push(block);

    // jornada a jornada por todos los grupos, como un mundial, en vez de agotar un grupo antes del siguiente
    const schedules = members.map(roundRobin);
    const days = Math.max(...schedules.map((s) => s.length));
    for (let day = 0; day < days; day++) {
      for (const [g, schedule] of schedules.entries()) {
        for (const [a, b] of schedule[day] ?? []) {
          refresh();
          const w = yield { a, b, label: `Group ${GROUP_LETTERS[g]} · Matchday ${day + 1}`, notes: [record(a), record(b)] };
          wins[w]++;
          losses[w === a ? b : a]++;
          beat.set(pairKey(a, b), w);
          unplayed[g]--;
        }
      }
    }
    refresh();

    // los primeros de grupo ocupan los huecos del orden de seeds según sus
    // victorias, y el segundo de cada grupo cae en la otra mitad del cuadro
    const ranked = members.map(standings);
    const leaders = contenders(count).sort((x, y) => wins[ranked[y][0]] - wins[ranked[x][0]] || ranked[x][0] - ranked[y][0]);
    const placed = seedOrder(count).map((s) => leaders[s - 1]);
    const slots = placed.flatMap((g, m) => [ranked[g][0], ranked[placed[(m + (count >> 1)) % count]][1]]);
    const ko = bracketBlock('Knockout', slots.length, true);
    board.push(ko);
    return yield* knockout(slots, ko);
  },
};
