// Helper para menús contextuales por entidad. Devuelve un handler `oncontextmenu`
// listo para colgar en cualquier fila de track/album/artist.
import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
import { mergeModal } from '$lib/stores/merge-modal.svelte';

export type EntityType = 'album' | 'artist' | 'track';

export interface EntityContext {
  type: EntityType;
  id: string;
  name: string;
  imageUrl: string | null;
  /** artistId padre. Necesario para merges de album/track; ignorado para artist. */
  parentArtistId?: string;
}

function buildActions(entity: EntityContext): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [
    {
      label: 'Play',
      onClick: async () => {
        const { nowPlayingStore } = await import('$lib/stores/now-playing.svelte');
        const opts = entity.type === 'track'
          ? { uris: [`spotify:track:${entity.id}`] }
          : { context_uri: `spotify:${entity.type}:${entity.id}` };
        nowPlayingStore.playContext(opts);
      },
    },
    {
      label: 'Manage merges',
      disabled: entity.type !== 'artist' && !entity.parentArtistId,
      onClick: () => mergeModal.open({
        entityType: entity.type,
        target: { id: entity.id, name: entity.name, imageUrl: entity.imageUrl },
        parentId: entity.parentArtistId,
      }),
    },
  ];
  return actions;
}

/** Para usar inline: `oncontextmenu={openEntityContextMenu(entity)}`. */
export function openEntityContextMenu(entity: EntityContext) {
  return (e: MouseEvent) => {
    contextMenu.open(e, buildActions(entity));
  };
}
