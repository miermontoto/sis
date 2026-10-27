import { bracketBlock, contenders, knockout, nextPow2, powerTier, seededSlots } from './bracket';
import type { TablesBlock, TournamentFormat } from './types';

// victorias para pasar y derrotas para caer: 3 es el estándar de los suizos de
// esports (majors de cs, worlds de lol); con menos de 16 baja solo
const MAX_TARGET = 3;

// con menos el umbral sería 1 y el suizo, una ronda de eliminación directa
const MIN_ENTRIES = 8;

// tope de nodos del backtracking: con 64 entradas sobra; si se agota, se admite
// repetir cruce antes que bloquear el torneo
const PAIRING_BUDGET = 20_000;

// umbral del suizo según el campo. Simétrico a propósito: cada uno juega hasta
// decidir su suerte, nunca un partido muerto, y con un campo potencia de dos
// pasa justo la mitad
export const swissTarget = (n: number): number => Math.min(Math.max(Math.floor(Math.log2(n)) - 1, 1), MAX_TARGET);

type Met = (a: number, b: number) => boolean;

// emparejamiento holandés de un grupo de récord con backtracking: cada uno
// contra su espejo (mitad alta contra mitad baja) y, si ya se vieron, contra el
// más cercano. Nunca repite cruce salvo que no quede otra. Con impares sobra
// uno, el más bajo que deje al resto sin repetir cruce
function pairGroup(pool: number[], met: Met): { pairs: [number, number][]; float: number | null } {
  let budget = PAIRING_BUDGET;
  const solve = (rest: number[], rematches: boolean): [number, number][] | null => {
    if (rest.length === 0) return [];
    if (--budget < 0) return null;
    const [p, ...others] = rest;
    const mirror = Math.max(Math.floor((others.length + 1) / 2) - 1, 0);
    for (const q of [...others.slice(mirror), ...others.slice(0, mirror).reverse()]) {
      if (!rematches && met(p, q)) continue;
      const tail = solve(others.filter((o) => o !== q), rematches);
      if (tail) return [[p, q], ...tail];
      if (budget < 0) return null;
    }
    return null;
  };
  const floats = pool.length % 2 ? [...pool].reverse() : [null];
  for (const rematches of [false, true]) {
    budget = PAIRING_BUDGET;
    for (const float of floats) {
      const pairs = solve(pool.filter((c) => c !== float), rematches);
      if (pairs) return { pairs, float };
    }
  }
  // con cruces repetidos siempre hay solución; esto solo cubre un presupuesto agotado
  return { pairs: [], float: null };
}

// empareja récord a récord, de arriba abajo: nadie cruza de grupo salvo el que
// sobra de un grupo impar, que baja al siguiente
export const pairSwiss = (groups: number[][], met: Met): [number, number][] =>
  groups.reduce<{ pairs: [number, number][]; carry: number[] }>((acc, group) => {
    const { pairs, float } = pairGroup([...acc.carry, ...group], met);
    return { pairs: [...acc.pairs, ...pairs], carry: float === null ? [] : [float] };
  }, { pairs: [], carry: [] }).pairs;

const isPow2 = (n: number) => nextPow2(n) === n;

export const swissFormat: TournamentFormat = {
  id: 'swiss',
  label: 'Swiss',
  board: 'standings',
  minEntries: MIN_ENTRIES,
  tierOf: powerTier,
  byes: () => 0,
  describe: ({ n }) => {
    const target = swissTarget(n);
    const through = isPow2(n) ? `the ${n / 2} who get through` : 'those who get through (about half the field)';
    const sitOut = isPow2(n) ? '' : ' Whenever the live field is odd, one entry sits out the round and banks the win.';
    return `${target} wins and you're through, ${target} losses and you're out, always against an entry on the same record; ${through} play a knockout seeded by record.${sitOut}`;
  },
  *run({ n }, board) {
    const ids = contenders(n);
    const target = swissTarget(n);
    // cada ronda acerca a todos los vivos a uno de los dos umbrales
    const rounds = 2 * target - 1;
    const wins = new Array<number>(n).fill(0);
    const losses = new Array<number>(n).fill(0);
    const met = ids.map(() => new Set<number>());
    const rested = new Set<number>();
    const alive = (c: number) => wins[c] < target && losses[c] < target;
    const record = (c: number) => `${wins[c]}–${losses[c]}`;
    // lo que se juega cada lado: a una victoria de pasar, a una derrota de caer, o las dos
    const stake = (c: number) => {
      const up = wins[c] === target - 1;
      const down = losses[c] === target - 1;
      return up && down ? 'decider' : up ? 'win and in' : down ? 'lose and out' : '';
    };
    const note = (c: number) => [record(c), stake(c)].filter(Boolean).join(' · ');
    // buchholz: victorias sumadas de los rivales, mide lo duro que fue el camino
    const buchholz = (c: number) => [...met[c]].reduce((sum, o) => sum + wins[o], 0);
    // por récord (3–0 antes que 3–1) y, dentro de cada récord, por buchholz
    const standings = () => [...ids].sort((x, y) => wins[y] - wins[x] || losses[x] - losses[y] || buchholz(y) - buchholz(x) || x - y);

    const table: TablesBlock = { kind: 'tables', title: 'Standings', headers: ['W–L', 'Buch.'], tables: [{ title: '', rows: [] }] };
    const refresh = () => {
      table.tables[0].rows = standings().map((c) => ({
        c, cells: [record(c), String(buchholz(c))], qualified: wins[c] >= target, eliminated: losses[c] >= target,
      }));
    };
    board.push(table);

    for (let round = 0; ids.some(alive); round++) {
      const live = ids.filter(alive).sort((x, y) => wins[y] - wins[x] || x - y);
      // con impares descansa el último que aún no lo haya hecho, y el descanso cuenta como victoria
      const bye = live.length % 2 ? ([...live].reverse().find((c) => !rested.has(c)) ?? live[live.length - 1]) : undefined;
      if (bye !== undefined) {
        rested.add(bye);
        wins[bye]++;
      }
      // todos los vivos llevan los mismos partidos, así que las victorias fijan el récord
      const groups = live
        .filter((c) => c !== bye)
        .reduce((acc, c) => acc.set(wins[c], [...(acc.get(wins[c]) ?? []), c]), new Map<number, number[]>());
      for (const [a, b] of pairSwiss([...groups.values()], (x, y) => met[x].has(y))) {
        refresh();
        const w = yield { a, b, label: `Swiss · Round ${round + 1} of ${rounds}`, notes: [note(a), note(b)] };
        wins[w]++;
        losses[w === a ? b : a]++;
        met[a].add(b);
        met[b].add(a);
      }
    }
    refresh();

    // los clasificados entran sembrados por su récord: los 3–0 lejos entre sí
    const slots = seededSlots(standings().filter((c) => wins[c] >= target));
    const playoff = bracketBlock('Playoff', slots.length, true);
    board.push(playoff);
    return yield* knockout(slots, playoff, 'Playoff');
  },
};
