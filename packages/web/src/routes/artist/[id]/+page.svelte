<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, createFetchController, type ArtistDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric, getArtistShowAlbumAccolades, getArtistShowTrackAccolades } from '$lib/api';
  import { getDetailLayout } from '$lib/api/settings';
  import { defaultLayout, type DetailLayout } from '$lib/detail-layout';
  import { formatDuration, formatNumber, formatDate, formatShortDate, localDateKey } from '$lib/utils/format';
  import type { ChartEvent } from '$lib/utils/chart';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import RecentPlaysRail from '$lib/components/RecentPlaysRail.svelte';
  import ActivityChart from '$lib/components/charts/ActivityChart.svelte';
  import EntityHistoryChart from '$lib/components/charts/EntityHistoryChart.svelte';
  import MergeBanners from '$lib/components/MergeBanners.svelte';
  import StatsGrid from '$lib/components/StatsGrid.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import { openEntityContextMenu } from '$lib/utils/entity-context';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { isSpotifyId } from '$lib/utils/entity-context';
  import { mergeModal } from '$lib/stores/merge-modal.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';
  import IconShare from '$lib/icons/IconShare.svelte';
  import IconMerge from '$lib/icons/IconMerge.svelte';
  import { canShare, publicHref, shareEntity } from '$lib/utils/share';

  let data = $state<ArtistDetail | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let showAllTracks = $state(false);
  let showAllAlbums = $state(false);
  let showArtistMergeModal = $state(false);
  let playActing = $state(false);
  let artistShowAlbumAccolades = $state(true);
  let artistShowTrackAccolades = $state(true);
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let layout = $state<DetailLayout>(defaultLayout('artist'));
  const fetchCtrl = createFetchController();

  // lanzamientos del artista como eventos de las gráficas (singles más tenues que álbumes)
  let releaseEvents = $derived<ChartEvent[]>((data?.releases ?? []).map(r => ({
    date: r.date,
    label: r.name,
    kind: r.albumType === 'single' ? 'single' as const : 'album' as const,
  })));

  async function loadData(id: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const sort = metric === 'plays' ? 'plays' : 'time';
      const result = await api.artistDetail(id, 'all', {
        sort,
        trackLimit: showAllTracks ? 200 : 10,
        albumLimit: showAllAlbums ? 200 : 5,
        signal,
      });
      if (signal.aborted) return;
      data = result;
      if (result.artist.imageUrl) {
        extractColor(result.artist.imageUrl).then(([r, g, b]) => {
          if (!signal.aborted) heroColor = `${r},${g},${b}`;
        });
      } else {
        heroColor = '';
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  let initialized = false;
  let prevId = '';

  onMount(() => {
    metric = getRankingMetric();
    artistShowAlbumAccolades = getArtistShowAlbumAccolades();
    artistShowTrackAccolades = getArtistShowTrackAccolades();
    layout = getDetailLayout('artist');
    initialized = true;
  });

  $effect(() => {
    const id = $page.params.id;
    void metric;
    void showAllTracks;
    void showAllAlbums;
    void mergeModal.changeVersion;
    if (!initialized || !id) return;
    if (id !== prevId) {
      data = null;
      chartHistoryData = null;
      prevId = id;
    }
    loadData(id);
  });

</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  {@const d = data}
  {#if heroColor}
    <div class="detail-color-bg" style="background: linear-gradient(180deg, rgba({heroColor},0.18) 0%, transparent 100%);"></div>
  {/if}

  {#snippet heroRow()}
    <div class="detail-hero-row">
      <div class="detail-hero">
        {#if d.artist.imageUrl}
          <img class="detail-image detail-image--round" src={d.artist.imageUrl} alt={d.artist.name} />
        {:else}
          <div class="detail-image detail-image--round detail-image--placeholder"></div>
        {/if}
        <div class="detail-header-info">
          <h1>{d.artist.name}{#if nowPlayingStore.artistIds.includes($page.params.id)} <span class="live-badge"><span class="live-dot"></span> Live</span>{/if}</h1>
        </div>
      </div>
      <div class="hero-actions">
        {#if isSpotifyId($page.params.id)}
          <button
            class="play-entity-btn"
            title="Play on Spotify"
            disabled={playActing}
            onclick={async () => {
              playActing = true;
              await nowPlayingStore.playContext({ context_uri: `spotify:artist:${$page.params.id}` });
              playActing = false;
            }}
          >
            <IconPlay />
          </button>
        {/if}
        {#if !d.mergedInto}
          <Accolades entityType="artist" entityId={$page.params.id} />
        {/if}
        <EntityActionsMenu
          title="Actions"
          actions={[
            ...(isSpotifyId($page.params.id) ? [{ label: 'View in Spotify', icon: IconExternalLink, onClick: () => window.open(`https://open.spotify.com/artist/${$page.params.id}`, '_blank') }] : []),
            ...(canShare() ? [{ label: 'Share', icon: IconShare, onClick: () => shareEntity(data?.name ?? 'Artist', publicHref()) }] : []),
            { label: 'Manage merges', icon: IconMerge, onClick: () => { showArtistMergeModal = true; } },
          ]}
        />
      </div>
    </div>
  {/snippet}

  <!-- despacha cada sección configurable por su key (ver detail-layout.ts) -->
  {#snippet sec(key)}
    {#if key === 'stats'}
      <StatsGrid stats={d.stats} />
    {:else if key === 'rankingBadges'}
      {#if !d.mergedInto}
        <RankingBadges entityType="artist" entityId={$page.params.id} bind:highlightedMonth />
      {/if}
    {:else if key === 'chartStats'}
      {#if !d.mergedInto}
        <ChartStats entityType="artist" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />
      {/if}
    {:else if key === 'activity'}
      <ActivityChart series={d.series} {metric} events={releaseEvents} />
    {:else if key === 'topTracks'}
      {#if d.topTracks.length > 0}
        <div class="section-header">
          <h2 class="section-title">Top tracks</h2>
          <button class="show-all-btn" onclick={() => showAllTracks = !showAllTracks}>
            {showAllTracks ? 'Show less' : 'Show all'}
          </button>
        </div>
        <TrackList items={d.topTracks} showRank {metric} showAccolades={artistShowTrackAccolades} />
      {/if}
    {:else if key === 'topAlbums'}
      {#if d.topAlbums.length > 0}
        <div class="section-header">
          <h2 class="section-title">Top albums</h2>
          <button class="show-all-btn" onclick={() => showAllAlbums = !showAllAlbums}>
            {showAllAlbums ? 'Show less' : 'Show all'}
          </button>
        </div>
        <div class="track-list">
          {#each d.topAlbums as item, i}
            {#if item.album}
              <a
                href="/album/{item.albumId}"
                class="track-item"
                oncontextmenu={openEntityContextMenu({ type: 'album', id: item.albumId, name: item.album.name, imageUrl: item.album.imageUrl, parentArtistId: $page.params.id })}
              >
                <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
                {#if item.album.imageUrl}
                  <img class="track-art" src={item.album.imageUrl} alt={item.album.name} />
                {:else}
                  <div class="track-art"></div>
                {/if}
                <div class="track-info">
                  <div class="track-name">{item.album.name}</div>
                  <div class="track-artist">{item.album.releaseDate ?? ''}</div>
                </div>
                {#if artistShowAlbumAccolades}
                  <Accolades entityType="album" entityId={item.albumId} />
                {/if}
                <div class="track-meta">
                  <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
                  <div class="track-time">{metric === 'time' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
                </div>
              </a>
            {/if}
          {/each}
        </div>
      {/if}
    {:else if key === 'historyByYear'}
      {#if d.series.length > 1}
        <h2 class="section-title">History by year</h2>
        <EntityHistoryChart series={d.series} {metric} events={releaseEvents} />
      {/if}
    {:else if key === 'recentPlays'}
      {#if d.recentPlays.length > 0}
        <RecentPlaysRail entityType="artist" entityId={$page.params.id} initial={d.recentPlays} historyHref={`/history?artist=${$page.params.id}`} />
      {/if}
    {/if}
  {/snippet}

  <div class="detail-body">
    <div class="detail-main">
      {@render heroRow()}
      <MergeBanners entityType="artist" mergedInto={d.mergedInto} mergedFrom={d.mergedFrom} onUnmerge={() => loadData($page.params.id)} />
      {#each layout.main as key (key)}
        {@render sec(key)}
      {/each}
    </div>

    <aside class="detail-rail">
      {#each layout.rail as key (key)}
        {@render sec(key)}
      {/each}
    </aside>
  </div>
{/if}

{#if data}
  <MergeEntityModal
    bind:show={showArtistMergeModal}
    entityType="artist"
    target={{ id: data.artist.id, name: data.artist.name, imageUrl: data.artist.imageUrl }}
    existingMerges={data.mergedFrom}
    onMerged={() => loadData($page.params.id)}
  />
{/if}

<style>
  .merge-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.7rem;
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius);
    opacity: 0;
    transition: opacity 0.05s, color 0.05s, border-color 0.05s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  :global(.track-item:hover) .merge-btn {
    opacity: 1;
  }
  .merge-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>

