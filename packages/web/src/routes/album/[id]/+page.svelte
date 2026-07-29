<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, createFetchController, type AlbumDetail, type AlbumCover, type ChartHistoryResponse, type RankingMetric, type AlbumTrackDisplay, type TopTrackItem, getRankingMetric, getAlbumTrackDisplay, getAlbumShowDuration, getAlbumShowAccolades } from '$lib/api';
  import { getDetailLayout } from '$lib/api/settings';
  import { defaultLayout, type DetailLayout } from '$lib/detail-layout';
  import { formatDuration, formatNumber, formatDate, formatShortDate, localDateKey } from '$lib/utils/format';
  import type { ChartEvent } from '$lib/utils/chart';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import RecentPlaysRail from '$lib/components/RecentPlaysRail.svelte';
  import ActivityChart from '$lib/components/charts/ActivityChart.svelte';
  import EntityHistoryChart from '$lib/components/charts/EntityHistoryChart.svelte';
  import MergeBanners from '$lib/components/MergeBanners.svelte';
  import StatsGrid from '$lib/components/StatsGrid.svelte';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { isSpotifyId } from '$lib/utils/entity-context';
  import { mergeModal } from '$lib/stores/merge-modal.svelte';
  import IconPlay from '$lib/icons/IconPlay.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';
  import IconShare from '$lib/icons/IconShare.svelte';
  import IconImage from '$lib/icons/IconImage.svelte';
  import IconMerge from '$lib/icons/IconMerge.svelte';
  import { canShare, publicHref, shareEntity } from '$lib/utils/share';


  let data = $state<AlbumDetail | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let showCoverPicker = $state(false);
  let uploadingCover = $state(false);
  let showMergeModal = $state(false);
  let mergeInitialStep = $state<'select' | 'remerge' | undefined>(undefined);
  let playActing = $state(false);
  let trackSort = $state<'ranked' | 'natural'>('ranked');
  let albumTrackDisplay = $state<AlbumTrackDisplay>('fill');
  let albumShowDuration = $state(true);
  let albumShowAccolades = $state(true);
  let naturalTracks = $state<TopTrackItem[] | null>(null);
  let loadingNatural = $state(false);
  let coverContainerEl: HTMLDivElement | undefined = $state();
  let layout = $state<DetailLayout>(defaultLayout('album'));
  const fetchCtrl = createFetchController();

  // lanzamiento del propio álbum + singles de adelanto ligados a él como eventos de las gráficas
  let releaseEvents = $derived.by<ChartEvent[]>(() => {
    if (!data) return [];
    const out: ChartEvent[] = [];
    if (data.album.releaseDate) {
      out.push({ id: data.album.id, date: data.album.releaseDate, label: data.album.name, kind: data.album.albumType === 'single' ? 'single' : 'album', imageUrl: data.album.imageUrl });
    }
    for (const s of data.relatedSingles ?? []) {
      out.push({ id: s.id, date: s.date, label: s.name, kind: 'single', imageUrl: s.imageUrl });
    }
    return out;
  });

  let displayTracks = $derived((trackSort === 'natural' && naturalTracks ? naturalTracks : data?.tracks ?? []).filter(t => t.playCount > 0));
  let trackSharePercents = $derived.by(() => {
    if (albumTrackDisplay === 'off') return undefined;
    const value = (t: TopTrackItem) => metric === 'plays' ? t.playCount : t.totalMs;
    const total = displayTracks.reduce((sum, t) => sum + value(t), 0);
    if (total === 0) return undefined;
    return displayTracks.map(t => (value(t) / total) * 100);
  });

  function handleCoverOutside(e: PointerEvent) {
    if (coverContainerEl && !coverContainerEl.contains(e.target as Node)) {
      showCoverPicker = false;
    }
  }

  function handleCoverKey(e: KeyboardEvent) {
    if (e.key === 'Escape') showCoverPicker = false;
  }

  $effect(() => {
    if (!showCoverPicker) return;
    document.addEventListener('pointerdown', handleCoverOutside);
    document.addEventListener('keydown', handleCoverKey);
    return () => {
      document.removeEventListener('pointerdown', handleCoverOutside);
      document.removeEventListener('keydown', handleCoverKey);
    };
  });

  let hasMultipleCovers = $derived((data?.covers?.length ?? 0) > 1 || data?.album.imageUrl === null);

  async function selectCover(imageUrl: string) {
    if (!data) return;
    await api.setAlbumCover($page.params.id, imageUrl);
    data = { ...data, album: { ...data.album, imageUrl } };
    if (imageUrl) {
      extractColor(imageUrl).then(([r, g, b]) => { heroColor = `${r},${g},${b}`; });
    }
  }

  async function handleCoverUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !data) return;
    uploadingCover = true;
    try {
      const { imageUrl } = await api.uploadAlbumCover($page.params.id, file);
      data = {
        ...data,
        album: { ...data.album, imageUrl },
        covers: [{ id: 0, imageUrl, source: 'upload' as const, observedAt: new Date().toISOString() }, ...(data.covers ?? [])],
      };
      extractColor(imageUrl).then(([r, g, b]) => { heroColor = `${r},${g},${b}`; });
    } finally {
      uploadingCover = false;
      input.value = '';
    }
  }

  async function loadNaturalTracks(id: string) {
    if (naturalTracks || loadingNatural) return;
    loadingNatural = true;
    try {
      const result = await api.albumDetail(id, 'all', 'natural');
      naturalTracks = result.tracks;
    } catch {}
    loadingNatural = false;
  }

  function toggleTrackSort(mode: 'ranked' | 'natural') {
    trackSort = mode;
    if (mode === 'natural' && !naturalTracks) {
      loadNaturalTracks($page.params.id);
    }
  }

  async function loadData(id: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const result = await api.albumDetail(id, 'all', metric === 'plays' ? 'plays' : 'time', signal);
      if (signal.aborted) return;
      data = result;
      if (result.album.imageUrl) {
        extractColor(result.album.imageUrl).then(([r, g, b]) => {
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
    albumTrackDisplay = getAlbumTrackDisplay();
    albumShowDuration = getAlbumShowDuration();
    albumShowAccolades = getAlbumShowAccolades();
    layout = getDetailLayout('album');
    initialized = true;
  });

  $effect(() => {
    const id = $page.params.id;
    void metric;
    void mergeModal.changeVersion;
    if (!initialized || !id) return;
    // resetear al cambiar de álbum para mostrar spinner
    if (id !== prevId) {
      data = null;
      chartHistoryData = null;
      naturalTracks = null;
      trackSort = 'ranked';
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

  <!-- despacha cada sección configurable por su key (ver detail-layout.ts) -->
  {#snippet sec(key)}
    {#if key === 'stats'}
      <StatsGrid stats={d.stats} />
    {:else if key === 'rankingBadges'}
      {#if !d.mergedInto}
        <RankingBadges entityType="album" entityId={$page.params.id} bind:highlightedMonth />
      {/if}
    {:else if key === 'chartStats'}
      {#if !d.mergedInto}
        <ChartStats entityType="album" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />
      {/if}
    {:else if key === 'activity'}
      <ActivityChart series={d.series} {metric} events={releaseEvents} />
    {:else if key === 'tracks'}
      {#if d.tracks.length > 0}
        <div class="section-header">
          <h2 class="section-title">Tracks</h2>
          <div class="track-sort-toggle">
            <button class:active={trackSort === 'ranked'} onclick={() => toggleTrackSort('ranked')}>Ranked</button>
            <button class:active={trackSort === 'natural'} onclick={() => toggleTrackSort('natural')}># Order</button>
          </div>
        </div>
        {#if trackSort === 'natural' && loadingNatural}
          <div class="loading"><div class="spinner"></div></div>
        {:else if trackSort === 'natural'}
          <TrackList items={displayTracks} showRank ranks={displayTracks.map(t => t.track?.trackNumber ?? undefined)} {metric} fillPercents={albumTrackDisplay === 'fill' ? trackSharePercents : undefined} percentLabels={albumTrackDisplay === 'percent' ? trackSharePercents : undefined} showDuration={albumShowDuration} showAccolades={albumShowAccolades} />
        {:else}
          <TrackList items={displayTracks} showRank {metric} fillPercents={albumTrackDisplay === 'fill' ? trackSharePercents : undefined} percentLabels={albumTrackDisplay === 'percent' ? trackSharePercents : undefined} showDuration={albumShowDuration} showAccolades={albumShowAccolades} />
        {/if}
      {/if}
    {:else if key === 'historyByYear'}
      {#if d.series.length > 1}
        <h2 class="section-title">History by year</h2>
        <EntityHistoryChart series={d.series} {metric} events={releaseEvents} />
      {/if}
    {:else if key === 'singles'}
      {#if (d.relatedSingles ?? []).length > 0}
        <h2 class="section-title">Singles</h2>
        <div class="track-list singles-list">
          {#each d.relatedSingles as s, i}
            <a href="/album/{s.id}" class="track-item">
              <span class="track-rank">{i + 1}</span>
              {#if s.imageUrl}
                <img class="track-art" src={s.imageUrl} alt={s.name} />
              {:else}
                <div class="track-art"></div>
              {/if}
              <div class="track-info">
                <div class="track-name">{s.name}</div>
                <div class="track-artist">{s.date}</div>
              </div>
              <div class="track-meta">
                <div class="track-plays">{metric === 'plays' ? `${s.playCount} plays` : formatDuration(s.totalMs)}</div>
                <div class="track-time">{metric === 'time' ? `${s.playCount} plays` : formatDuration(s.totalMs)}</div>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    {:else if key === 'recentPlays'}
      {#if d.recentPlays.length > 0}
        <RecentPlaysRail entityType="album" entityId={$page.params.id} initial={d.recentPlays} historyHref={`/history?album=${$page.params.id}`} />
      {/if}
    {/if}
  {/snippet}

  <div class="detail-body">
    <div class="detail-main">
  <div class="detail-hero-row">
    <div class="detail-hero">
      <div class="cover-container" bind:this={coverContainerEl}>
        <button
          class="cover-wrapper"
          onclick={() => { showCoverPicker = !showCoverPicker; }}
          aria-label={hasMultipleCovers ? 'Change cover' : 'Upload cover'}
        >
          {#if data.album.imageUrl}
            <img class="detail-image" src={data.album.imageUrl} alt={data.album.name} />
          {:else}
            <div class="detail-image detail-image--placeholder"></div>
          {/if}
          <span class="cover-edit-hint"><IconImage /></span>
        </button>
        {#if showCoverPicker}
          <div class="cover-picker">
            {#each data.covers ?? [] as cover}
              <button
                class="cover-thumb"
                class:cover-thumb--active={data.album.imageUrl === cover.imageUrl}
                onclick={() => selectCover(cover.imageUrl)}
                title="{cover.source} - {formatShortDate(cover.observedAt)}"
              >
                <img src={cover.imageUrl} alt="" />
              </button>
            {/each}
            <label class="cover-thumb cover-thumb--upload" title="Upload cover">
              {#if uploadingCover}
                <div class="spinner" style="width:16px;height:16px;"></div>
              {:else}
                +
              {/if}
              <input type="file" accept="image/*" onchange={handleCoverUpload} hidden />
            </label>
          </div>
        {/if}
      </div>
      <div class="detail-header-info">
        <h1>{data.album.name}{#if $page.params.id === nowPlayingStore.albumId} <span class="live-badge"><span class="live-dot"></span> Live</span>{/if}</h1>
        <p class="detail-subtitle">
          {#each data.artists as artist, i}
            <a href="/artist/{artist.id}">{artist.name}</a>{#if i < data.artists.length - 1}{', '}{/if}
          {/each}
        </p>
        {#if data.album.releaseDate || data.album.totalTracks}
          <p class="detail-meta-line">
            {#if data.album.releaseDate}{data.album.releaseDate}{/if}
            {#if data.album.releaseDate && data.album.totalTracks} &middot; {/if}
            {#if data.album.totalTracks}{data.album.totalTracks} tracks{/if}
          </p>
        {/if}
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
            await nowPlayingStore.playContext({ context_uri: `spotify:album:${$page.params.id}` });
            playActing = false;
          }}
        >
          <IconPlay />
        </button>
      {/if}
      {#if !data.mergedInto}
        <Accolades entityType="album" entityId={$page.params.id} />
      {/if}
      <EntityActionsMenu
        title="Actions"
        actions={[
          ...(isSpotifyId($page.params.id) ? [{ label: 'View in Spotify', icon: IconExternalLink, onClick: () => window.open(`https://open.spotify.com/album/${$page.params.id}`, '_blank') }] : []),
          ...(canShare() ? [{ label: 'Share', icon: IconShare, onClick: () => shareEntity(data?.album?.name ?? 'Album', publicHref()) }] : []),
          { label: hasMultipleCovers ? 'Change cover' : 'Upload cover', icon: IconImage, onClick: () => { showCoverPicker = true; } },
          { label: 'Manage merges', icon: IconMerge, onClick: () => { mergeInitialStep = undefined; showMergeModal = true; } },
          { label: 'Auto-merge tracks', icon: IconMerge, onClick: () => { mergeInitialStep = 'remerge'; showMergeModal = true; } },
        ]}
      />
    </div>
  </div>

  <MergeBanners entityType="album" mergedInto={d.mergedInto} mergedFrom={d.mergedFrom} onUnmerge={() => loadData($page.params.id)} />
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
    bind:show={showMergeModal}
    entityType="album"
    target={{ id: data.album.id, name: data.album.name, imageUrl: data.album.imageUrl }}
    parentId={data.artists[0]?.id ?? ''}
    existingMerges={data.mergedFrom}
    initialStep={mergeInitialStep}
    onMerged={() => { mergeInitialStep = undefined; loadData($page.params.id); }}
  />
{/if}

<style>
  .cover-container {
    position: relative;
    flex-shrink: 0;
  }
  .cover-wrapper {
    cursor: pointer;
    position: relative;
    display: block;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
  }
  .cover-edit-hint {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.05s;
    pointer-events: none;
  }
  .cover-wrapper:hover .cover-edit-hint {
    opacity: 1;
  }
  .cover-picker {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-width: 200px;
    padding: 0.5rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    z-index: 20;
  }
  .cover-thumb {
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    background: var(--bg-card);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.05s;
  }
  .cover-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cover-thumb--active {
    border-color: var(--accent);
  }
  .cover-thumb:hover:not(.cover-thumb--active) {
    border-color: var(--text-muted);
  }
  .cover-thumb--upload {
    border: 2px dashed var(--border);
    color: var(--text-muted);
    font-size: 1.1rem;
    font-weight: 600;
  }
  .cover-thumb--upload:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .track-sort-toggle {
    display: flex;
    gap: 2px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2px;
  }
  .track-sort-toggle button {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 500;
    transition: all 0.05s;
  }
  .track-sort-toggle button:hover {
    color: var(--text);
  }
  .track-sort-toggle button.active {
    background: var(--accent);
    color: #fff;
  }
</style>
