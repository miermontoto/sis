// álbumes anunciados que aún no han salido: sus singles de adelanto rankean como el
// álbum que viene en vez de cada uno por su lado (ver api/services/upcoming-albums.ts).
//
// Spotify enseña un álbum futuro por id (`GET /albums/{id}`, con los temas ya publicados
// como los ids exactos de sus singles) pero nunca lo lista: ni en la discografía del
// artista ni en la búsqueda. Así que el id llega por fuera — un enlace que pega el
// usuario o el contexto de un play — y el resto se descubre por las preventas de
// iTunes, que sí traen el tracklist entero con nombres y duraciones.
import { inFoldWindow, type FoldRelease, type FoldTrack, type SingleFoldOptions } from './single-fold.js';
import { normalizeTitle } from './musicbrainz.js';

/** Tema de un álbum que viene: `trackId` sólo cuando lo dio spotify (es el id del
 *  single ya publicado); los de iTunes casan por nombre + duración. */
export interface UpcomingTrack {
  name: string;
  durationMs: number;
  trackId?: string;
}

/** Lo que una colección sabe de su álbum que viene (null en una colección normal). */
export interface UpcomingRef {
  releaseDate: string;
  spotifyAlbumId: string | null;
}

/** Respuesta de `POST /api/upcoming`: `collectionId` es null cuando ningún single que
 *  hayas escuchado está en el álbum (todavía): queda vigilado y se plegará solo. */
export interface UpcomingLinkResult {
  upcomingId: number;
  name: string;
  releaseDate: string;
  collectionId: number | null;
  singles: number;
}

const SPOTIFY_ID = '[0-9A-Za-z]{22}';
const ALBUM_REF = new RegExp(`^(?:https?://open\\.spotify\\.com/(?:intl-[a-z-]+/)?album/(${SPOTIFY_ID})(?:[/?#].*)?|spotify:album:(${SPOTIFY_ID})|(${SPOTIFY_ID}))$`);

/** Id de álbum de un enlace de spotify (con o sin `?si=`), una uri `spotify:album:` o el
 *  id pelado. Un enlace de tema o de playlist no vale: es el álbum lo que se vigila. */
export function parseSpotifyAlbumId(input: string): string | null {
  const m = ALBUM_REF.exec(input.trim());
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/** ¿El single va dentro del álbum que viene? Mismas reglas que el plegado de siempre
 *  (dentro de la ventana de adelanto y con TODOS sus temas en el álbum), con dos formas
 *  de casar un tema: por id, que es la prueba de spotify, o por clave + duración, que
 *  es lo único que dan las preventas. Sin duración no casa: un nombre a secas en el
 *  catálogo de un artista es justo lo que se comió versiones distintas otras veces. */
export function upcomingContains(single: FoldRelease, album: { releaseDate: string; tracks: FoldTrack[] }, opts: SingleFoldOptions): boolean {
  if (single.tracks.length === 0) return false;
  if (!inFoldWindow(single, { id: '', releaseDate: album.releaseDate, tracks: [] }, opts.maxLeadMs)) return false;
  return single.tracks.every(st => album.tracks.some(at =>
    (at.id !== '' && at.id === st.id)
    || (st.key !== '' && at.key === st.key && at.durationMs > 0 && st.durationMs > 0
      && Math.abs(at.durationMs - st.durationMs) <= opts.durationToleranceMs)));
}

/** Preventa de iTunes: un álbum de este artista que todavía no ha salido. */
export interface ItunesPreorder {
  collectionId: string;
  name: string;
  releaseDate: string;
}

interface ItunesCollection {
  wrapperType?: string;
  collectionType?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  releaseDate?: string;
  trackCount?: number;
}

interface ItunesSong {
  wrapperType?: string;
  trackName?: string;
  trackTimeMillis?: number;
  discNumber?: number;
  trackNumber?: number;
}

// iTunes nombra singles y EPs dentro del propio título; spotify los clasifica como
// singles, y el plegado sólo va de single a álbum
const NOT_AN_ALBUM = /\s-\s(?:single|ep)$/i;

/** Preventas de `itunes.apple.com/search?entity=album` que son de ESTE artista (el
 *  término también casa colaboraciones y homónimos parciales) y salen después de hoy. */
export function itunesPreorders(results: unknown[], artistName: string, today: string): ItunesPreorder[] {
  const artist = normalizeTitle(artistName);
  return (results as ItunesCollection[])
    .filter(r => r.wrapperType === 'collection' && r.collectionType === 'Album'
      && !!r.collectionId && !!r.collectionName && !NOT_AN_ALBUM.test(r.collectionName)
      && normalizeTitle(r.artistName ?? '') === artist
      && (r.releaseDate ?? '').slice(0, 10) > today)
    .map(r => ({ collectionId: String(r.collectionId), name: r.collectionName!, releaseDate: r.releaseDate!.slice(0, 10) }));
}

/** Tracklist de `itunes.apple.com/lookup?entity=song`, en su orden. */
export function itunesTracks(results: unknown[]): UpcomingTrack[] {
  return (results as ItunesSong[])
    .filter(r => r.wrapperType === 'track' && !!r.trackName)
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
    .map(r => ({ name: r.trackName!, durationMs: r.trackTimeMillis ?? 0 }));
}
