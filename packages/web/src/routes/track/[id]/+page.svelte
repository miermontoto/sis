<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, createFetchController, type TrackDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatTrackLength, formatNumber, formatDate, formatShortDate, localDateKey } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import ActivityChart from '$lib/components/charts/ActivityChart.svelte';
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
  import IconMerge from '$lib/icons/IconMerge.svelte';



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
  const fetchCtrl = createFetchController();

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
    initialized = true;
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

</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  {#if heroColor}
    <div class="detail-color-bg" style="background: linear-gradient(180deg, rgba({heroColor},0.18) 0%, transparent 100%);"></div>
  {/if}
  <div class="detail-hero-row">
    <div class="detail-hero">
      {#if data.track.album?.imageUrl}
        <img class="detail-image" src={data.track.album.imageUrl} alt={data.track.album?.name ?? ''} />
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
            <span class="detail-meta"> &middot; {formatTrackLength(data.track.durationMs)}</span>
          </p>
        {:else}
          <p class="detail-album"><span class="detail-meta">{formatTrackLength(data.track.durationMs)}</span></p>
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
        <div class="like-wrap">
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
          {#if data && data.playlists.length > 0}
            <span class="like-badge">+{data.playlists.length}</span>
            <div class="like-popover">
              <div class="like-popover-inner">
                <div class="like-popover-title">In playlists</div>
                {#each data.playlists as playlist}
                  <a href="/playlists/{playlist.id}" class="like-popover-item">
                    {#if playlist.imageUrl}
                      <img class="like-popover-art" src={playlist.imageUrl} alt={playlist.name} />
                    {:else}
                      <div class="like-popover-art"></div>
                    {/if}
                    <span>{playlist.name}</span>
                  </a>
                {/each}
              </div>
            </div>
          {/if}
        </div>
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
          { label: 'Manage merges', icon: IconMerge, onClick: () => { showMergeModal = true; } },
        ]}
      />
    </div>
  </div>

  <MergeBanners entityType="track" mergedInto={data.mergedInto} mergedFrom={data.mergedFrom} onUnmerge={() => loadData($page.params.id)} />
  <StatsGrid stats={data.stats} />

  {#if !data.mergedInto}
    <RankingBadges entityType="track" entityId={$page.params.id} bind:highlightedMonth />
    <ChartStats entityType="track" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />
  {/if}

  {#if data.albumBreakdown.length > 1}
    <h2 class="section-title">Played in</h2>
    <div class="track-list">
      {#each data.albumBreakdown as item, i}
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

  {#if data.series.length > 1}
    <h2 class="section-title">Listening history</h2>
  {/if}
  <ActivityChart series={data.series} {metric} height="260px" />

  {#if data.recentPlays.length > 0}
    <h2 class="section-title"><a href="/history?track={$page.params.id}" class="section-link">Recent plays</a></h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
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

