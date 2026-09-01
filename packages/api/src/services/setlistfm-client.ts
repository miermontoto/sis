// cliente http para la api de setlist.fm. autentica por cabecera x-api-key; si
// falta SETLISTFM_API_KEY el cliente informa como no configurado y los flujos
// que dependen de él hacen no-op — mismo patrón que last.fm y push.
//
// setlist.fm indexa los artistas por MBID de MusicBrainz, que es exactamente lo
// que el ladder de identidad ya guarda en artists.mbid: cuando lo hay, la
// búsqueda es exacta; si no, cae al nombre y acepta el ruido de los homónimos.
import { SETLISTFM_API_BASE, SETLISTFM_REQUEST_SPACING_MS, SETLISTFM_PAGE_SIZE, SETLISTFM_TIMEOUT_MS } from '../constants.js';
import { createLogger } from './logger.js';
import type { SetlistfmShow } from '@sis/shared';

const log = createLogger('setlistfm');

export function isSetlistfmConfigured(): boolean {
  return !!process.env.SETLISTFM_API_KEY;
}

// espaciado mínimo entre requests: el tier gratuito corta a ~2 req/s
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = lastRequestAt + SETLISTFM_REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

// forma cruda de la api (sólo los campos que consumimos). los sets llegan
// anidados y con nombres opcionales, de ahí los `?` en cascada
interface RawSong {
  name?: string;
  info?: string;
  // intro/outro grabada: no es una interpretación de la banda
  tape?: boolean;
  cover?: { name?: string };
}
interface RawSetlist {
  id?: string;
  url?: string;
  eventDate?: string;
  artist?: { name?: string; mbid?: string };
  venue?: { name?: string; city?: { name?: string; country?: { name?: string } } };
  tour?: { name?: string };
  sets?: { set?: { encore?: number; song?: RawSong[] }[] };
}
interface RawSearchResponse {
  setlist?: RawSetlist[];
  total?: number;
  page?: number;
  itemsPerPage?: number;
}

async function setlistfmRequest<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!isSetlistfmConfigured()) throw new Error('setlist.fm no configurado (SETLISTFM_API_KEY)');
  await throttle();

  const url = new URL(`${SETLISTFM_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'x-api-key': process.env.SETLISTFM_API_KEY!,
      // sin Accept explícito la api responde XML
      Accept: 'application/json',
      'User-Agent': 'sis (https://sis.mier.info)',
    },
    signal: AbortSignal.timeout(SETLISTFM_TIMEOUT_MS),
  });

  // 404 es la respuesta normal a "este artista no tiene setlists": no es un
  // error que deba propagarse al usuario, sólo una búsqueda vacía
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`setlist.fm ${path}: http ${res.status}`);
  return await res.json() as T;
}

// eventDate viene en dd-MM-yyyy; el resto del proyecto trabaja en ISO
function toIsoDate(eventDate: string | undefined): string | null {
  if (!eventDate) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(eventDate);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// aplana los sets anidados a una lista ordenada. las entradas con tape=true son
// cintas de intro/salida: se descartan porque no son interpretaciones, y las
// posiciones se reindexan después para que el orden quede contiguo
function flattenSongs(raw: RawSetlist): SetlistfmShow['songs'] {
  const out: SetlistfmShow['songs'] = [];
  for (const set of raw.sets?.set ?? []) {
    const isEncore = !!set.encore;
    for (const song of set.song ?? []) {
      if (song.tape || !song.name) continue;
      out.push({
        name: song.name,
        info: song.info?.trim() || null,
        isEncore,
        coverArtist: song.cover?.name ?? null,
      });
    }
  }
  return out;
}

function normalizeShow(raw: RawSetlist): SetlistfmShow | null {
  const date = toIsoDate(raw.eventDate);
  if (!raw.id || !date) return null;
  return {
    id: raw.id,
    url: raw.url ?? `https://www.setlist.fm/setlist/${raw.id}.html`,
    date,
    artistName: raw.artist?.name ?? '',
    venue: raw.venue?.name ?? null,
    city: raw.venue?.city?.name ?? null,
    country: raw.venue?.city?.country?.name ?? null,
    tour: raw.tour?.name ?? null,
    songs: flattenSongs(raw),
  };
}

/** Bolos de un artista, por MBID cuando lo hay (exacto) o por nombre (aproximado).
 *  Devuelve la página pedida ya normalizada + el total de páginas.
 *
 *  `year` acota la búsqueda a un año: un artista de gira larga acumula cientos
 *  de bolos (Bad Bunny pasa de 500, 27 páginas de 20) y paginar hasta el tuyo no
 *  es viable. La API devuelve 404 cuando ese año no tiene setlists, que el
 *  wrapper ya traduce a búsqueda vacía. */
export async function searchArtistShows(
  opts: { mbid?: string | null; artistName?: string | null; page?: number; year?: string | null },
): Promise<{ shows: SetlistfmShow[]; page: number; totalPages: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const params: Record<string, string> = { p: String(page) };
  if (opts.year) params.year = opts.year;
  if (opts.mbid) params.artistMbid = opts.mbid;
  else if (opts.artistName) params.artistName = opts.artistName;
  else return { shows: [], page, totalPages: 0 };

  const data = await setlistfmRequest<RawSearchResponse>('/search/setlists', params);
  if (!data) return { shows: [], page, totalPages: 0 };

  const shows = (data.setlist ?? []).map(normalizeShow).filter((s): s is SetlistfmShow => s !== null);
  const perPage = data.itemsPerPage || SETLISTFM_PAGE_SIZE;
  const totalPages = Math.ceil((data.total ?? shows.length) / perPage);
  log.debug(`búsqueda ${opts.mbid ? `mbid=${opts.mbid}` : `name=${opts.artistName}`}${opts.year ? ` year=${opts.year}` : ''} p${page}: ${shows.length} bolos`);
  return { shows, page, totalPages };
}

/** Un setlist concreto por id (el import lo re-pide para traerse las canciones
 *  completas aunque la búsqueda venga de una página cacheada en el cliente). */
export async function getShow(setlistId: string): Promise<SetlistfmShow | null> {
  const data = await setlistfmRequest<RawSetlist>(`/setlist/${encodeURIComponent(setlistId)}`);
  return data ? normalizeShow(data) : null;
}
