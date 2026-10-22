import type { MenuPoint } from '$lib/stores/context-menu.svelte';

// Selector de playlists flotante: una instancia de <PlaylistPicker> vive en el layout y
// la abre la entrada "Add to playlist" del menú contextual de un tema, en el punto donde
// estaba el menú. Es la puerta para los temas cuya fila no pinta el badge de playlists
// (no están en ninguna, o la lista no lleva badges).
export interface PlaylistPickerTarget extends MenuPoint {
  trackId: string;
}

let target = $state<PlaylistPickerTarget | null>(null);

export const playlistPicker = {
  get target() { return target; },
  open(trackId: string, at: MenuPoint) { target = { trackId, ...at }; },
  close() { target = null; },
};
