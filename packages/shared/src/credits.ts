// Atribuciones corregidas por el usuario ("credit overrides"): la lista de artistas de
// un tema o de un álbum tal como la quiere ver ESE usuario, en vez de la que sirvió
// spotify. Es la cuarta forma de vínculo junto a merges, relaciones y colecciones, y
// como las demás es privada: los plays de un tema cuentan para los artistas de su lista
// corregida sólo en las cifras de quien la corrigió.
//
// Un override es una SUSTITUCIÓN, no un delta: si existe, es la lista entera (con su
// orden, y la posición 0 es el artista principal). Así "quitar al principal y poner a
// otro" deja un principal bien definido, que es de lo que cuelgan la mitad de las
// queries (`position = 0`).

export type CreditSubjectType = 'track' | 'album';

export interface CreditArtist {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface EntityCredits {
  /** los créditos del catálogo (spotify o el import), sin corregir */
  original: CreditArtist[];
  /** los que ve el usuario: la corrección si la hay, si no los originales */
  credits: CreditArtist[];
  overridden: boolean;
}

export interface CreditsInput {
  /** lista completa y ordenada; la primera es el artista principal */
  artistIds: string[];
}

export const isCreditSubjectType = (t: unknown): t is CreditSubjectType => t === 'track' || t === 'album';

// tope de artistas de una lista corregida: los créditos reales de spotify rara vez
// pasan de diez, y sin tope un cuerpo malicioso metería miles de filas por tema
export const CREDITS_MAX_ARTISTS = 20;
