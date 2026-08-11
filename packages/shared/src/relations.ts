// Relación "soft" entre artistas: el vínculo se declara pero las escuchas siguen
// contando por separado. La relación "hard" (un artista absorbido dentro de otro)
// es un merge y vive en merge.ts.

// artista vinculado, visto desde el artista consultado
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
