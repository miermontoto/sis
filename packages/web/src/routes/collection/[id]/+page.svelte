<script lang="ts">
  // Detalle de una colección ("álbum lógico"): las mismas secciones que un álbum
  // —cifras, badges de ranking, gráfica, lista de temas, recent plays— porque para
  // los rankings ES un álbum: compite en el eje álbum bajo la clave `collection:N`
  // que emite resolvedEntityId, y sus miembros no compiten mientras esté.
  //
  // Lo que un álbum no tiene es la sección de miembros: qué discos y qué temas la
  // componen, con las cifras que cada uno aporta y de dónde se quitan.
  import { isAbortError, errorMessage } from '$lib/utils/errors';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import {
    api, createFetchController, collectionKey, getRankingMetric, getShowPlaylistBadges,
    type CollectionDetail, type CollectionMember, type ChartHistoryResponse, type RankingMetric,
  } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import { resolveEntityColor, type Rgb } from '$lib/utils/color';
  import { contextMenu, type ContextMenuAction } from '$lib/stores/context-menu.svelte';
  import { entityContextActions } from '$lib/utils/entity-context';
  import { toastStore } from '$lib/stores/toast.svelte';
  import TrackList from '$lib/components/TrackList.svelte';
  import TrackItem from '$lib/components/TrackItem.svelte';
  import MetricMeta from '$lib/components/MetricMeta.svelte';
  import ActivityChart from '$lib/components/charts/ActivityChart.svelte';
  import EntityHistoryChart from '$lib/components/charts/EntityHistoryChart.svelte';
  import StatsGrid from '$lib/components/StatsGrid.svelte';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import LibraryPicker from '$lib/components/LibraryPicker.svelte';
  import IconEdit from '$lib/icons/IconEdit.svelte';
  import IconTrash from '$lib/icons/IconTrash.svelte';
  import IconPlus from '$lib/icons/IconPlus.svelte';

  const collectionId = $derived(Number($page.params.id ?? 0));
  // la clave con la que la colección compite en el eje álbum: es lo que entienden
  // los endpoints de ranking y de chart history
  const albumKey = $derived(collectionKey(collectionId));

  let data = $state<CollectionDetail | null>(null);
  let loading = $state(true);
  let error = $state('');
  let metric = $state<RankingMetric>('time');
  let showPlaylistBadges = $state(true);
  let highlightedMonth = $state('');
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let busy = $state(false);
  let adding = $state(false);
  const fetchCtrl = createFetchController();

  // el tinte sale de resolveEntityColor, como en todo lo que se tiñe por álbum: el
  // pick manual manda sobre el extraído de la portada
  let heroRgb = $state<Rgb | null>(null);

  // el tracklist de la colección trae TODOS los temas de sus álbumes miembro, también
  // los que nunca sonaron (el detalle de álbum completa el tracklist server-side). La
  // lista rankeada enseña sólo los escuchados, igual que la del álbum
  let playedTracks = $derived((data?.tracks ?? []).filter(t => t.playCount > 0));

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function load(id: number) {
    const signal = fetchCtrl.reset();
    loading = true;
    error = '';
    try {
      const res = await api.collectionDetail(id, 'all', undefined, signal);
      if (signal.aborted) return;
      data = res;
      resolveEntityColor(res.collection.color, res.collection.imageUrl)
        .then(rgb => { if (!signal.aborted) heroRgb = rgb; });
    } catch (e) {
      if (isAbortError(e)) return;
      error = errorMessage(e, 'Collection not found');
    } finally {
      loading = false;
    }
  }

  async function addMembers(items: { kind: string; id: string }[]) {
    if (!data) return;
    adding = true;
    try {
      for (const item of items) {
        // los artistas no son miembros posibles: una colección agrupa discos y temas
        if (item.kind !== 'album' && item.kind !== 'track') continue;
        await api.addCollectionMember(collectionId, item.kind, item.id);
      }
      await load(collectionId);
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error adding the member'));
    } finally {
      adding = false;
    }
  }

  async function removeMember(m: CollectionMember) {
    busy = true;
    try {
      await api.removeCollectionMember(collectionId, m.entityType, m.entityId);
      await load(collectionId);
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error removing the member'));
    } finally {
      busy = false;
    }
  }

  async function rename() {
    const d = data;
    if (!d) return;
    const name = prompt('Collection name', d.collection.name)?.trim();
    if (!name || name === d.collection.name) return;
    try {
      await api.updateCollection(collectionId, { name });
      await load(collectionId);
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error renaming the collection'));
    }
  }

  async function destroy() {
    const d = data;
    if (!d) return;
    if (!confirm(`Delete "${d.collection.name}"? Its members go back to ranking on their own.`)) return;
    try {
      await api.deleteCollection(collectionId);
      goto(`/artist/${d.collection.artistId}`);
    } catch (e) {
      toastStore.show(errorMessage(e, 'Error deleting the collection'));
    }
  }

  // menú contextual de un miembro: sus acciones de siempre + sacarlo de aquí, que es
  // la única acción que sólo existe en esta página
  function memberMenu(m: CollectionMember) {
    return (e: MouseEvent) => {
      const actions: ContextMenuAction[] = [
        ...entityContextActions({
          type: m.entityType,
          id: m.entityId,
          name: m.name,
          imageUrl: m.imageUrl,
          parentArtistId: m.artists[0]?.id,
        }),
        { label: 'Remove from collection', icon: IconTrash, danger: true, onClick: () => removeMember(m) },
      ];
      contextMenu.open(e, actions);
    };
  }

  onMount(() => {
    metric = getRankingMetric();
    showPlaylistBadges = getShowPlaylistBadges();
  });

  $effect(() => {
    const id = collectionId;
    if (!id) return;
    load(id);
  });
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if !data}
  <div class="empty-state">{error || 'Collection not found.'}</div>
{:else}
  {@const d = data}
  {#if heroRgb}
    <div class="detail-color-bg" style="background: linear-gradient(180deg, rgba({heroRgb.join(',')},0.18) 0%, transparent 100%);"></div>
  {/if}

  <div class="detail-body">
    <div class="detail-main">
      <div class="detail-hero-row">
        <div class="detail-hero">
          {#if d.collection.imageUrl}
            <img class="detail-image" src={d.collection.imageUrl} alt={d.collection.name} />
          {:else}
            <div class="detail-image collection-image--empty"></div>
          {/if}
          <div class="detail-header-info">
            <div class="data-label">Collection</div>
            <h1>{d.collection.name}</h1>
            <p class="detail-subtitle">
              <a href="/artist/{d.collection.artistId}">{d.collection.artistName}</a>
            </p>
            <p class="detail-meta-line">
              {plural(d.collection.albumCount, 'album')} · {plural(d.collection.trackCount, 'loose track')} · {plural(playedTracks.length, 'song')} played
            </p>
          </div>
        </div>
        <div class="hero-actions">
          <EntityActionsMenu
            title="Actions"
            actions={[
              { label: 'Rename', icon: IconEdit, onClick: rename },
              { label: 'Delete collection', icon: IconTrash, danger: true, onClick: destroy },
            ]}
          />
        </div>
      </div>

      <section class="detail-section">
        <StatsGrid stats={d.stats} />
      </section>

      <section class="detail-section">
        <RankingBadges entityType="album" entityId={albumKey} bind:highlightedMonth />
      </section>

      <section class="detail-section">
        <ChartStats entityType="album" entityId={albumKey} bind:chartData={chartHistoryData} bind:highlightedMonth />
      </section>

      {#if d.series.length > 1}
        <section class="detail-section">
          <ActivityChart series={d.series} {metric} />
        </section>
      {/if}

      <section class="detail-section">
        <div class="section-header">
          <h2 class="section-title">Members</h2>
          <button class="range-btn" onclick={() => { adding = !adding; }}>
            <IconPlus size={13} /> Add
          </button>
        </div>

        {#if adding}
          <div class="card member-picker">
            <LibraryPicker onadd={addMembers} />
          </div>
        {/if}

        <div class="track-list">
          {#each d.members as m (m.entityType + m.entityId)}
            {#snippet memberSubtitle()}
              <!-- una sola expresión: svelte recorta el espacio inicial de un texto
                   que sigue a una etiqueta y el separador salía pegado -->
              <span>{[m.entityType === 'album' ? 'Album' : 'Track', m.artists.map(a => a.name).join(', ')].filter(Boolean).join(' · ')}</span>
            {/snippet}
            {#snippet memberMeta()}
              <MetricMeta playCount={m.playCount} totalMs={m.totalMs} {metric} />
            {/snippet}
            <!-- el menú contextual es el camino de siempre para las acciones de fila;
                 el enlace del nombre sigue siendo el control accesible -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div oncontextmenu={memberMenu(m)}>
              <TrackItem
                name={m.name}
                nameHref={m.entityType === 'album' ? `/album/${m.entityId}` : `/track/${m.entityId}`}
                imageUrl={m.imageUrl}
                subtitle={memberSubtitle}
                meta={memberMeta}
              />
            </div>
          {:else}
            <div class="empty-state">
              Nothing in this collection yet. Add albums or loose tracks and they will rank together as one.
            </div>
          {/each}
        </div>
      </section>

      {#if playedTracks.length > 0}
        <section class="detail-section">
          <h2 class="section-title">Tracks</h2>
          <TrackList items={playedTracks} showRank {metric} showLibraryBadges={showPlaylistBadges} />
        </section>
      {/if}
    </div>

    <aside class="detail-rail">
      {#if d.series.length > 1}
        <section class="detail-section">
          <h2 class="section-title">History by year</h2>
          <EntityHistoryChart series={d.series} {metric} />
        </section>
      {/if}

      {#if d.collection.notes}
        <section class="detail-section">
          <h2 class="section-title">Notes</h2>
          <div class="card notes-card">{d.collection.notes}</div>
        </section>
      {/if}

      {#if d.recentPlays.length > 0}
        <section class="detail-section">
          <h2 class="section-title">Recent plays</h2>
          <!-- lista suelta y no RecentPlaysRail: el rail pagina contra /stats/history,
               que filtra por un id de álbum real y no sabe de colecciones -->
          <TrackList items={d.recentPlays} showTime />
        </section>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .collection-image--empty {
    background: var(--bg-hover);
  }
  .member-picker {
    padding: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .notes-card {
    padding: 0.75rem;
    font-size: 0.85rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }
</style>
