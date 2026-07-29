<script lang="ts">
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';
  import { api, createFetchController, type TrackDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric } from '$lib/api';
  import { getDetailLayout } from '$lib/api/settings';
  import { defaultLayout, type DetailLayout } from '$lib/detail-layout';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { formatDuration, formatTrackLength, formatNumber, formatDate, formatShortDate, localDateKey } from '$lib/utils/format';
  import type { ChartEvent } from '$lib/utils/chart';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor } from '$lib/utils/color';
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
  import IconHeartFilled from '$lib/icons/IconHeartFilled.svelte';
  import IconHeartOutline from '$lib/icons/IconHeartOutline.svelte';
  import IconQueue from '$lib/icons/IconQueue.svelte';
  import IconExternalLink from '$lib/icons/IconExternalLink.svelte';
  import IconShare from '$lib/icons/IconShare.svelte';
  import IconMerge from '$lib/icons/IconMerge.svelte';
  import PlaylistPopover from '$lib/components/PlaylistPopover.svelte';
  import { canShare, publicHref, shareEntity } from '$lib/utils/share';

  let data = $state<TrackDetail | null>(null);
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let showMergeModal = $state(false);
  let playActing = $state(false);
  let isLiked = $state(false);
  let likeLoading = $state(false);
  let likeActing = $state(false);
  let editingDuration = $state(false);
  let durationInput = $state('');
  let recheckingDuration = $state(false);
  let layout = $state<DetailLayout>(defaultLayout('track'));
  const fetchCtrl = createFetchController();

  // lanzamientos de los álbumes donde aparece el track (single vs álbum) como eventos de las gráficas
  let releaseEvents = $derived.by<ChartEvent[]>(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: ChartEvent[] = [];
    const push = (id: string, name: string, date: string | null | undefined, type: string | null | undefined, imageUrl: string | null | undefined) => {
      if (!date || seen.has(id)) return;
      seen.add(id);
      out.push({ id, date, label: name, kind: type === 'single' ? 'single' : 'album', imageUrl });
    };
    if (data.track.album) push(data.track.album.id, data.track.album.name, data.track.album.releaseDate, data.track.album.albumType, data.track.album.imageUrl);
    for (const b of data.albumBreakdown) push(b.albumId, b.album.name, b.album.releaseDate, b.album.albumType, b.album.imageUrl);
    return out;
  });

  async function loadData(id: string) {
    const signal = fetchCtrl.reset();
    loading = true;
    try {
      const result = await api.trackDetail(id, 'all', signal);
      if (signal.aborted) return;
      data = result;
      const imgUrl = result.track.album?.imageUrl;
      if (imgUrl) {
        extractColor(imgUrl).then(([r, g, b]) => {
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
    layout = getDetailLayout('track');
    initialized = true;
    shortcutStore.registerPageShortcuts(
      [{ key: 'Q', description: 'Add to queue', category: 'page' }],
      (e) => {
        if (e.key.toLowerCase() === 'q' && isSpotifyId($page.params.id)) {
          e.preventDefault();
          api.queueTrack($page.params.id)
            .then(() => toastStore.show('Added to queue'))
            .catch(() => toastStore.show('Failed to add to queue'));
          return true;
        }
        return false;
      },
    );
  });
  onDestroy(() => {
    shortcutStore.unregisterPageShortcuts();
  });

  $effect(() => {
    const id = $page.params.id;
    void mergeModal.changeVersion;
    if (!initialized || !id) return;
    if (id !== prevId) {
      data = null;
      chartHistoryData = null;
      prevId = id;
    }
    loadData(id);
    if (isSpotifyId(id)) {
      likeLoading = true;
      api.checkTrackLiked(id).then(r => { isLiked = r.isLiked; }).catch(() => { isLiked = false; }).finally(() => { likeLoading = false; });
    } else {
      isLiked = false;
      likeLoading = false;
    }
  });

  async function toggleLike() {
    const id = $page.params.id;
    if (!id || likeActing) return;
    likeActing = true;
    const wasLiked = isLiked;
    isLiked = !wasLiked;
    try {
      if (wasLiked) await api.unlikeTrack(id);
      else await api.likeTrack(id);
      nowPlayingStore.isLiked = isLiked;
    } catch {
      isLiked = wasLiked;
    } finally {
      likeActing = false;
    }
  }

  function parseDurationInput(val: string): number | null {
    // acepta "3:45", "3m45s", "225" (segundos)
    let match = val.match(/^(\d+):(\d{1,2})$/);
    if (match) return (parseInt(match[1]) * 60 + parseInt(match[2])) * 1000;
    match = val.match(/^(\d+)m\s*(\d{1,2})s?$/);
    if (match) return (parseInt(match[1]) * 60 + parseInt(match[2])) * 1000;
    match = val.match(/^(\d+)$/);
    if (match) return parseInt(match[1]) * 1000;
    return null;
  }

  async function saveDuration() {
    const ms = parseDurationInput(durationInput);
    if (ms === null || !data) return;
    try {
      await api.updateTrackDuration($page.params.id, ms);
      data.track.durationMs = ms;
    } catch (e) {
      console.error('error actualizando duración:', e);
    }
    editingDuration = false;
  }

  async function recheckDuration() {
    if (recheckingDuration || !data) return;
    recheckingDuration = true;
    try {
      const res = await api.refreshTrackDuration($page.params.id);
      data.track.durationMs = res.durationMs;
      if (res.changed) {
        toastStore.show(`Duración actualizada: ${formatTrackLength(res.durationMs)}`, 'success');
      } else {
        toastStore.show('Duración correcta', 'info');
      }
    } catch {
      toastStore.show('Error al consultar Spotify', 'error');
    } finally {
      recheckingDuration = false;
    }
  }

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
        <RankingBadges entityType="track" entityId={$page.params.id} bind:highlightedMonth />
      {/if}
    {:else if key === 'chartStats'}
      {#if !d.mergedInto}
        <ChartStats entityType="track" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />
      {/if}
    {:else if key === 'albumBreakdown'}
      {#if d.albumBreakdown.length > 1}
        <h2 class="section-title">Played in</h2>
        <div class="track-list">
          {#each d.albumBreakdown as item, i}
            <a href="/album/{item.album.id}" class="track-item">
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
              <div class="track-meta">
                <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
                <div class="track-time">{metric === 'time' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    {:else if key === 'activity'}
      {#if d.series.length > 1}
        <h2 class="section-title">Listening history</h2>
      {/if}
      <ActivityChart series={d.series} {metric} height="260px" events={releaseEvents} />
    {:else if key === 'historyByYear'}
      {#if d.series.length > 1}
        <h2 class="section-title">History by year</h2>
        <EntityHistoryChart series={d.series} {metric} events={releaseEvents} />
      {/if}
    {:else if key === 'versions'}
      {#if d.versions.length > 0}
        <h2 class="section-title">Versions</h2>
        <div class="track-list versions-list">
          {#each d.versions as v, i}
            <svelte:element
              this={v.isCurrent ? 'div' : 'a'}
              {...(v.isCurrent ? {} : { href: `/track/${v.trackId}` })}
              class="track-item"
              class:track-item--current={v.isCurrent}
            >
              <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
              {#if v.album?.imageUrl}
                <img class="track-art" src={v.album.imageUrl} alt={v.album.name} />
              {:else}
                <div class="track-art"></div>
              {/if}
              <div class="track-info">
                <div class="track-name">{v.name}</div>
                <div class="track-artist">{v.album?.name ?? ''}</div>
              </div>
              <div class="track-meta">
                <div class="track-plays">{metric === 'plays' ? `${v.playCount} plays` : formatDuration(v.totalMs)}</div>
                <div class="track-time">{metric === 'time' ? `${v.playCount} plays` : formatDuration(v.totalMs)}</div>
              </div>
            </svelte:element>
          {/each}
        </div>
      {/if}
    {:else if key === 'recentPlays'}
      {#if d.recentPlays.length > 0}
        <RecentPlaysRail entityType="track" entityId={$page.params.id} initial={d.recentPlays} historyHref={`/history?track=${$page.params.id}`} />
      {/if}
    {/if}
  {/snippet}

  <div class="detail-body">
    <div class="detail-main">
  <div class="detail-hero-row">
    <div class="detail-hero">
      {#if data.track.album}
        <a class="cover-link" href="/album/{data.track.album.id}" aria-label="View album {data.track.album.name}">
          {#if data.track.album.imageUrl}
            <img class="detail-image" src={data.track.album.imageUrl} alt={data.track.album.name} />
          {:else}
            <div class="detail-image detail-image--placeholder"></div>
          {/if}
        </a>
      {:else}
        <div class="detail-image detail-image--placeholder"></div>
      {/if}
      <div class="detail-header-info">
        <h1>{data.track.name}{#if $page.params.id === nowPlayingStore.trackId} <span class="live-badge"><span class="live-dot"></span> Live</span>{/if}</h1>
        <p class="detail-subtitle">
          {#each data.track.artists as artist, i}
            <a href="/artist/{artist.id}">{artist.name}</a>{#if i < data.track.artists.length - 1}{', '}{/if}
          {/each}
        </p>
        {#if data.track.album}
          <p class="detail-album">
            <a href="/album/{data.track.album.id}">{data.track.album.name}</a>
            {#if data.track.album.releaseDate}
              <span class="detail-meta"> &middot; {data.track.album.releaseDate}</span>
            {/if}
            <span class="detail-meta"> &middot; </span>
            {#if !isSpotifyId($page.params.id) && editingDuration}
              <input
                class="duration-input"
                type="text"
                placeholder="3:45"
                bind:value={durationInput}
                onkeydown={(e) => { if (e.key === 'Enter') saveDuration(); if (e.key === 'Escape') editingDuration = false; }}
                autofocus
              />
            {:else if !isSpotifyId($page.params.id)}
              <button class="duration-edit-btn" title="Editar duración" onclick={() => { editingDuration = true; durationInput = ''; }}>
                {data.track.durationMs > 0 ? formatTrackLength(data.track.durationMs) : '??:??'}
              </button>
            {:else}
              <span class="detail-meta duration-recheck" title="Doble click para recomprobar duración" ondblclick={recheckDuration}>
                {#if recheckingDuration}...{:else}{formatTrackLength(data.track.durationMs)}{/if}
              </span>
            {/if}
          </p>
        {:else}
          <p class="detail-album">
            {#if !isSpotifyId($page.params.id) && editingDuration}
              <input
                class="duration-input"
                type="text"
                placeholder="3:45"
                bind:value={durationInput}
                onkeydown={(e) => { if (e.key === 'Enter') saveDuration(); if (e.key === 'Escape') editingDuration = false; }}
                autofocus
              />
            {:else if !isSpotifyId($page.params.id)}
              <button class="duration-edit-btn" title="Editar duración" onclick={() => { editingDuration = true; durationInput = ''; }}>
                {data.track.durationMs > 0 ? formatTrackLength(data.track.durationMs) : '??:??'}
              </button>
            {:else}
              <span class="detail-meta duration-recheck" title="Doble click para recomprobar duración" ondblclick={recheckDuration}>
                {#if recheckingDuration}...{:else}{formatTrackLength(data.track.durationMs)}{/if}
              </span>
            {/if}
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
            await nowPlayingStore.playContext({ uris: [`spotify:track:${$page.params.id}`] });
            playActing = false;
          }}
        >
          <IconPlay />
        </button>
        <PlaylistPopover
          trackId={$page.params.id}
          inPlaylists={data.playlists}
          onAdd={(pl) => { if (data && !data.playlists.some(p => p.id === pl.id)) data.playlists = [...data.playlists, { ...pl, isOwned: true }]; }}
          onRemove={(id) => { if (data) data.playlists = data.playlists.filter(p => p.id !== id); }}
        >
          {#snippet likeButton()}
            <button
              class="like-btn"
              class:like-btn--liked={isLiked}
              title={likeLoading ? 'Loading...' : isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
              disabled={likeActing || likeLoading}
              onclick={toggleLike}
            >
              {#if likeLoading}
                <span class="btn-spinner"></span>
              {:else if isLiked}
                <IconHeartFilled />
              {:else}
                <IconHeartOutline />
              {/if}
            </button>
          {/snippet}
        </PlaylistPopover>
      {/if}
      {#if !data.mergedInto}
        <Accolades entityType="track" entityId={$page.params.id} />
      {/if}
      <EntityActionsMenu
        title="Actions"
        actions={[
          ...(isSpotifyId($page.params.id) ? [
            { label: 'Add to queue', icon: IconQueue, onClick: () => api.queueTrack($page.params.id) },
            { label: 'View in Spotify', icon: IconExternalLink, onClick: () => window.open(`https://open.spotify.com/track/${$page.params.id}`, '_blank') },
          ] : []),
          ...(canShare() ? [{ label: 'Share', icon: IconShare, onClick: () => shareEntity(data?.track?.name ?? 'Track', publicHref()) }] : []),
          { label: 'Manage merges', icon: IconMerge, onClick: () => { showMergeModal = true; } },
        ]}
      />
    </div>
  </div>

  <MergeBanners entityType="track" entityId={d.track.id} mergedInto={d.mergedInto} mergedFrom={d.mergedFrom} onUnmerge={() => loadData($page.params.id)} />
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
    entityType="track"
    target={{ id: data.track.id, name: data.track.name, imageUrl: data.track.album?.imageUrl ?? null }}
    parentId={data.track.artists[0]?.id ?? ''}
    existingMerges={data.mergedFrom}
    onMerged={() => loadData($page.params.id)}
  />
{/if}

<style>
  /* resaltar la versión que se está viendo ahora mismo */
  .track-item--current {
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    border-radius: 8px;
  }
  /* la portada enlaza al álbum: el track hereda su carátula, no hay nada que editar aquí */
  .cover-link {
    display: block;
    line-height: 0;
    flex-shrink: 0;
    border-radius: var(--radius);
    transition: opacity 0.05s;
  }
  .cover-link:hover {
    opacity: 0.85;
  }
</style>

