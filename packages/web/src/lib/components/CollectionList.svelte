<script lang="ts">
  // Colecciones ("álbumes lógicos") de un artista, en su ficha. Cada fila lleva al
  // detalle de la colección; las acciones van en el menú contextual, como en el resto
  // de listas de la app.
  // La lista se asume no vacía: sin colecciones la ficha no monta la sección y el alta
  // queda en el menú del hero, igual que los conciertos.
  import { api, collectionKey, type AlbumCollectionSummary, type RankingMetric } from '$lib/api';
  import { errorMessage } from '$lib/utils/errors';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { contextMenu } from '$lib/stores/context-menu.svelte';
  import TrackItem from './TrackItem.svelte';
  import MetricMeta from './MetricMeta.svelte';
  import IconTrash from '$lib/icons/IconTrash.svelte';

  let {
    collections,
    metric = 'time',
    onManage,
    onChanged,
  }: {
    collections: AlbumCollectionSummary[];
    metric?: RankingMetric;
    onManage: () => void;
    onChanged: () => void;
  } = $props();

  let busy = $state(false);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function remove(c: AlbumCollectionSummary) {
    if (busy) return;
    if (!confirm(`Delete "${c.name}"? Its members go back to ranking on their own.`)) return;
    busy = true;
    try {
      await api.deleteCollection(c.id);
      onChanged();
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error deleting collection'));
    } finally {
      busy = false;
    }
  }

  function menu(c: AlbumCollectionSummary) {
    return (e: MouseEvent) => {
      contextMenu.open(e, [
        { label: 'Delete collection', icon: IconTrash, danger: true, onClick: () => remove(c) },
      ]);
    };
  }
</script>

<div class="section-header">
  <h2 class="section-title">Collections</h2>
  <button class="show-all-btn" onclick={onManage}>Manage</button>
</div>

<div class="track-list">
  {#each collections as c (c.id)}
    {#snippet subtitle()}
      <span>{plural(c.albumCount, 'album')} · {plural(c.trackCount, 'loose track')}</span>
    {/snippet}
    {#snippet meta()}
      <MetricMeta playCount={c.playCount} totalMs={c.totalMs} {metric} />
    {/snippet}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div oncontextmenu={menu(c)}>
      <TrackItem name={c.name} nameHref={`/album/${collectionKey(c.id)}`} imageUrl={c.imageUrl} {subtitle} {meta} />
    </div>
  {/each}
</div>
