import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
import { mergeModal } from '$lib/stores/merge-modal.svelte';
import { relateModal } from '$lib/stores/relate-modal.svelte';
import IconPlay from '$lib/icons/IconPlay.svelte';
import IconQueue from '$lib/icons/IconQueue.svelte';
import IconMerge from '$lib/icons/IconMerge.svelte';
import IconLink from '$lib/icons/IconLink.svelte';

export function isSpotifyId(id: string): boolean {
  return !id.startsWith('local:') && !id.startsWith('import:');
}

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
  const actions: ContextMenuAction[] = [];
  if (isSpotifyId(entity.id)) {
    actions.push({
      label: 'Play',
      icon: IconPlay,
      onClick: async () => {
        const { nowPlayingStore } = await import('$lib/stores/now-playing.svelte');
        const opts = entity.type === 'track'
          ? { uris: [`spotify:track:${entity.id}`] }
          : { context_uri: `spotify:${entity.type}:${entity.id}` };
        nowPlayingStore.playContext(opts);
      },
    });
    if (entity.type === 'track') {
      actions.push({
        label: 'Add to queue',
        icon: IconQueue,
        onClick: async () => {
          const { api } = await import('$lib/api');
          const { toastStore } = await import('$lib/stores/toast.svelte');
          try {
            await api.queueTrack(entity.id);
            toastStore.show(`Added to queue`);
          } catch {
            toastStore.show('Failed to add to queue');
          }
        },
      });
    }
  }
  actions.push({
      label: 'Manage merges',
      icon: IconMerge,
      disabled: entity.type !== 'artist' && !entity.parentArtistId,
      onClick: () => mergeModal.open({
        entityType: entity.type,
        target: { id: entity.id, name: entity.name, imageUrl: entity.imageUrl },
        parentId: entity.parentArtistId,
      }),
    },
  );
  // las relaciones soft son cosa de artistas: un álbum o un track no se "relaciona"
  if (entity.type === 'artist') {
    actions.push({
      label: 'Related artists',
      icon: IconLink,
      onClick: () => relateModal.open({
        target: { id: entity.id, name: entity.name, imageUrl: entity.imageUrl },
      }),
    });
  }
  return actions;
}

/**
 * Para usar inline: `oncontextmenu={openEntityContextMenu(entity)}`.
 * `onAction` se ejecuta antes de cualquier acción: sirve para que un anfitrión efímero
 * (el modal de búsqueda) se cierre y no quede apilado bajo el modal de merge/relate.
 */
export function openEntityContextMenu(entity: EntityContext, onAction?: () => void) {
  return (e: MouseEvent) => {
    const actions = buildActions(entity);
    contextMenu.open(e, onAction
      ? actions.map(a => ({ ...a, onClick: () => { onAction(); return a.onClick(); } }))
      : actions);
  };
}
