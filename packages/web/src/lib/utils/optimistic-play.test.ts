import { describe, it, expect, vi } from 'vitest';

// el módulo importa invalidateCache para la mitad "confirmada"; aquí sólo se
// prueban las funciones puras, así que basta con no arrastrar el cliente real
vi.mock('$lib/api', () => ({ invalidateCache: vi.fn() }));

import { applyPlayToTopRows, applyPlayToChart, rankMoves } from './optimistic-play';
import type { ChartEntry, ChartResponse } from '$lib/api';

function row(id: string, playCount: number, totalMs: number, previousRank: number | null = null) {
  return { id, playCount, totalMs, previousRank, rankChange: null as number | null };
}

const idOf = (r: { id: string }) => r.id;

describe('applyPlayToTopRows', () => {
  it('suma el play a la fila objetivo y reordena por tiempo', () => {
    const rows = [row('a', 10, 100_000), row('b', 9, 90_000)];
    const next = applyPlayToTopRows(rows, idOf, ['b'], 30_000, 'time');

    expect(next.map(idOf)).toEqual(['b', 'a']);
    expect(next[0].totalMs).toBe(120_000);
    expect(next[0].playCount).toBe(10);
  });

  it('ordena por plays cuando la métrica es plays, no por tiempo', () => {
    // 'b' gana en tiempo pero sigue por detrás en número de reproducciones
    const rows = [row('a', 10, 100_000), row('b', 9, 99_000)];
    const next = applyPlayToTopRows(rows, idOf, ['b'], 30_000, 'plays');

    expect(next.map(idOf)).toEqual(['a', 'b']);
  });

  it('devuelve la misma referencia si el play no toca nada visible', () => {
    const rows = [row('a', 10, 100_000)];
    expect(applyPlayToTopRows(rows, idOf, ['z'], 30_000, 'time')).toBe(rows);
    expect(applyPlayToTopRows(rows, idOf, [], 30_000, 'time')).toBe(rows);
  });

  it('rehace el delta de puesto tras el reordenamiento', () => {
    // 'b' estaba 2ª en el periodo de lookback y adelanta a 'a': el delta pintado
    // tiene que contar esa subida, no quedarse en el que trajo el servidor
    const rows = [row('a', 10, 100_000, 1), row('b', 9, 90_000, 2)];
    const next = applyPlayToTopRows(rows, idOf, ['b'], 30_000, 'time');

    expect(next[0].id).toBe('b');
    expect(next[0].rankChange).toBe(1); // previousRank 2 → puesto 1
    expect(next[1].rankChange).toBe(-1); // previousRank 1 → puesto 2
  });

  it('deja el delta a null cuando no hay lookback', () => {
    const rows = [row('a', 10, 100_000), row('b', 9, 90_000)];
    const next = applyPlayToTopRows(rows, idOf, ['b'], 30_000, 'time');
    expect(next.every(r => r.rankChange === null)).toBe(true);
  });

  it('cuenta un solo play aunque el mismo id aparezca repetido en los targets', () => {
    const rows = [row('a', 10, 100_000)];
    const next = applyPlayToTopRows(rows, idOf, ['a', 'a'], 30_000, 'time');
    expect(next[0].playCount).toBe(11);
    expect(next[0].totalMs).toBe(130_000);
  });
});

function entry(entityId: string, plays: number, totalMs: number, rank: number, previousRank: number | null = null): ChartEntry {
  return {
    rank, entityId, name: entityId, imageUrl: null, artistName: null, artistId: null,
    artists: [], plays, totalMs, previousRank, rankChange: null, isNew: false,
    isReentry: false, peakRank: rank, peakPeriod: '2026-W01', peakPeriods: [],
    timesAtPeak: 1, weeksOnChart: 1, consecutiveWeeks: 1,
  };
}

describe('applyPlayToChart', () => {
  it('reordena y renumera los puestos del periodo', () => {
    const chart: ChartResponse = {
      period: '2026-W22',
      entries: [entry('a', 10, 100_000, 1), entry('b', 9, 90_000, 2)],
      dropouts: [],
    };
    const next = applyPlayToChart(chart, ['b'], 30_000, 'time');

    expect(next.entries.map(e => e.entityId)).toEqual(['b', 'a']);
    expect(next.entries.map(e => e.rank)).toEqual([1, 2]);
    expect(next.entries[0].plays).toBe(10);
  });

  it('devuelve la misma referencia si la entidad no está en el chart', () => {
    const chart: ChartResponse = { period: '2026-W22', entries: [entry('a', 10, 100_000, 1)], dropouts: [] };
    expect(applyPlayToChart(chart, ['z'], 30_000, 'time')).toBe(chart);
  });
});

describe('rankMoves', () => {
  it('marca a la que sube Y a las que adelanta', () => {
    // el play sube a 'c' dos puestos; 'a' y 'b' bajan uno cada una, y las tres
    // se han movido de verdad: la flecha va en todas
    const moves = rankMoves(['a', 'b', 'c', 'd'], ['c', 'a', 'b', 'd']);
    expect(moves.get('c')).toBe(2);
    expect(moves.get('a')).toBe(-1);
    expect(moves.get('b')).toBe(-1);
    expect(moves.has('d')).toBe(false);
  });

  it('sin reordenamiento no hay ninguna flecha', () => {
    expect(rankMoves(['a', 'b', 'c'], ['a', 'b', 'c']).size).toBe(0);
  });

  it('ignora lo que no tenía puesto previo', () => {
    // una relectura puede meter filas nuevas: sin puesto anterior no hay delta
    const moves = rankMoves(['a', 'b'], ['nuevo', 'a', 'b']);
    expect(moves.has('nuevo')).toBe(false);
    expect(moves.get('a')).toBe(-1);
  });
});
