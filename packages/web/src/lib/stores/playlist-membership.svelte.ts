import { api, type PlaylistPresenceItem } from '$lib/api';
import { PLAYLIST_MEMBERSHIP_MAX_IDS } from '@sis/shared';

// Pertenencia de un tema a los contenedores de la biblioteca del usuario —sus
// playlists y los liked songs, que en spotify son otra playlist más— en UN solo
// sitio: la tarjeta de now playing, el detalle de tema y las filas de las listas
// leen de aquí, así que darle al corazón o añadir a una playlist desde cualquiera
// de los tres se ve al instante en los otros.
//
// undefined = aún no lo sabemos; [] / false = no está. La diferencia importa
// porque los badges de una fila SOLO se pintan cuando hay pertenencia, y sin ella
// toda fila desconocida se leería como "en ninguna".
let _byTrack = $state<Record<string, PlaylistPresenceItem[]>>({});
let _liked = $state<Record<string, boolean>>({});
// ids con petición en vuelo: un mismo tema puede aparecer en varias listas de la
// misma página (top tracks y singles del álbum) y se pediría dos veces
const _inflight = new Set<string>();

/** Pide en un lote los ids que aún no conocemos. Los ya conocidos no se
 *  revalidan: la pertenencia sólo cambia por una mutación nuestra —que actualiza
 *  este store— o por una edición en spotify, que el sync de 6h absorbe. */
async function ensure(trackIds: string[]): Promise<void> {
  const pending = [...new Set(trackIds)].filter(id =>
    (_byTrack[id] === undefined || _liked[id] === undefined) && !_inflight.has(id));
  if (pending.length === 0) return;

  pending.forEach(id => _inflight.add(id));
  for (let i = 0; i < pending.length; i += PLAYLIST_MEMBERSHIP_MAX_IDS) {
    const chunk = pending.slice(i, i + PLAYLIST_MEMBERSHIP_MAX_IDS);
    // las dos mitades van por separado a propósito: un fallo en los liked (que
    // pueden salir de spotify mientras el espejo no existe) no debe llevarse por
    // delante los badges de playlist, que son una lectura local
    await Promise.all([
      api.trackPlaylists(chunk)
        .then(byTrack => Object.assign(_byTrack, byTrack))
        .catch(() => { /* el siguiente ensure lo reintenta */ }),
      api.trackLiked(chunk)
        .then(({ liked }) => { const set = new Set(liked); chunk.forEach(id => { _liked[id] = set.has(id); }); })
        .catch(() => { /* el siguiente ensure lo reintenta */ }),
    ]);
    chunk.forEach(id => _inflight.delete(id));
  }
}

export const playlistMembershipStore = {
  get: (trackId: string | null | undefined): PlaylistPresenceItem[] | undefined =>
    trackId ? _byTrack[trackId] : undefined,
  isLiked: (trackId: string | null | undefined): boolean | undefined =>
    trackId ? _liked[trackId] : undefined,
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
  /** like/unlike optimista: pinta el corazón antes de la llamada y lo revierte si
   *  spotify la rechaza. Es el único camino de mutación de liked de la app */
  async toggleLiked(trackId: string): Promise<void> {
    const wasLiked = _liked[trackId] === true;
    _liked[trackId] = !wasLiked;
    try {
      if (wasLiked) await api.unlikeTrack(trackId);
      else await api.likeTrack(trackId);
    } catch {
      _liked[trackId] = wasLiked;
    }
  },
};
