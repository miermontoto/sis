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
  // lanzamientos enteros y temas sueltos (de un EP con canciones de fuera) en la colección
  singles: number;
  tracks: number;
}

const SPOTIFY_ID = '[0-9A-Za-z]{22}';
const ALBUM_REF = new RegExp(`^(?:https?://open\\.spotify\\.com/(?:intl-[a-z-]+/)?album/(${SPOTIFY_ID})(?:[/?#].*)?|spotify:album:(${SPOTIFY_ID})|(${SPOTIFY_ID}))$`);

/** Id de álbum de un enlace de spotify (con o sin `?si=`), una uri `spotify:album:` o el
 *  id pelado. Un enlace de tema o de playlist no vale: es el álbum lo que se vigila. */
export function parseSpotifyAlbumId(input: string): string | null {
  const m = ALBUM_REF.exec(input.trim());
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

const PRERELEASE_REF = new RegExp(`^(?:https?://open\\.spotify\\.com/(?:intl-[a-z-]+/)?(?:embed/)?prerelease/(${SPOTIFY_ID})(?:[/?#].*)?|spotify:prerelease:(${SPOTIFY_ID}))$`);
const TRACK_URI = new RegExp(`spotify:track:(${SPOTIFY_ID})`, 'g');

/** Id de una Countdown Page (`open.spotify.com/prerelease/{id}`). No es el id del álbum:
 *  `/albums/{id}` le da 404, así que el servidor lo resuelve por los temas de su embed. */
export function parseSpotifyPrereleaseId(input: string): string | null {
  const m = PRERELEASE_REF.exec(input.trim());
  return m ? (m[1] ?? m[2]) : null;
}

/** Temas que lista el embed de una Countdown Page (`spotify:track:<id>`, en orden y sin
 *  repetir): son los del álbum real, publicados o no, y `/tracks/{id}` devuelve su álbum. */
export function embedTrackIds(html: string): string[] {
  return [...new Set([...html.matchAll(TRACK_URI)].map(m => m[1]))];
}

/** Qué entra de un single en el álbum que viene: el lanzamiento entero (`release`) o sólo
 *  sus temas compartidos (`tracks`, un EP con canciones que el disco no lleva: decisión de
 *  Juan, 2026-11-17, que el resto del EP siga siendo suyo). */
export type UpcomingMatch = { kind: 'release' } | { kind: 'tracks'; trackIds: string[] };

/** ¿Qué del single va dentro del álbum que viene? Un tema casa por id (la prueba de
 *  spotify) o por clave + duración (lo único que dan las preventas): siempre la misma
 *  grabación, nunca el nombre a secas, así que no hay ventana de adelanto (La Casa Azul
 *  mete en su disco de 2026 un single de 2021); sólo se exige que el álbum no sea
 *  anterior al single. Entra el lanzamiento entero si casan TODOS sus temas y su
 *  tracklist está completo (`totalTracks`): con temas sin ingerir no se sabe si lleva
 *  canciones de fuera, y entonces sólo entran los temas que casan. */
export function upcomingMatch(single: FoldRelease, totalTracks: number | null, album: { releaseDate: string; tracks: FoldTrack[] }, opts: SingleFoldOptions): UpcomingMatch | null {
  if (!inFoldWindow(single, { id: '', releaseDate: album.releaseDate, tracks: [] }, Number.POSITIVE_INFINITY)) return null;
  const matched = single.tracks.filter(st => album.tracks.some(at =>
    (at.id !== '' && at.id === st.id)
    || (st.key !== '' && at.key === st.key && at.durationMs > 0 && st.durationMs > 0
      && Math.abs(at.durationMs - st.durationMs) <= opts.durationToleranceMs)));
  if (matched.length === 0) return null;
  const complete = matched.length === single.tracks.length && single.tracks.length >= (totalTracks ?? 0);
  return complete ? { kind: 'release' } : { kind: 'tracks', trackIds: matched.map(t => t.id) };
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
