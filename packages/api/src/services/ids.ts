import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';

// prefijos de las entidades que no existen en el catálogo de spotify: las locales del
// usuario y las que crea el import del historial. no tienen release graph detrás
// (ni release_date, ni artist_ids, ni album_type), así que toda lógica que dependa
// del catálogo tiene que saltárselas.
export const SYNTHETIC_ID_PREFIXES = ['local:', 'import:'] as const;

export function isSyntheticId(id: string): boolean {
  return SYNTHETIC_ID_PREFIXES.some(prefix => id.startsWith(prefix));
}

// ids que no existen en spotify, sintéticos incluidos: los de arriba MÁS los álbumes
// lógicos (`collection:`, ver db/queries/collections.ts). Es la lista que tiene que
// mirar cualquier cosa que vaya a PREGUNTARLE a spotify por un id; NO es la de los
// sweeps de sintéticos, que fusionan entre sí local: e import: y no deben tocar una
// colección (es una entidad del usuario, no un duplicado que reconciliar).
export const NON_SPOTIFY_ID_PREFIXES = [...SYNTHETIC_ID_PREFIXES, 'collection:'] as const;

export function isNonSpotifyId(id: string): boolean {
  return NON_SPOTIFY_ID_PREFIXES.some(prefix => id.startsWith(prefix));
}

// `<col>` es sintético, derivado de SYNTHETIC_ID_PREFIXES para que los dos prefijos se
// traten como UN espacio. Cuando cada sweep filtraba el suyo a mano, la misma entidad
// vivía dos veces: los dos caminos acuñan el álbum como syntheticId(prefix, artista,
// álbum), o sea el mismo cuerpo de hash con distinto prefijo, y ningún lookup cruzaba
// la frontera (import:65c4c03f7adeaab7 y local:65c4c03f7adeaab7 son el mismo disco).
export function syntheticIdPredicate(column: string) {
  const col = sql.raw(column);
  return sql`(${sql.join(SYNTHETIC_ID_PREFIXES.map(p => sql`${col} LIKE ${`${p}%`}`), sql` OR `)})`;
}

// orden de preferencia entre sintéticos: import: antes que local:, porque la fila de
// import es la que acumula el historial largo (la local nace de un play suelto).
// Mismo criterio que el CASE de history-import.ts, que ya prefería real > import > local.
export function syntheticPreference(column: string) {
  const col = sql.raw(column);
  return sql`CASE WHEN ${col} LIKE 'import:%' THEN 0 ELSE 1 END, ${col}`;
}

// genera un ID determinístico a partir de dos componentes
export function syntheticId(prefix: string, a: string, b: string): string {
  const hash = createHash('sha256')
    .update(`${a.toLowerCase()}|${b.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
  return `${prefix}${hash}`;
}
