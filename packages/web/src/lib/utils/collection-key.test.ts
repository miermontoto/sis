import { describe, it, expect } from 'vitest';
import { collectionKey, isCollectionKey, parseCollectionKey, COLLECTION_ID_PREFIX } from '@sis/shared';

// Las colecciones ("álbumes lógicos") viajan por el espacio de ids de álbum con la
// clave `collection:N`, que sale de las queries de ranking y entra en las URLs. El
// parser es quien decide si una fila de top albums es una colección y a qué página
// enlaza, así que tiene que rechazar todo lo que no sea exactamente esa forma: un id
// real de spotify, una clave de otra versión o un cuerpo que no sea un entero.

describe('collectionKey / parseCollectionKey', () => {
  it('ida y vuelta', () => {
    expect(collectionKey(7)).toBe('collection:7');
    expect(parseCollectionKey(collectionKey(7))).toBe(7);
  });

  it('un id de spotify no es una colección', () => {
    expect(isCollectionKey('2gWDbNPfFcIR1EewwlvyqJ')).toBe(false);
    expect(parseCollectionKey('2gWDbNPfFcIR1EewwlvyqJ')).toBeNull();
  });

  it('los otros ids sintéticos tampoco', () => {
    // local: e import: comparten espacio entre sí, pero no con las colecciones:
    // aquellos son filas de `albums` y éstas no
    expect(parseCollectionKey('local:65c4c03f7adeaab7')).toBeNull();
    expect(parseCollectionKey('import:65c4c03f7adeaab7')).toBeNull();
  });

  it('rechaza cuerpos que no son un entero positivo', () => {
    // llega de una URL escrita a mano o de una respuesta cacheada por otra versión:
    // un NaN aquí se convertiría en /collection/NaN
    expect(parseCollectionKey(COLLECTION_ID_PREFIX)).toBeNull();
    expect(parseCollectionKey('collection:abc')).toBeNull();
    expect(parseCollectionKey('collection:1.5')).toBeNull();
    expect(parseCollectionKey('collection:-3')).toBeNull();
    expect(parseCollectionKey('collection:0')).toBeNull();
  });

  it('tolera null y undefined', () => {
    expect(parseCollectionKey(null)).toBeNull();
    expect(parseCollectionKey(undefined)).toBeNull();
    expect(isCollectionKey(null)).toBe(false);
  });
});
