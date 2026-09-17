// Relaciones entre entidades, en las dos intensidades que maneja la app:
//  - "soft" (artist_relations): el vínculo se declara pero las escuchas siguen contando
//    por separado. Simétrico, sin lado canónico, y sólo entre artistas.
//  - "hard" (merge_rules, ver merge.ts): una entidad absorbida dentro de otra. Tiene
//    dirección, así que la misma fila significa lo contrario según qué página se abra.
// Las dos se pintan en la misma sección del detalle, así que viajan en la misma lista.

/** Papel de la otra punta visto desde la entidad consultada:
 *  - `alias`: ESTA entidad está mergeada dentro de la otra (su página es un stub)
 *  - `absorbed`: la otra está mergeada dentro de ésta, y le aporta sus escuchas
 *  - `related`: relación soft, sin efecto en el tracking */
export type RelationKind = 'alias' | 'absorbed' | 'related';

// una punta de la relación, ya resuelta al lado que NO es la entidad consultada
export interface EntityRelation {
  kind: RelationKind;
  id: string;
  name: string;
  imageUrl: string | null;
  // filas que sostienen el enlace: la regla de merge, o las 1..n filas de
  // artist_relations que resuelven a este artista (varias si los dos lados acabaron
  // mergeados con otros). Deshacer la relación las borra todas.
  ruleIds: number[];
  // escuchas de la otra punta, contadas como las cuenta su propia página (su id más
  // los alias que haya absorbido). Para un `absorbed` eso es justo lo que ese alias
  // aporta al grupo; para un `alias`, dónde han acabado las escuchas de esta página.
  playCount: number;
  totalMs: number;
}

// artista vinculado (soft), visto desde el artista consultado. Es lo que necesita el
// modal de relaciones: el enlace sin las cifras, que ahí no se pintan.
export interface RelatedArtist {
  id: string;
  // filas que sostienen el enlace: normalmente una, varias si los dos lados acabaron
  // mergeados con otros artistas. Deshacer la relación las borra todas.
  ruleIds: number[];
  name: string;
  imageUrl: string | null;
}

// fila plana para la lista de settings. Al ser simétrica no hay source/target: los dos
// lados se devuelven tal cual, con `a` el primero según el orden normalizado del par.
export interface ArtistRelationRule {
  id: number;
  a_id: string;
  a_name: string;
  a_image: string | null;
  b_id: string;
  b_name: string;
  b_image: string | null;
  created_at: string;
}
