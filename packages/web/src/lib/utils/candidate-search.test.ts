import { describe, it, expect } from 'vitest';
import { indexCandidates, searchCandidates, suggestCandidates, normName, SIMILAR_THRESHOLD } from './candidate-search';

const c = (id: string, name: string, plays: number) => ({ id, name, plays });
const ids = (items: { id: string }[]) => items.map(i => i.id);

describe('normName', () => {
  it('quita acentos y mayúsculas', () => {
    expect(normName('Héctor "El Father"')).toBe('hector "el father"');
    expect(normName('ROSALÍA')).toBe('rosalia');
  });
});

describe('indexCandidates', () => {
  it('sin target no puntúa', () => {
    expect(indexCandidates([c('a', 'Bellini', 1)]).map(x => x.sim)).toEqual([0]);
  });

  it('una versión con sufijo se parece a su original por el núcleo', () => {
    const [remaster, other] = indexCandidates([c('a', 'Runaway - Remastered', 1), c('b', 'Gorgeous', 1)], 'Runaway');
    expect(remaster.sim).toBe(1);
    expect(other.sim).toBeLessThan(SIMILAR_THRESHOLD);
  });

  it('el núcleo del target también cuenta', () => {
    const [plain] = indexCandidates([c('a', 'Runaway', 1)], 'Runaway (Live)');
    expect(plain.sim).toBe(1);
  });
});

describe('searchCandidates', () => {
  const pool = [c('1', 'Beyoncé', 50), c('2', 'The Smile', 10), c('3', 'Smile Empty Soul', 30), c('4', 'Eminem', 99)];

  it('ignora acentos y mayúsculas del nombre y de la consulta', () => {
    expect(ids(searchCandidates(indexCandidates(pool), 'BEYONCE'))).toEqual(['1']);
    expect(ids(searchCandidates(indexCandidates(pool), 'beyoncé'))).toEqual(['1']);
  });

  it('sin target ordena por plays', () => {
    expect(ids(searchCandidates(indexCandidates(pool), 'smile'))).toEqual(['3', '2']);
  });

  it('con target, el parecido manda sobre los plays', () => {
    expect(ids(searchCandidates(indexCandidates(pool, 'The Smile'), 'smile'))).toEqual(['2', '3']);
  });
});

describe('suggestCandidates', () => {
  const pool = [c('1', 'Kanye West', 900), c('2', 'Ye', 5), c('3', 'Kanye West - Remix', 3), c('4', 'Kanye', 40)];
  const index = indexCandidates(pool, 'Kanye West');

  it('onlySimilar deja sólo los parecidos, el más parecido primero', () => {
    expect(ids(suggestCandidates(index, true))).toEqual(['1', '3', '4']);
  });

  it('sin onlySimilar el resto va detrás, por plays', () => {
    expect(ids(suggestCandidates(index, false))).toEqual(['1', '3', '4', '2']);
  });
});
