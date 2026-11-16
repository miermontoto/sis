import { describe, it, expect } from 'vitest';
import type { Accolade } from '$lib/api';
import { alignTimelines, canonicalArtistId, leadHistory, leaderOf, listeningSplit, pickedVersusHref, placeTimelineLabels, recordRows, versusHref, versusRow, yearTicks, VERSUS_NO_VALUE } from './artist-versus';

const NOW = new Date('2026-03-15T12:00:00Z');
const month = (period: string, play_count: number, total_ms = play_count * 1000) => ({ period, play_count, total_ms });
const accolade = (type: string, rank: number, value = 1, year: number | null = null): Accolade => ({ type, rank, value, week: null, year });

describe('versusHref', () => {
  it('escapa los ids sintéticos', () => {
    expect(versusHref('import:abc', 'x y')).toBe('/artist/import%3Aabc/vs/x%20y');
  });

  it('el artista conservado sigue en su lado', () => {
    expect(pickedVersusHref({ id: 'kept', side: 'a' }, 'new')).toBe('/artist/kept/vs/new');
    expect(pickedVersusHref({ id: 'kept', side: 'b' }, 'new')).toBe('/artist/new/vs/kept');
  });
});

describe('canonicalArtistId', () => {
  const relation = (kind: 'alias' | 'absorbed' | 'related', id: string) =>
    ({ kind, id, name: id, imageUrl: null, ruleIds: [1], playCount: 0, totalMs: 0 });
  const artist = { id: 'me', name: 'me', imageUrl: null, backgroundUrl: null, genres: [] };

  it('un alias resuelve al canónico de su merge', () => {
    expect(canonicalArtistId({ artist, relations: [relation('alias', 'target')] })).toBe('target');
  });

  it('absorber o estar relacionado no cambia quién eres', () => {
    expect(canonicalArtistId({ artist, relations: [relation('absorbed', 'x'), relation('related', 'y')] })).toBe('me');
  });
});

describe('leaderOf', () => {
  it('gana la cifra mayor', () => {
    expect(leaderOf(5, 3)).toBe('a');
    expect(leaderOf(3, 5)).toBe('b');
  });

  it('en un ranking gana la cifra menor', () => {
    expect(leaderOf(5, 3, 'lower')).toBe('b');
    expect(leaderOf(3, 5, 'lower')).toBe('a');
  });

  it('un empate no es de nadie', () => {
    expect(leaderOf(4, 4)).toBeNull();
    expect(leaderOf(0, 0)).toBeNull();
  });

  it('tener cifra gana a no tenerla, sea cual sea el sentido', () => {
    expect(leaderOf(9, null, 'lower')).toBe('a');
    expect(leaderOf(null, 9, 'lower')).toBe('b');
    expect(leaderOf(null, undefined)).toBeNull();
  });
});

describe('versusRow', () => {
  it('formatea sólo lo que existe', () => {
    expect(versusRow('r', 'Rank', 3, null, v => `#${v}`, 'lower')).toEqual({ key: 'r', label: 'Rank', a: '#3', b: VERSUS_NO_VALUE, leader: 'a' });
  });
});

describe('listeningSplit', () => {
  it('los plays compartidos cuentan una sola vez', () => {
    expect(listeningSplit(100, 40, 10)).toEqual({ a: 90, together: 10, b: 30, total: 130 });
  });

  it('sin nada compartido el total es la suma', () => {
    expect(listeningSplit(100, 40, 0)).toEqual({ a: 100, together: 0, b: 40, total: 140 });
  });

  it('todo lo de uno es compartido: colaborador que nunca suena solo', () => {
    expect(listeningSplit(100, 40, 40)).toEqual({ a: 60, together: 40, b: 0, total: 100 });
  });

  it('un overlap más nuevo que el detalle cacheado no da negativos', () => {
    const split = listeningSplit(100, 40, 50);
    expect(split.b).toBe(0);
    expect(split.a).toBe(60);
  });
});

describe('alignTimelines', () => {
  it('los dos van sobre los mismos meses aunque empiecen en fechas distintas', () => {
    const { a, b } = alignTimelines(
      { series: [month('2026-01', 2)], rankHistory: [] },
      { series: [month('2025-12', 1)], rankHistory: [] },
      NOW,
    );
    expect(a.map(m => m.key)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
    expect(b.map(m => m.key)).toEqual(a.map(m => m.key));
  });

  it('antes de su primer play un artista no tiene acumulado ni posición', () => {
    const { a } = alignTimelines(
      { series: [month('2026-01', 2)], rankHistory: [{ period: '2026-01', rank: 4 }] },
      { series: [month('2025-12', 1)], rankHistory: [] },
      NOW,
    );
    expect(a[0]).toMatchObject({ key: '2025-12', plays: 0, cumPlays: 0, rank: null });
    expect(a[1]).toMatchObject({ key: '2026-01', plays: 2, cumPlays: 2, rank: 4 });
  });

  it('la fila a cero no pisa el dato real del primer mes', () => {
    const { a } = alignTimelines(
      { series: [month('2026-01', 7)], rankHistory: [] },
      { series: [month('2026-02', 1)], rankHistory: [] },
      NOW,
    );
    expect(a[0].plays).toBe(7);
  });

  it('arrastra acumulado y posición por los meses sin escuchas', () => {
    const { a } = alignTimelines(
      { series: [month('2026-01', 2)], rankHistory: [{ period: '2026-01', rank: 4 }] },
      { series: [], rankHistory: [] },
      NOW,
    );
    expect(a.at(-1)).toMatchObject({ key: '2026-03', plays: 0, cumPlays: 2, rank: 4 });
  });

  it('sin datos no hay calendario', () => {
    const empty = { series: [], rankHistory: [] };
    expect(alignTimelines(empty, empty, NOW)).toEqual({ a: [], b: [] });
  });

  it('un lado sin escuchas se queda en cero todo el eje', () => {
    const { a, b } = alignTimelines({ series: [month('2026-02', 3)], rankHistory: [] }, { series: [], rankHistory: [] }, NOW);
    expect(b.map(m => m.cumPlays)).toEqual([0, 0]);
    expect(a.map(m => m.cumPlays)).toEqual([3, 3]);
  });
});

describe('leadHistory', () => {
  const lines = (a: [string, number][], b: [string, number][]) =>
    alignTimelines(
      { series: a.map(([p, n]) => month(p, n)), rankHistory: [] },
      { series: b.map(([p, n]) => month(p, n)), rankHistory: [] },
      new Date('2026-04-15T00:00:00Z'),
    );

  it('ponerse primero al empezar no es adelantar a nadie', () => {
    const { a, b } = lines([['2026-01', 5]], [['2026-02', 1]]);
    expect(leadHistory(a, b, 'plays')).toMatchObject({ leader: 'a', since: '2026-01', changes: [] });
  });

  it('registra cada adelantamiento y la racha actual', () => {
    const { a, b } = lines(
      [['2026-01', 5], ['2026-04', 10]],
      [['2026-02', 8]],
    );
    expect(leadHistory(a, b, 'plays')).toMatchObject({
      leader: 'a',
      since: '2026-04',
      changes: [{ month: '2026-02', index: 1, leader: 'b' }, { month: '2026-04', index: 3, leader: 'a' }],
    });
  });

  it('los tramos cubren el eje sin huecos desde el primero que se pone delante', () => {
    const { a, b } = lines(
      [['2026-01', 5], ['2026-04', 10]],
      [['2026-02', 8]],
    );
    expect(leadHistory(a, b, 'plays').spans).toEqual([
      { leader: 'a', start: 0, end: 1 },
      { leader: 'b', start: 1, end: 3 },
      { leader: 'a', start: 3, end: 4 },
    ]);
  });

  it('sin adelantamientos hay un solo tramo hasta el final del eje', () => {
    const { a, b } = lines([['2026-01', 5]], [['2026-02', 1]]);
    expect(leadHistory(a, b, 'plays').spans).toEqual([{ leader: 'a', start: 0, end: 4 }]);
  });

  it('un tramo no empieza hasta que alguien se pone delante', () => {
    const { a, b } = lines([['2026-01', 5], ['2026-03', 1]], [['2026-01', 5]]);
    expect(leadHistory(a, b, 'plays').spans).toEqual([{ leader: 'a', start: 2, end: 4 }]);
  });

  it('un mes empatado no cambia al que iba delante', () => {
    const { a, b } = lines(
      [['2026-01', 5], ['2026-03', 1]],
      [['2026-02', 5]],
    );
    // ene 5-0 · feb 5-5 (empate) · mar 6-5: siempre a
    expect(leadHistory(a, b, 'plays')).toMatchObject({ leader: 'a', since: '2026-01', changes: [] });
  });

  it('se calcula sobre la métrica elegida: se puede ir delante en plays y detrás en tiempo', () => {
    const { a, b } = alignTimelines(
      { series: [month('2026-01', 10, 1000)], rankHistory: [] },
      { series: [month('2026-01', 2, 9000)], rankHistory: [] },
      NOW,
    );
    expect(leadHistory(a, b, 'plays').leader).toBe('a');
    expect(leadHistory(a, b, 'time').leader).toBe('b');
  });

  it('empatados de principio a fin no lidera nadie', () => {
    const { a, b } = lines([['2026-01', 5]], [['2026-01', 5]]);
    expect(leadHistory(a, b, 'plays')).toEqual({ leader: null, since: null, changes: [], spans: [] });
  });
});

describe('placeTimelineLabels', () => {
  const WIDTH = 100;
  const GAP = 10;
  const place = (offsets: number[], track = 1000) => placeTimelineLabels(offsets, track, WIDTH, GAP);
  const lanes = (offsets: number[], track = 1000) => place(offsets, track).map(p => p.lane);
  const boxes = (offsets: number[], track: number) => place(offsets, track).map((p, i) => ({
    ...p,
    x: offsets[i],
    start: p.flip ? offsets[i] - p.width : offsets[i],
    end: p.flip ? offsets[i] : offsets[i] + p.width,
  }));
  type Box = ReturnType<typeof boxes>[number];
  // el tallo de x sube hasta la banda: cruza a y si y está más arriba y le cae dentro
  const crosses = (x: Box, y: Box) => y.lane < x.lane && x.x > y.start && x.x < y.end;
  const worstCase = [3, 8, 14, 20, 30, 41, 120, 190, 250, 300, 318];

  it('etiquetas separadas comparten el primer carril', () => {
    expect(lanes([0, 200, 400])).toEqual([0, 0, 0]);
  });

  it('en un racimo el último va arriba y los anteriores más abajo', () => {
    expect(lanes([0, 50, 100])).toEqual([2, 1, 0]);
  });

  it('una etiqueta aislada no baja por culpa de un racimo anterior', () => {
    expect(lanes([0, 50, 800])).toEqual([1, 0, 0]);
  });

  it('el hueco cuenta: justo al límite cabe, un píxel menos no', () => {
    expect(lanes([0, 110])).toEqual([0, 0]);
    expect(lanes([0, 109])).toEqual([1, 0]);
  });

  it('una anterior no vuelve a un hueco de arriba si la siguiente quedó más abajo', () => {
    // el primer hueco libre pondría 0 en el carril 0, encima de 100, cuyo tallo la cruzaría
    const offsets = [0, 100, 200];
    expect(lanes(offsets)).toEqual([2, 1, 0]);
    const placed = boxes(offsets, 1000);
    expect(placed.flatMap(x => placed.filter(y => crosses(x, y)))).toEqual([]);
  });

  it('cerca del borde derecho crece hacia la izquierda', () => {
    expect(place([100, 950]).map(p => p.flip)).toEqual([false, true]);
  });

  it('las que crecen hacia la izquierda van al revés: la primera arriba', () => {
    expect(lanes([910, 950, 990])).toEqual([0, 1, 2]);
    const placed = boxes([910, 950, 990], 1000);
    expect(placed.flatMap(x => placed.filter(y => crosses(x, y)))).toEqual([]);
  });

  it('una girada también choca por donde crece', () => {
    expect(lanes([800, 950])).toEqual([0, 1]);
  });

  it('el peor racimo real no se pisa ni cruza nada a ningún ancho que quepa', () => {
    for (const track of [320, 1000]) {
      const placed = boxes(worstCase, track);
      for (const x of placed) for (const y of placed) {
        if (x !== y && x.lane === y.lane) expect(x.end + GAP <= y.start || y.end + GAP <= x.start).toBe(true);
        if (x !== y && x.flip === y.flip) expect(crosses(x, y)).toBe(false);
      }
    }
  });

  it('en un eje más estrecho que dos etiquetas nada se sale de él', () => {
    const track = 150;
    for (const box of boxes([5, 60, 75, 90, 145], track)) {
      expect(box.start).toBeGreaterThanOrEqual(0);
      expect(box.end).toBeLessThanOrEqual(track);
    }
  });

  it('con sitio de sobra ninguna se encoge', () => {
    expect(place([0, 500, 950]).every(p => p.width === WIDTH)).toBe(true);
  });
});

describe('yearTicks', () => {
  const months = (first: string, n: number) => {
    const [y, m] = first.split('-').map(Number);
    return Array.from({ length: n }, (_, i) => {
      const date = new Date(Date.UTC(y, m - 1 + i, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    });
  };

  it('el año del primer mes y cada enero', () => {
    expect(yearTicks(months('2024-03', 24), 1000, 40)).toEqual([
      { index: 0, label: '2024' },
      { index: 10, label: '2025' },
      { index: 22, label: '2026' },
    ]);
  });

  it('un enero en el primer mes no se repite', () => {
    expect(yearTicks(months('2024-01', 13), 1000, 40).map(t => t.index)).toEqual([0, 12]);
  });

  it('un primer año de dos meses no echa al enero siguiente', () => {
    expect(yearTicks(months('2018-11', 26), 260, 40).map(t => t.label)).toEqual(['2019', '2020']);
  });

  it('un eje de unos meses sin enero enseña al menos su año', () => {
    expect(yearTicks(months('2026-03', 6), 1000, 40)).toEqual([{ index: 0, label: '2026' }]);
  });

  it('sin sitio se salta marcas en vez de pisarlas', () => {
    const ticks = yearTicks(months('2018-02', 105), 320, 40);
    const gaps = ticks.slice(1).map((t, i) => (t.index - ticks[i].index) * (320 / 105));
    expect(ticks.length).toBeLessThan(9);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(40);
  });

  it('el eje aún sin medir no revienta', () => {
    expect(yearTicks(months('2024-03', 24), 0, 40).length).toBeLessThanOrEqual(1);
  });
});

describe('recordRows', () => {
  it('una fila por record que tenga alguno de los dos', () => {
    const rows = recordRows([accolade('weeksAtNo1', 1, 5)], [accolade('longestRun', 2, 9)], 'time');
    expect(rows.map(r => r.key).sort()).toEqual(['longestRun', 'weeksAtNo1']);
    const run = rows.find(r => r.key === 'longestRun')!;
    expect(run).toMatchObject({ a: VERSUS_NO_VALUE, leader: 'b' });
    expect(run.b).toContain('9 wks');
  });

  it('gana el mejor puesto en la lista, no la cifra mayor', () => {
    const [row] = recordRows([accolade('weeksAtNo1', 2, 90)], [accolade('weeksAtNo1', 1, 3)], 'time');
    expect(row.leader).toBe('b');
  });

  it('los records van por mejor puesto y los year-end al final, del más reciente al más antiguo', () => {
    const rows = recordRows(
      [accolade('yearEnd', 1, 1, 2020), accolade('longestRun', 9), accolade('yearEnd', 3, 1, 2024)],
      [accolade('weeksAtNo1', 2), accolade('yearEnd', 2, 1, 2020)],
      'time',
    );
    expect(rows.map(r => r.key)).toEqual(['weeksAtNo1', 'longestRun', 'yearEnd:2024', 'yearEnd:2020']);
    expect(rows.find(r => r.key === 'yearEnd:2020')).toMatchObject({ label: '2020 year-end', leader: 'a' });
  });

  it('sin records no hay filas', () => {
    expect(recordRows([], [], 'plays')).toEqual([]);
  });
});
