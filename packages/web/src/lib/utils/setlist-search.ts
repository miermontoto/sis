// Encadenado de páginas de la búsqueda de setlist.fm, extraído del modal para
// poder probarlo: es donde se han concentrado los fallos (listas duplicadas,
// fallback que dejaba el vacío a la vista, paginación que parecía perder bolos).
//
// El componente se queda con el estado de Svelte y el token de carga; aquí sólo
// vive la lógica: traer N páginas seguidas y decidir el fallback de año.
import type { SetlistfmSearchResponse, SetlistfmShow } from '@sis/shared';

export type SetlistPageFetcher = (page: number, year: string | null) => Promise<SetlistfmSearchResponse>;

export interface SetlistSearchState {
  shows: SetlistfmShow[];
  page: number;
  totalPages: number;
  configured: boolean;
  artistName: string;
  importedIds: string[];
  // año efectivo tras el posible fallback ('' = todos)
  year: string;
  // el filtro por defecto se quedó sin resultados y se ha quitado
  fellBackToAllYears: boolean;
}

export interface SetlistSearchOptions {
  year: string;
  // el año lo puso el default, no el usuario: sólo entonces se hace fallback
  autoYear: boolean;
  maxPages: number;
  // continuación ("load more") en vez de búsqueda nueva
  from?: { shows: SetlistfmShow[]; page: number; totalPages: number };
  // corta el encadenado si otra carga ha adelantado a ésta
  isStale?: () => boolean;
}

/** Trae páginas consecutivas hasta completar `maxPages` (o agotar los
 *  resultados) y las devuelve como una sola lista. Si la búsqueda venía filtrada
 *  por el año POR DEFECTO y sale vacía, repite sin filtro: un artista cuya
 *  última gira es anterior al año en curso abriría si no en blanco. */
export async function searchSetlists(
  fetch: SetlistPageFetcher,
  opts: SetlistSearchOptions,
): Promise<SetlistSearchState | null> {
  const isStale = opts.isStale ?? (() => false);
  const base = opts.from;

  let shows = base ? [...base.shows] : [];
  let page = base?.page ?? 0;
  let totalPages = base?.totalPages ?? 0;
  let configured = true;
  let artistName = '';
  let importedIds: string[] = [];

  const limit = base ? page + 1 : opts.maxPages;

  while (page < limit) {
    const next = page + 1;
    if (totalPages > 0 && next > totalPages) break;

    const res = await fetch(next, opts.year || null);
    if (isStale()) return null;

    configured = res.configured;
    artistName = res.artistName;
    if (!res.configured) {
      return { shows: [], page: 0, totalPages: 0, configured: false, artistName, importedIds: [], year: opts.year, fellBackToAllYears: false };
    }

    importedIds = res.importedIds;
    totalPages = res.totalPages;
    // `next === 1` distingue búsqueda nueva de continuación: sin ello, un
    // reintento de la primera página se apilaría sobre la lista anterior
    shows = next === 1 && !base ? res.shows : [...shows, ...res.shows];
    page = next;
    if (res.shows.length === 0 || next >= res.totalPages) break;
  }

  if (!base && shows.length === 0 && opts.autoYear && opts.year) {
    const retry = await searchSetlists(fetch, { ...opts, year: '', autoYear: false });
    return retry && { ...retry, fellBackToAllYears: true };
  }

  return { shows, page, totalPages, configured, artistName, importedIds, year: opts.year, fellBackToAllYears: false };
}

// ¿este bolo está acreditado a una entidad distinta de la que se buscó?
//
// Compara normalizando (sin mayúsculas, sin acentos, sin espacios de sobra):
// nuestro nombre viene de Spotify y el suyo de setlist.fm, y una diferencia de
// capitalización o un espacio colgando etiquetaban TODAS las filas con el mismo
// artista que ya sale en la cabecera — se veía el nombre repetido en cada bolo.
// Sólo interesa marcar las giras co-cabecera, que son otra entidad de verdad
// ("Kendrick Lamar & SZA").
const normalizeName = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

export function billedAs(showArtist: string, searchedArtist: string): string | null {
  if (!showArtist || !searchedArtist) return null;
  return normalizeName(showArtist) === normalizeName(searchedArtist) ? null : showArtist;
}
