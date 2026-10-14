import { describe, it, expect } from 'vitest';
import {
  FORMATS, drawOrder, groupCount, maxPlayoffCut, replay, roundRobin, seedOrder, swissRounds, upsets,
  type BracketBlock, type Played, type Spec, type TablesBlock, type TournamentFormat,
} from './index';
import { powerTier } from './bracket';

// prng determinista (mulberry32) para que los torneos "al azar" sean reproducibles
function prng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// juega el torneo entero contra el generador; `choose` decide cada partido
function playOut(format: TournamentFormat, spec: Spec, choose: (a: number, b: number) => number) {
  const board: ReturnType<typeof replay>['board'] = [];
  const gen = format.run(spec, board);
  const log: Played[] = [];
  let step = gen.next();
  while (!step.done) {
    const winner = choose(step.value.a, step.value.b);
    log.push({ ...step.value, winner });
    step = gen.next(winner);
  }
  return { log, board, outcome: step.value };
}

const randomPicks = (seed: number) => {
  const rand = prng(seed);
  return (a: number, b: number) => (rand() < 0.5 ? a : b);
};
const chalk = (a: number, b: number) => Math.min(a, b);
const losses = (log: Played[], c: number) => log.filter((p) => (p.a === c || p.b === c) && p.winner !== c).length;
const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

describe('seedOrder', () => {
  it('espeja los cabezas de serie para que no se crucen hasta el final', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(2)).toEqual([1, 2]);
  });
});

describe('drawOrder', () => {
  const rand = prng(7);

  it('seeded deja el ranking intacto', () => {
    expect(drawOrder(8, 'seeded', powerTier)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('pots solo baraja dentro de cada bombo', () => {
    for (const tierOf of [powerTier, (i: number) => Math.floor(i / 4)]) {
      const order = drawOrder(32, 'pots', tierOf, rand);
      expect([...order].sort((a, b) => a - b)).toEqual([...Array(32).keys()]);
      order.forEach((ranked, pos) => expect(tierOf(ranked)).toBe(tierOf(pos)));
    }
  });

  it('random es una permutación', () => {
    const order = drawOrder(16, 'random', powerTier, rand);
    expect(new Set(order).size).toBe(16);
  });
});

describe('knockout', () => {
  it('siempre son n-1 elecciones, con byes o sin ellos', () => {
    for (const n of [2, 5, 8, 13, 64]) {
      expect(playOut(FORMATS.knockout, { n, playoffCut: 0 }, randomPicks(n)).log).toHaveLength(n - 1);
    }
  });

  it('a favor de los datos gana el primer seed y el segundo es finalista', () => {
    const { outcome } = playOut(FORMATS.knockout, { n: 16, playoffCut: 0 }, chalk);
    expect(outcome).toEqual({ champion: 0, runnerUp: 1 });
  });
});

describe('double elimination', () => {
  it('todos menos el campeón caen con exactamente dos derrotas', () => {
    for (const n of [3, 5, 8, 13, 16]) {
      for (let seed = 1; seed <= 20; seed++) {
        const { log, outcome } = playOut(FORMATS.double, { n, playoffCut: 0 }, randomPicks(seed * n));
        const champion = outcome.champion as number;
        expect(losses(log, champion)).toBeLessThanOrEqual(1);
        for (let c = 0; c < n; c++) if (c !== champion) expect(losses(log, c)).toBe(2);
        // cada partido reparte una derrota: 2(n-1) más la del campeón si hubo reset
        expect(log).toHaveLength(2 * (n - 1) + losses(log, champion));
      }
    }
  });

  it('el reset de la gran final solo existe si gana el que viene de perdedores', () => {
    const top = (a: number, b: number) => (a < b ? a : b);
    const { board } = playOut(FORMATS.double, { n: 8, playoffCut: 0 }, top);
    const final = board[2] as BracketBlock;
    expect(final.columns).toHaveLength(1);
    expect(final.champion).toBe(0);
  });
});

describe('groups', () => {
  it('roundRobin cruza a todos una sola vez', () => {
    for (const k of [3, 4, 5, 6]) {
      const pairs = roundRobin([...Array(k).keys()]).flat();
      expect(pairs).toHaveLength((k * (k - 1)) / 2);
      expect(new Set(pairs.map(([a, b]) => pairKey(a, b))).size).toBe(pairs.length);
    }
    // con el sorteo intacto, los dos primeros del grupo se cruzan en la última jornada
    expect(roundRobin([0, 1, 2, 3]).at(-1)).toContainEqual([0, 1]);
  });

  it('grupos de al menos tres y potencia de dos', () => {
    expect([4, 8, 13, 16, 32, 64].map(groupCount)).toEqual([1, 2, 4, 4, 8, 16]);
  });

  it('liguilla completa y los de un mismo grupo solo pueden verse en la final', () => {
    for (const n of [8, 13, 16, 32]) {
      const { log, board } = playOut(FORMATS.groups, { n, playoffCut: 0 }, randomPicks(n));
      const groups = (board[0] as TablesBlock).tables.map((t) => t.rows.map((r) => r.c));
      const groupOf = new Map(groups.flatMap((g, i) => g.map((c) => [c, i] as const)));
      const groupMatches = groups.reduce((sum, g) => sum + (g.length * (g.length - 1)) / 2, 0);
      expect(log).toHaveLength(groupMatches + groups.length * 2 - 1);

      const ko = board[1] as BracketBlock;
      const firstRound = ko.columns[0].matches;
      const half = firstRound.length / 2;
      // ganador contra segundo, nunca del mismo grupo, y cada grupo partido entre las dos mitades
      firstRound.forEach((m, j) => {
        expect(groupOf.get(m.a!)).not.toBe(groupOf.get(m.b!));
        const twin = firstRound.findIndex((o) => groupOf.get(o.b!) === groupOf.get(m.a!));
        expect(j < half).not.toBe(twin < half);
      });
    }
  });
});

describe('swiss', () => {
  it('rondas y cortes según el tamaño del campo', () => {
    expect([8, 13, 16, 64].map(swissRounds)).toEqual([3, 4, 4, 6]);
    expect([4, 8, 13, 16, 64].map(maxPlayoffCut)).toEqual([2, 4, 4, 8, 32]);
  });

  it('la primera ronda cruza la mitad alta contra la baja', () => {
    const { log } = playOut(FORMATS.swiss, { n: 16, playoffCut: 8 }, chalk);
    expect(log.slice(0, 8).map((p) => [p.a, p.b])).toEqual([...Array(8).keys()].map((i) => [i, i + 8]));
  });

  it('nunca repite cruce en la fase suiza y el playoff es del corte', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { log, board } = playOut(FORMATS.swiss, { n: 16, playoffCut: 8 }, randomPicks(seed));
      const swiss = log.filter((p) => p.label.startsWith('Swiss'));
      expect(swiss).toHaveLength(4 * 8);
      expect(new Set(swiss.map((p) => pairKey(p.a, p.b))).size).toBe(swiss.length);
      expect(log).toHaveLength(32 + 7);
      expect((board[1] as BracketBlock).columns[0].matches).toHaveLength(4);
    }
  });

  it('con impares cada ronda descansa uno distinto y el descanso suma victoria', () => {
    const n = 13;
    const { log, board } = playOut(FORMATS.swiss, { n, playoffCut: 0 }, randomPicks(3));
    expect(log).toHaveLength(swissRounds(n) * 6);
    const rows = (board[0] as TablesBlock).tables[0].rows;
    const games = rows.map((r) => r.cells[0].split('–').map(Number).reduce((x, y) => x + y));
    expect(games.every((g) => g === swissRounds(n))).toBe(true);
    expect(board).toHaveLength(1);
  });
});

describe('king of the hill', () => {
  it('n-1 retadores y el primero del sorteo llega al final', () => {
    const { log, outcome } = playOut(FORMATS.koth, { n: 8, playoffCut: 0 }, randomPicks(5));
    expect(log).toHaveLength(7);
    expect(log.at(-1)?.b).toBe(0);
    expect(outcome.champion).toBe(log.at(-1)?.winner);
  });

  it('si el trono no cae, el que lo abrió es campeón', () => {
    const holder = (a: number) => a;
    expect(playOut(FORMATS.koth, { n: 6, playoffCut: 0 }, holder).outcome.champion).toBe(5);
  });
});

describe('replay', () => {
  const spec = { n: 16, playoffCut: 8 };

  it('deshacer es quitar el último ganador', () => {
    for (const format of Object.values(FORMATS)) {
      const { log } = playOut(format, spec, randomPicks(11));
      const winners = log.map((p) => p.winner);
      const mid = Math.floor(winners.length / 2);
      const before = replay(format, spec, winners.slice(0, mid));
      expect(before.pending?.a).toBe(log[mid].a);
      expect(before.pending?.b).toBe(log[mid].b);
      const done = replay(format, spec, winners);
      expect(done.pending).toBeNull();
      expect(done.total).toBe(log.length);
      // a mitad de torneo el total no cuenta un reset que aún no ha ocurrido
      const resets = log.filter((p) => p.label.endsWith('reset')).length;
      expect(before.total).toBe(log.length - resets);
    }
  });

  it('un ganador que no juega ese partido corta la repetición', () => {
    const state = replay(FORMATS.knockout, spec, [0, 99, 1]);
    expect(state.log).toHaveLength(1);
  });

  it('el reset de la doble suma un partido al total en cuanto ocurre', () => {
    const format = FORMATS.double;
    const base = { n: 4, playoffCut: 0 };
    const { log } = playOut(format, base, chalk);
    const beforeFinal = log.slice(0, -1).map((p) => p.winner);
    const final = replay(format, base, beforeFinal).pending!;
    expect(replay(format, base, beforeFinal).total).toBe(6);
    expect(replay(format, base, [...beforeFinal, final.b]).total).toBe(7);
  });
});

describe('upsets', () => {
  it('cuenta las elecciones a favor del peor seed', () => {
    const log: Played[] = [
      { a: 0, b: 1, label: 'x', winner: 1 },
      { a: 2, b: 3, label: 'y', winner: 2 },
    ];
    expect(upsets(log, (c) => c + 1)).toEqual([{ winner: 1, loser: 0, label: 'x', gap: 1 }]);
  });
});
