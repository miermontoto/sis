import { describe, it, expect } from 'vitest';
import { classifySetlistfmBilling, acceptedSetlistfmArtists } from '@sis/shared';

// Los nombres son los que devuelve de verdad /search/artists para cada uno:
// setlist.fm tiene 30 entidades por artista y la búsqueda por nombre las mezcla
// todas, que es de donde salían los bolos de J Balvin bajo Bad Bunny.
const BAD_BUNNY_ENTITIES = [
  'Bad Bunny',
  'All Bad Bunny Everything',
  'J Balvin, Dua Lipa, Bad Bunny, Tainy',
  'Farruko, Nicki Minaj & Bad Bunny',
  'J Balvin, Dua Lipa, Bad Bunny feat. Tainy',
  'Cosculluela & Bad Bunny',
  'Myke Towers feat. Bad Bunny',
  'Enrique Iglesias & Bad Bunny',
  'Mambo Kingz & DJ Luian presenta Arcángel x Bad Bunny',
  'El Taiger & J Balvin feat Cosculluela & Bad Bunny & Bryant Myers',
  'Jennifer Lopez & Bad Bunny',
  'JHAYCO, J Balvin & Bad Bunny',
];

const KENDRICK_ENTITIES = [
  'Kendrick Lamar',
  'Kendrick Lamar & SZA',
  'WestBam feat. Kendrick Lamar',
  'Young Jeezy feat. YG, Kendrick Lamar & Chris Brown',
  'Mann feat. Frank Ocean & Kendrick Lamar',
  'Kendrick Lamar feat. Big Pooh',
  'Jidenna ft. Kendrick Lamar x Major Lazer & DJ Snake',
  'ghostwriter feat. Kanye West & Kendrick Lamar',
];

describe('classifySetlistfmBilling', () => {
  it('la entidad que es el artista es primary', () => {
    expect(classifySetlistfmBilling('Bad Bunny', 'Bad Bunny')).toBe('primary');
    expect(classifySetlistfmBilling('twenty one pilots', 'Twenty One Pilots')).toBe('primary');
  });

  // la gira co-cabecera que él encabeza sí es suya: es el caso de Kendrick
  it('encabezar un cartel compartido cuenta como concierto propio', () => {
    expect(classifySetlistfmBilling('Kendrick Lamar & SZA', 'Kendrick Lamar')).toBe('coheadline');
  });

  // ...pero figurar en el cartel de otro, no: el bolo es de quien encabeza
  it('aparecer detrás en el cartel de otro NO cuenta', () => {
    expect(classifySetlistfmBilling('J Balvin, Dua Lipa, Bad Bunny, Tainy', 'Bad Bunny')).toBe('guest');
    expect(classifySetlistfmBilling('Jennifer Lopez & Bad Bunny', 'Bad Bunny')).toBe('guest');
    expect(classifySetlistfmBilling('Kendrick Lamar & SZA', 'SZA')).toBe('guest');
  });

  // "feat." es crédito de canción aunque nuestro artista vaya delante
  it('un feat. degrada a invitado en cualquier posición', () => {
    expect(classifySetlistfmBilling('Kendrick Lamar feat. Big Pooh', 'Kendrick Lamar')).toBe('guest');
    expect(classifySetlistfmBilling('Myke Towers feat. Bad Bunny', 'Bad Bunny')).toBe('guest');
    expect(classifySetlistfmBilling('Mambo Kingz & DJ Luian presenta Arcángel x Bad Bunny', 'Bad Bunny')).toBe('guest');
  });

  it('un nombre que sólo contiene al artista no es el artista', () => {
    expect(classifySetlistfmBilling('All Bad Bunny Everything', 'Bad Bunny')).toBe('guest');
  });
});

describe('acceptedSetlistfmArtists', () => {
  const ents = (names: string[]) => names.map((name, i) => ({ mbid: `mb-${i}`, name }));

  it('de las 12 entidades reales de Bad Bunny sólo acepta la suya', () => {
    const ok = acceptedSetlistfmArtists(ents(BAD_BUNNY_ENTITIES), 'Bad Bunny');
    expect(ok.map(a => a.name)).toEqual(['Bad Bunny']);
  });

  it('de las de Kendrick acepta la suya y la gira con SZA', () => {
    const ok = acceptedSetlistfmArtists(ents(KENDRICK_ENTITIES), 'Kendrick Lamar');
    expect(ok.map(a => a.name)).toEqual(['Kendrick Lamar', 'Kendrick Lamar & SZA']);
    expect(ok.map(a => a.billing)).toEqual(['primary', 'coheadline']);
  });

  it('descarta entidades sin mbid, que no se pueden filtrar', () => {
    const ok = acceptedSetlistfmArtists([{ mbid: null, name: 'Bad Bunny' }, { mbid: 'x', name: 'Bad Bunny' }], 'Bad Bunny');
    expect(ok).toHaveLength(1);
    expect(ok[0].mbid).toBe('x');
  });

  // artists.mbid sólo desempata homónimos: nunca es la clave de búsqueda
  it('un MBID conocido entre las entidades deja sólo esa primary y conserva las co-cabeceras', () => {
    const homonyms = [
      { mbid: 'nirvana-us', name: 'Nirvana' },
      { mbid: 'nirvana-uk', name: 'Nirvana' },
      { mbid: 'nirvana-tour', name: 'Nirvana & Foo Fighters' },
    ];
    const ok = acceptedSetlistfmArtists(homonyms, 'Nirvana', 'nirvana-uk');
    expect(ok.map(a => a.mbid)).toEqual(['nirvana-uk', 'nirvana-tour']);
  });

  // caso real: Bad Bunny llevaba en artists.mbid el de J Balvin, acretado de un
  // recording compartido. Buscar por ese MBID devolvía la gira de J Balvin, el
  // filtro la vaciaba y el modal decía "sin bolos", con el 28-06-2026 de Londres
  // en la primera página de la búsqueda por nombre
  it('un MBID que no es de ninguna entidad se ignora en vez de vaciar la lista', () => {
    const ok = acceptedSetlistfmArtists(ents(BAD_BUNNY_ENTITIES), 'Bad Bunny', 'mbid-de-j-balvin');
    expect(ok.map(a => a.name)).toEqual(['Bad Bunny']);
  });

  // el MBID de Kendrick es correcto, pero la Grand National Tour (Barcelona,
  // 30-07-2025) está bajo "Kendrick Lamar & SZA": la co-cabecera sigue dentro
  it('el MBID propio no descarta la gira co-cabecera', () => {
    const ok = acceptedSetlistfmArtists(ents(KENDRICK_ENTITIES), 'Kendrick Lamar', 'mb-0');
    expect(ok.map(a => a.name)).toEqual(['Kendrick Lamar', 'Kendrick Lamar & SZA']);
  });
});
