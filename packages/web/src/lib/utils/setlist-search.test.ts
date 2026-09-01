import { describe, it, expect, vi } from 'vitest';
import { searchSetlists, billedAs, type SetlistPageFetcher } from './setlist-search';
import type { SetlistfmSearchResponse, SetlistfmShow } from '@sis/shared';

const show = (id: string, date = '2026-01-01'): SetlistfmShow => ({
  id, url: `u/${id}`, date, artistName: 'Bad Bunny', venue: 'V', city: 'C', country: 'ES', tour: null, songs: [],
});

// fetcher de N páginas de 2 bolos; el año filtra por prefijo de fecha
function fakeApi(byYear: Record<string, SetlistfmShow[]>, perPage = 2): SetlistPageFetcher {
  return async (page, year) => {
    const all = byYear[year ?? ''] ?? [];
    const totalPages = Math.ceil(all.length / perPage);
    return {
      configured: true,
      artistName: 'Bad Bunny',
      shows: all.slice((page - 1) * perPage, page * perPage),
      page,
      totalPages,
      importedIds: [],
    } satisfies SetlistfmSearchResponse;
  };
}

describe('searchSetlists', () => {
  it('encadena páginas en una sola lista sin repetir bolos', async () => {
    const api = fakeApi({ '': [show('a'), show('b'), show('c'), show('d'), show('e'), show('f')] });
    const res = await searchSetlists(api, { year: '', autoYear: false, maxPages: 3 });
    expect(res!.shows.map(s => s.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(new Set(res!.shows.map(s => s.id)).size).toBe(6);
    expect(res!.page).toBe(3);
  });

  it('para al agotar los resultados aunque queden páginas de margen', async () => {
    const api = fakeApi({ '': [show('a'), show('b')] });
    const res = await searchSetlists(api, { year: '', autoYear: false, maxPages: 5 });
    expect(res!.shows).toHaveLength(2);
    expect(res!.page).toBe(1);
  });

  // el caso de Kendrick Lamar: sin bolos en el año en curso
  it('si el año POR DEFECTO no tiene bolos, reintenta sin filtro', async () => {
    const api = fakeApi({ '2026': [], '': [show('x', '2025-12-18'), show('y', '2025-12-14')] });
    const res = await searchSetlists(api, { year: '2026', autoYear: true, maxPages: 3 });
    expect(res!.shows.map(s => s.id)).toEqual(['x', 'y']);
    expect(res!.year).toBe('');
    expect(res!.fellBackToAllYears).toBe(true);
  });

  it('si el año lo eligió el usuario, el vacío es la respuesta y no hay fallback', async () => {
    const api = fakeApi({ '2019': [], '': [show('x')] });
    const res = await searchSetlists(api, { year: '2019', autoYear: false, maxPages: 3 });
    expect(res!.shows).toEqual([]);
    expect(res!.fellBackToAllYears).toBe(false);
  });

  it('"load more" continúa desde donde iba, sin duplicar lo ya cargado', async () => {
    const api = fakeApi({ '': [show('a'), show('b'), show('c'), show('d')] });
    const first = await searchSetlists(api, { year: '', autoYear: false, maxPages: 1 });
    expect(first!.shows.map(s => s.id)).toEqual(['a', 'b']);
    const more = await searchSetlists(api, {
      year: '', autoYear: false, maxPages: 1,
      from: { shows: first!.shows, page: first!.page, totalPages: first!.totalPages },
    });
    expect(more!.shows.map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(more!.shows.map(s => s.id)).size).toBe(4);
  });

  it('una carga adelantada por otra se corta y no devuelve nada que escribir', async () => {
    const api = fakeApi({ '': [show('a'), show('b'), show('c'), show('d')] });
    let stale = false;
    const res = await searchSetlists(api, {
      year: '', autoYear: false, maxPages: 3,
      isStale: () => { const s = stale; stale = true; return s; },
    });
    // la segunda página ya la ve obsoleta: devuelve null en vez de media lista
    expect(res).toBeNull();
  });

  it('sin credenciales informa y no inventa resultados', async () => {
    const api: SetlistPageFetcher = async () => ({
      configured: false, artistName: 'X', shows: [], page: 1, totalPages: 0, importedIds: [],
    });
    const res = await searchSetlists(api, { year: '2026', autoYear: true, maxPages: 3 });
    expect(res!.configured).toBe(false);
    expect(res!.shows).toEqual([]);
  });

  it('no pide más páginas de las que hay', async () => {
    const api = fakeApi({ '': [show('a'), show('b'), show('c')] });
    const spy = vi.fn(api);
    await searchSetlists(spy, { year: '', autoYear: false, maxPages: 5 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('billedAs', () => {
  it('no marca nada cuando es el mismo artista', () => {
    expect(billedAs('Bad Bunny', 'Bad Bunny')).toBeNull();
  });

  // el nombre nuestro viene de Spotify y el suyo de setlist.fm: una diferencia
  // de capitalización o un espacio colgando etiquetaba todas las filas
  it('tolera mayúsculas, acentos y espacios de sobra', () => {
    expect(billedAs('bad bunny', 'Bad Bunny')).toBeNull();
    expect(billedAs('Bad  Bunny ', 'Bad Bunny')).toBeNull();
    expect(billedAs('Beyoncé', 'Beyonce')).toBeNull();
    expect(billedAs('TWENTY ONE PILOTS', 'Twenty One Pilots')).toBeNull();
  });

  it('sí marca una gira co-cabecera, que es otra entidad', () => {
    expect(billedAs('Kendrick Lamar & SZA', 'Kendrick Lamar')).toBe('Kendrick Lamar & SZA');
  });

  it('no marca nada si falta alguno de los dos nombres', () => {
    expect(billedAs('', 'Bad Bunny')).toBeNull();
    expect(billedAs('Bad Bunny', '')).toBeNull();
  });
});
