import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
import { mergeModal } from '$lib/stores/merge-modal.svelte';
import IconPlay from '$lib/icons/IconPlay.svelte';
import IconQueue from '$lib/icons/IconQueue.svelte';
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

// acciones del menú contextual de una entidad. Exportado para las filas que
// añaden acciones propias al mismo menú (la atribución de un setlist)
// contexto de un tema a partir de su TrackInfo (menú contextual de listas y
// tarjetas): la carátula del álbum como imagen y el primer artista como padre
export const trackEntity = (t: { id: string; name: string; album: { imageUrl: string | null } | null; artists: { id: string }[] }): EntityContext =>
  ({ type: 'track', id: t.id, name: t.name, imageUrl: t.album?.imageUrl ?? null, parentArtistId: t.artists[0]?.id });

/** Acciones del menú contextual de una entidad.
 *  `relations: false` las omite para quien ya pinta las suyas (las filas de la sección
 *  de relaciones), que si no acaban con dos puertas al mismo sitio. */
export function entityContextActions(entity: EntityContext, { relations = true }: { relations?: boolean } = {}): ContextMenuAction[] {
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
          const { nowPlayingStore } = await import('$lib/stores/now-playing.svelte');
          try {
            await api.queueTrack(entity.id);
            // spotify pone lo encolado justo detrás del tema actual, así que el
            // "next" del sidebar acaba de quedarse obsoleto
            nowPlayingStore.refreshQueue();
            toastStore.show(`Added to queue`);
          } catch {
            toastStore.show('Failed to add to queue');
          }
        },
      });
    }
  }
  // UNA sola entrada para merges y relaciones: son la misma sección del detalle, y dos
  // entradas seguidas eran dos nombres para el mismo concepto. Abre el modal de merges,
  // que en artistas trae pestaña hacia el de relaciones (ver ModalTabs); un álbum o un
  // tema no se "relaciona", así que ahí es la única cara.
  if (relations) {
    actions.push({
      label: 'Relations',
      icon: IconLink,
      disabled: entity.type !== 'artist' && !entity.parentArtistId,
      onClick: () => mergeModal.open({
        entityType: entity.type,
        target: { id: entity.id, name: entity.name, imageUrl: entity.imageUrl },
        parentId: entity.parentArtistId,
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
    const actions = entityContextActions(entity);
    contextMenu.open(e, onAction
      ? actions.map(a => ({ ...a, onClick: () => { onAction(); return a.onClick(); } }))
      : actions);
  };
}
