import { bracketBlock, contenders, knockout, powerTier, seededSlots } from './bracket';
import type { TablesBlock, TournamentFormat } from './types';

// cortes de playoff que ofrece la ui (0 = suizo puro, decide la clasificación)
export const PLAYOFF_CUTS = [0, 4, 8, 16] as const;

// tope de nodos del backtracking: con 64 entradas y seis rondas sobra; si se
// agota, se admite repetir cruce antes que bloquear el torneo
const PAIRING_BUDGET = 20_000;

// el corte no pasa de la mitad del campo, o el suizo no filtraría nada
export const maxPlayoffCut = (n: number): number => (n < 4 ? 0 : 2 ** Math.floor(Math.log2(n / 2)));

// las rondas justas para que, sin empates, quede un único invicto
export const swissRounds = (n: number): number => Math.ceil(Math.log2(Math.max(n, 2)));

// emparejamiento holandés con backtracking sobre `pool` (ordenado por puntos y
// sorteo): cada uno contra su espejo dentro de su grupo de puntuación (mitad
// alta contra mitad baja), si no se puede contra el vecino más cercano de su
// grupo, y si no contra los grupos de abajo. Nunca repite cruce salvo que no
// quede otra
export function pairSwiss(
  pool: number[],
  score: (c: number) => number,
  met: (a: number, b: number) => boolean,
): [number, number][] {
  let budget = PAIRING_BUDGET;
  const candidates = (p: number, others: number[]): number[] => {
    const same = others.filter((o) => score(o) === score(p));
    const mirror = Math.max(Math.floor((same.length + 1) / 2) - 1, 0);
    return [...same.slice(mirror), ...same.slice(0, mirror).reverse(), ...others.filter((o) => score(o) !== score(p))];
  };
  const solve = (rest: number[], rematches: boolean): [number, number][] | null => {
    if (rest.length < 2) return [];
    if (--budget < 0) return null;
    const [p, ...others] = rest;
    for (const q of candidates(p, others)) {
      if (!rematches && met(p, q)) continue;
      const tail = solve(others.filter((o) => o !== q), rematches);
      if (tail) return [[p, q], ...tail];
      if (budget < 0) return null;
    }
    return null;
  };
  const clean = solve(pool, false);
  if (clean) return clean;
  budget = PAIRING_BUDGET;
  return solve(pool, true) ?? [];
}

export const swissFormat: TournamentFormat = {
  id: 'swiss',
  label: 'Swiss',
  board: 'standings',
  minEntries: 4,
  tierOf: powerTier,
  byes: () => 0,
  describe: ({ n, playoffCut }) => {
    const cut = Math.min(playoffCut, maxPlayoffCut(n));
    const finish = cut ? `then the top ${cut} play a knockout for the title` : 'the final standings decide the champion';
    const sitOut = n % 2 ? ' With an odd field, one entry sits out each round and banks the win.' : '';
    return `${swissRounds(n)} rounds, each pairing entries on the same record without rematches; ${finish}.${sitOut}`;
  },
  *run({ n, playoffCut }, board) {
    const ids = contenders(n);
    const rounds = swissRounds(n);
    const cut = Math.min(playoffCut, maxPlayoffCut(n));
    const wins = new Array<number>(n).fill(0);
    const losses = new Array<number>(n).fill(0);
    const met = ids.map(() => new Set<number>());
    const rested = new Set<number>();
    const record = (c: number) => `${wins[c]}–${losses[c]}`;
    // buchholz: victorias sumadas de los rivales, mide lo duro que fue el camino
    const buchholz = (c: number) => [...met[c]].reduce((sum, o) => sum + wins[o], 0);
    const standings = () => [...ids].sort((x, y) => wins[y] - wins[x] || buchholz(y) - buchholz(x) || x - y);

    const table: TablesBlock = { kind: 'tables', title: 'Standings', headers: ['W–L', 'Buch.'], tables: [{ title: '', rows: [] }] };
    let stageDone = false;
    const refresh = () => {
      table.tables[0].rows = standings().map((c, pos) => ({
        c, cells: [record(c), String(buchholz(c))], qualified: stageDone && pos < cut,
      }));
    };
    board.push(table);

    for (let round = 0; round < rounds; round++) {
      const order = [...ids].sort((x, y) => wins[y] - wins[x] || x - y);
      // con impares descansa el último que aún no lo haya hecho, y el descanso cuenta como victoria
      const bye = n % 2 ? [...order].reverse().find((c) => !rested.has(c)) : undefined;
      if (bye !== undefined) {
        rested.add(bye);
        wins[bye]++;
      }
      const pairs = pairSwiss(order.filter((c) => c !== bye), (c) => wins[c], (a, b) => met[a].has(b));
      for (const [a, b] of pairs) {
        refresh();
        const w = yield { a, b, label: `Swiss · Round ${round + 1} of ${rounds}`, notes: [record(a), record(b)] };
        wins[w]++;
        losses[w === a ? b : a]++;
        met[a].add(b);
        met[b].add(a);
      }
    }
    stageDone = true;
    refresh();

    const final = standings();
    if (!cut) return { champion: final[0], runnerUp: final[1] ?? null };
    const playoff = bracketBlock('Playoff', cut, true);
    board.push(playoff);
    return yield* knockout(seededSlots(final.slice(0, cut)), playoff, 'Playoff');
  },
};
