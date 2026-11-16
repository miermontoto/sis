import { describe, it, expect } from 'vitest';
import { topDistinctEntries } from '@sis/shared';

type Row = { id: string; week: string };
const row = (id: string, week: string): Row => ({ id, week });
const idOf = (r: Row) => r.id;

// peak week de artistas con "record entries" en duplicados: una fila por semana
const duplicated = [row('eminem', 'W50'), row('eminem', 'W02'), row('eminem', 'W33'), row('bad-bunny', 'W10'), row('eminem', 'W40'), row('top', 'W12')];

describe('topDistinctEntries', () => {
  it('ranks entities, not rows: the 2nd entity is #2 however many rows the 1st holds', () => {
    const top = topDistinctEntries(duplicated, idOf, 10);
    expect(top.map(idOf)).toEqual(['eminem', 'bad-bunny', 'top']);
  });

  it('keeps each entity on its first (best) row', () => {
    expect(topDistinctEntries(duplicated, idOf, 10)[0].week).toBe('W50');
  });

  it('cuts at `limit` entities, not `limit` rows', () => {
    expect(topDistinctEntries(duplicated, idOf, 2).map(idOf)).toEqual(['eminem', 'bad-bunny']);
  });

  it('is a plain slice when the list is already unique', () => {
    const unique = [row('a', 'W1'), row('b', 'W2'), row('c', 'W3')];
    expect(topDistinctEntries(unique, idOf, 2)).toEqual(unique.slice(0, 2));
  });
});
