// origen público de ESTA instancia, derivado del redirect de spotify (la única
// url pública que toda instancia configura). es una función y no una constante
// porque el .env se carga en index.ts después de evaluar los imports.
//
// se usa para lo que antes nombraba a sis.mier.info a pelo: los user-agents de
// musicbrainz y setlist.fm (los dos piden una url de contacto). una instancia
// ajena se presenta con su propio dominio.
import { DEFAULT_SPOTIFY_REDIRECT_URI, VERSION } from '../constants.js';

export function publicOrigin(): string {
  return new URL(process.env.SPOTIFY_REDIRECT_URI || DEFAULT_SPOTIFY_REDIRECT_URI).origin;
}

export function serviceUserAgent(): string {
  return `SIS/${VERSION} (${publicOrigin()})`;
}
