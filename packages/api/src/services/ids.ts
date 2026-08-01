import { createHash } from 'crypto';

// prefijos de las entidades que no existen en el catálogo de spotify: las locales del
// usuario y las que crea el import del historial. no tienen release graph detrás
// (ni release_date, ni artist_ids, ni album_type), así que toda lógica que dependa
// del catálogo tiene que saltárselas.
export const SYNTHETIC_ID_PREFIXES = ['local:', 'import:'] as const;

export function isSyntheticId(id: string): boolean {
  return SYNTHETIC_ID_PREFIXES.some(prefix => id.startsWith(prefix));
}

// genera un ID determinístico a partir de dos componentes
export function syntheticId(prefix: string, a: string, b: string): string {
  const hash = createHash('sha256')
    .update(`${a.toLowerCase()}|${b.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
  return `${prefix}${hash}`;
}
