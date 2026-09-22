import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
import { mergeModal } from '$lib/stores/merge-modal.svelte';
import { collectionModal } from '$lib/stores/collection-modal.svelte';
import { collectionsStore } from '$lib/stores/collections.svelte';
import IconPlay from '$lib/icons/IconPlay.svelte';
import IconQueue from '$lib/icons/IconQueue.svelte';
import IconLink from '$lib/icons/IconLink.svelte';
import IconAlbum from '$lib/icons/IconAlbum.svelte';

// `collection:` entra en la misma familia que local:/import:: un álbum lógico tiene
// fila en `albums` pero no existe en spotify, así que no hay nada que abrir, encolar
// ni reproducir por contexto (ver shared/collections.ts)
export function isSpotifyId(id: string): boolean {
  return !id.startsWith('local:') && !id.startsWith('import:') && !id.startsWith('collection:');
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
  // "Add to collection" sólo si el artista de la fila TIENE alguna colección: sin
  // ninguna, la entrada no lleva a nada útil (habría que crearla primero, y eso se hace
  // desde la página del artista). El índice está cargado en memoria, así que la
  // decisión es síncrona — ver stores/collections.svelte.ts.
  // Una colección no entra en otra: anidarlas contaría sus plays dos veces.
  if ((entity.type === 'album' || entity.type === 'track')
    && !entity.id.startsWith('collection:')
    && collectionsStore.hasForArtist(entity.parentArtistId)) {
    actions.push({
      label: 'Add to collection',
      icon: IconAlbum,
      onClick: () => collectionModal.open({
        entityType: entity.type as 'album' | 'track',
        entity: { id: entity.id, name: entity.name, imageUrl: entity.imageUrl },
        artistId: entity.parentArtistId!,
        artistName: collectionsStore.artistName(entity.parentArtistId),
      }),
    });
  }
  // UNA sola entrada para merges y relaciones: son la misma sección del detalle, y dos
  // entradas seguidas eran dos nombres para el mismo concepto. Abre el modal de merges,
  // que en artistas trae pestaña hacia el de relaciones (ver ModalTabs); un álbum o un
  // tema no se "relaciona", así que ahí es la única cara.
  // un álbum lógico tampoco se mergea: no es un lanzamiento, y su menú del hero
  // tampoco ofrece la entrada
  if (relations && !entity.id.startsWith('collection:')) {
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
    // sin acciones no se abre nada: una fila de álbum lógico no se reproduce, no se
    // mergea y no cabe en otra colección, y un panel vacío es peor que ninguno
    if (actions.length === 0) return;
    contextMenu.open(e, onAction
      ? actions.map(a => ({ ...a, onClick: () => { onAction(); return a.onClick(); } }))
      : actions);
  };
}
