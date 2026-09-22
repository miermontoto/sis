import type { TopTrackItem } from './top.js';
import type { HistoryItem } from './history.js';

// Colecciones ("álbumes lógicos"): contenedor creado por el usuario que agrupa
// álbumes enteros y temas sueltos de un artista — una trilogía, una era, los
// singles de un año. Es la tercera intensidad de vínculo de la app, y no se
// parece del todo a ninguna de las otras dos (ver relations.ts):
//  - un MERGE absorbe: la fuente deja de tener página propia y pasa a ser un alias.
//  - una RELACIÓN soft no toca el tracking: las escuchas siguen contando aparte.
//  - una COLECCIÓN está en medio: sus miembros conservan su página entera y sus
//    cifras, pero en los RANKINGS la colección los SUSTITUYE — sus plays se
//    atribuyen a ella, así que el álbum miembro deja de aparecer en top albums.
// De ahí el invariante: un álbum o un tema pertenece como mucho a UNA colección.
// En dos, sus plays se contarían dos veces y el ranking saldría inflado.

// Las colecciones viajan por el espacio de ids de álbum con este prefijo. No son
// filas de `albums` (un id sintético en el catálogo lo tocarían los barridos de
// dedup e identity), así que la clave se construye y se parsea aquí y sólo vive
// en el resultado de las queries y en los enlaces del cliente.
export const COLLECTION_ID_PREFIX = 'collection:';

export function collectionKey(id: number): string {
  return `${COLLECTION_ID_PREFIX}${id}`;
}

export function isCollectionKey(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(COLLECTION_ID_PREFIX);
}

/** Id numérico de una clave `collection:N`, o null si no lo es (o el cuerpo no es
 *  un entero: la clave entra en URLs y en respuestas cacheadas de versiones viejas). */
export function parseCollectionKey(id: string | null | undefined): number | null {
  if (!isCollectionKey(id)) return null;
  const n = Number((id as string).slice(COLLECTION_ID_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export type CollectionMemberType = 'album' | 'track';

// miembro ya hidratado: el álbum o el tema con sus cifras propias, que son las que
// la colección suma. `playCount`/`totalMs` se cuentan como los cuenta la página del
// miembro (su id más los alias que haya absorbido), igual que en EntityRelation.
export interface CollectionMember {
  entityType: CollectionMemberType;
  entityId: string;
  position: number;
  name: string;
  imageUrl: string | null;
  // artistas del miembro; en un álbum son sus créditos, en un tema los suyos
  artists: { id: string; name: string }[];
  // sólo en álbumes: sirve para ordenar la colección por fecha de lanzamiento
  releaseDate?: string | null;
  playCount: number;
  totalMs: number;
}

// fila de listado: lo que necesita la sección del detalle de artista
export interface AlbumCollectionSummary {
  id: number;
  name: string;
  artistId: string;
  artistName: string;
  // portada: la elegida a mano o, si no hay, la del primer miembro con portada
  imageUrl: string | null;
  color: string | null;
  notes: string | null;
  albumCount: number;
  trackCount: number;
  playCount: number;
  totalMs: number;
  createdAt: string;
  updatedAt: string;
}

// detalle de /collection/:id — mismo reparto que AlbumDetail para poder reusar
// las mismas secciones (stats, gráfica, lista de temas, recent plays)
export interface CollectionDetail {
  collection: AlbumCollectionSummary;
  members: CollectionMember[];
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  // todos los temas que la colección agrega (los de sus álbumes + los sueltos)
  tracks: TopTrackItem[];
  recentPlays: HistoryItem[];
}

// referencia mínima: la línea de "esto pertenece a" del detalle de álbum y de tema.
// `direct` distingue al tema añadido a mano de aquel que entra porque su álbum es
// miembro — sólo el primero se puede quitar desde la página del tema.
export interface CollectionRef {
  id: number;
  name: string;
  imageUrl: string | null;
  direct: boolean;
}

export interface CollectionInput {
  name: string;
  artistId: string;
  notes?: string | null;
}

// error de conflicto al añadir un miembro que ya está en otra colección: el cliente
// necesita nombrarla para que el usuario sepa de dónde tiene que sacarlo antes
export interface CollectionConflict {
  error: string;
  collectionId: number;
  collectionName: string;
}

export const COLLECTION_NAME_MAX_CHARS = 120;
export const COLLECTION_NOTES_MAX_CHARS = 2000;
