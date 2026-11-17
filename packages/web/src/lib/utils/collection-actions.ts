// acciones de una colección que comparten el menú contextual de su fila y el menú del hero
// de su página (Play, renombrar, borrar o dejar de vigilar). Cada una avisa con
// `collectionsStore.invalidate()` y devuelve si hizo algo, para que la página recargue o
// se vaya; el menú de la fila no necesita más.
import { api } from '$lib/api';
import { collectionsStore } from '$lib/stores/collections.svelte';
import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
import { toastStore } from '$lib/stores/toast.svelte';
import { errorMessage } from '$lib/utils/errors';

/** Reproduce la colección: spotify no tiene contexto para ella, así que va su cola. */
export async function playCollection(collectionId: number): Promise<void> {
  try {
    const { trackIds } = await api.collectionPlayOrder(collectionId);
    if (trackIds.length > 0) await nowPlayingStore.playContext({ uris: trackIds.map(id => `spotify:track:${id}`) });
    else toastStore.show('Nothing to play yet');
  } catch (e) {
    toastStore.show(errorMessage(e, 'Error playing the collection'));
  }
}

export async function renameCollection(collectionId: number, current: string): Promise<boolean> {
  const name = prompt('Collection name', current)?.trim();
  if (!name || name === current) return false;
  try {
    await api.updateCollection(collectionId, { name });
    collectionsStore.invalidate();
    return true;
  } catch (e) {
    toastStore.show(errorMessage(e, 'Error renaming the collection'));
    return false;
  }
}

/** Borrar la colección; si es un álbum que viene, eso es dejar de vigilarlo (su fila de
 *  `upcoming_folds` se queda y el barrido no la vuelve a crear). */
export async function deleteCollection(collectionId: number, name: string, upcoming: boolean): Promise<boolean> {
  const question = upcoming
    ? `Stop tracking "${name}"? Its singles go back to ranking on their own and it won't come back.`
    : `Delete "${name}"? Its members go back to ranking on their own.`;
  if (!confirm(question)) return false;
  try {
    await api.deleteCollection(collectionId);
    collectionsStore.invalidate();
    return true;
  } catch (e) {
    toastStore.show(errorMessage(e, upcoming ? 'Error stopping tracking' : 'Error deleting the collection'));
    return false;
  }
}
