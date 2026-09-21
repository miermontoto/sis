import { api, type PlaylistPresenceItem } from '$lib/api';
import { PLAYLIST_MEMBERSHIP_MAX_IDS } from '@sis/shared';

// Pertenencia de temas a playlists del usuario, en UN solo sitio: la tarjeta de
// now playing y las filas de las listas leen de aquí, así que añadir un tema
// desde cualquiera de las dos se ve al instante en la otra.
//
// undefined = aún no lo sabemos; [] = no está en ninguna. La diferencia importa
// porque el badge de una fila SOLO se pinta cuando hay playlists, y sin ella
// toda fila desconocida se leería como "en ninguna".
let _byTrack = $state<Record<string, PlaylistPresenceItem[]>>({});
// ids con petición en vuelo: un mismo tema puede aparecer en varias listas de la
// misma página (top tracks y singles del álbum) y se pediría dos veces
const _inflight = new Set<string>();

/** Pide en un lote los ids que aún no conocemos. Los ya conocidos no se
 *  revalidan: las playlists sólo cambian por una mutación nuestra —que actualiza
 *  este store— o por una edición en spotify, que el sync de 6h absorbe. */
async function ensure(trackIds: string[]): Promise<void> {
  const pending = [...new Set(trackIds)].filter(id => _byTrack[id] === undefined && !_inflight.has(id));
  if (pending.length === 0) return;

  pending.forEach(id => _inflight.add(id));
  for (let i = 0; i < pending.length; i += PLAYLIST_MEMBERSHIP_MAX_IDS) {
    const chunk = pending.slice(i, i + PLAYLIST_MEMBERSHIP_MAX_IDS);
    try {
      Object.assign(_byTrack, await api.trackPlaylists(chunk));
    } catch {
      // sin respuesta no se marca nada: el siguiente ensure lo reintenta
    } finally {
      chunk.forEach(id => _inflight.delete(id));
    }
  }
}

export const playlistMembershipStore = {
  get: (trackId: string | null | undefined): PlaylistPresenceItem[] | undefined =>
    trackId ? _byTrack[trackId] : undefined,
  ensure,
  // siembra lo que ya viene dentro de otra respuesta (el detalle de un tema trae
  // sus playlists), para no volver a preguntarlo
  seed(trackId: string, playlists: PlaylistPresenceItem[]) {
    _byTrack[trackId] = playlists;
  },
  add(trackId: string, playlist: PlaylistPresenceItem) {
    const current = _byTrack[trackId] ?? [];
    if (!current.some(p => p.id === playlist.id)) _byTrack[trackId] = [...current, playlist];
  },
  remove(trackId: string, playlistId: number) {
    _byTrack[trackId] = (_byTrack[trackId] ?? []).filter(p => p.id !== playlistId);
  },
};
