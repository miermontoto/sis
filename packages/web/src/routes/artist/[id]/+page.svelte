<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, createFetchController, type ArtistDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate, formatShortDate, localDateKey } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import MergeEntityModal from '$lib/components/MergeEntityModal.svelte';
  import EntityActionsMenu from '$lib/components/EntityActionsMenu.svelte';
  import { openEntityContextMenu } from '$lib/utils/entity-context';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';

  import type { EChartsOption } from 'echarts';

  let data = $state<ArtistDetail | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let showAllTracks = $state(false);
  let showAllAlbums = $state(false);
  let showArtistMergeModal = $state(false);
  let playActing = $state(false);
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  const fetchCtrl = createFetchController();

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
    initialized = true;
  });

  $effect(() => {
    const id = $page.params.id;
    void metric;
    void showAllTracks;
    void showAllAlbums;
    if (!initialized || !id) return;
    if (id !== prevId) {
      data = null;
      chartHistoryData = null;
      prevId = id;
    }
    loadData(id);
  });

  let chartOption = $derived.by<EChartsOption>(() => {
    if (!data?.series.length) return {};
    const s = data.series;
    const isPlays = metric === 'plays';
    return {
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      tooltip: { trigger: 'axis', formatter: (params: any) => { const p = Array.isArray(params) ? params[0] : params; return isPlays ? `${p.name}<br/>${p.value} plays` : `${p.name}<br/>${formatDuration(p.value)}`; } },
      xAxis: { type: 'category', data: s.map(d => d.period), axisLabel: { color: '#888', fontSize: 11 }, axisLine: { lineStyle: { color: '#2a2a2a' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#2a2a2a' } }, axisLabel: { color: '#888', formatter: isPlays ? undefined : (v: number) => formatDuration(v) } },
      series: [{ type: 'bar', data: s.map(d => isPlays ? d.play_count : d.total_ms), itemStyle: { color: '#1db954', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 20 }],
    };
  });
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  {#if heroColor}
    <div class="detail-color-bg" style="background: linear-gradient(180deg, rgba({heroColor},0.18) 0%, transparent 100%);"></div>
  {/if}
  <div class="detail-hero-row">
    <div class="detail-hero">
      {#if data.artist.imageUrl}
        <img class="detail-image detail-image--round" src={data.artist.imageUrl} alt={data.artist.name} />
      {:else}
        <div class="detail-image detail-image--round detail-image--placeholder"></div>
      {/if}
      <div class="detail-header-info">
        <h1>{data.artist.name}{#if nowPlayingStore.artistIds.includes($page.params.id)} <span class="live-badge"><span class="live-dot"></span> Live</span>{/if}</h1>
      </div>
    </div>
    <div class="hero-actions">
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Play
      </button>
      {#if !data.mergedInto}
        <Accolades entityType="artist" entityId={$page.params.id} />
      {/if}
      <EntityActionsMenu
        title="Actions"
        actions={[
          { label: 'Manage merges', onClick: () => { showArtistMergeModal = true; } },
        ]}
      />
    </div>
  </div>

  {#if data.mergedInto}
    <div class="merge-banner merge-banner--source">
      <span>Merged into <a href="/artist/{data.mergedInto.id}">{data.mergedInto.name}</a></span>
      <button class="merge-banner-unmerge" onclick={async () => { await api.deleteMerge(data!.mergedInto!.ruleId); loadData($page.params.id); }}>Unmerge</button>
    </div>
  {/if}

  {#if data.mergedFrom.length > 0}
    <div class="merge-banner merge-banner--target">
      <div class="merge-banner-label">Includes plays from:</div>
      <div class="merge-banner-albums">
        {#each data.mergedFrom as merge}
          <a href="/artist/{merge.id}" class="merge-banner-album">
            {#if merge.imageUrl}
              <img class="merge-banner-thumb merge-banner-thumb--round" src={merge.imageUrl} alt="" />
            {:else}
              <div class="merge-banner-thumb merge-banner-thumb--round merge-banner-thumb--empty"></div>
            {/if}
            <span class="merge-banner-name">{merge.name}</span>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <div class="stats-grid">
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(data.stats.play_count)}</div>
      <div class="stat-label">Plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatDuration(data.stats.total_ms)}</div>
      <div class="stat-label">Listening time</div>
    </div>
    {#if data.stats.first_played}
      <a href="/history?date={localDateKey(data.stats.first_played)}&focus={encodeURIComponent(data.stats.first_played)}" class="card stat-card stat-card--link">
        <div class="stat-value">{formatShortDate(data.stats.first_played)}</div>
        <div class="stat-label">First played</div>
      </a>
    {/if}
    {#if data.stats.last_played}
      <a href="/history?date={localDateKey(data.stats.last_played)}&focus={encodeURIComponent(data.stats.last_played)}" class="card stat-card stat-card--link">
        <div class="stat-value">{formatShortDate(data.stats.last_played)}</div>
        <div class="stat-label">Last played</div>
      </a>
    {/if}
  </div>

  {#if !data.mergedInto}
    <RankingBadges entityType="artist" entityId={$page.params.id} bind:highlightedMonth />
    <ChartStats entityType="artist" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />
  {/if}

  {#if data.series.length > 1}
    <div class="card chart-card">
      <BaseChart option={chartOption} height="250px" />
    </div>
  {/if}

  {#if data.topTracks.length > 0}
    <div class="section-header">
      <h2 class="section-title">Top tracks</h2>
      <button class="show-all-btn" onclick={() => showAllTracks = !showAllTracks}>
        {showAllTracks ? 'Show less' : 'Show all'}
      </button>
    </div>
    <TrackList items={data.topTracks} showRank {metric} />
  {/if}

  {#if data.topAlbums.length > 0}
    <div class="section-header">
      <h2 class="section-title">Top albums</h2>
      <button class="show-all-btn" onclick={() => showAllAlbums = !showAllAlbums}>
        {showAllAlbums ? 'Show less' : 'Show all'}
      </button>
    </div>
    <div class="track-list">
      {#each data.topAlbums as item, i}
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
            <div class="track-meta">
              <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
              <div class="track-time">{metric === 'time' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
            </div>
          </a>
        {/if}
      {/each}
    </div>
  {/if}

  {#if data.recentPlays.length > 0}
    <h2 class="section-title"><a href="/history?artist={$page.params.id}" class="section-link">Recent plays</a></h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
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
  .play-entity-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.85rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .play-entity-btn:hover:not(:disabled) { background: var(--accent-hover); }
  .play-entity-btn:disabled { opacity: 0.5; cursor: default; }

  .chart-card {
    margin-bottom: 1.5rem;
    padding: 1rem;
  }
  .hero-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    align-self: center;
  }
  .merge-banner {
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .merge-banner a {
    color: var(--accent);
    text-decoration: none;
  }
  .merge-banner a:hover {
    text-decoration: underline;
  }
  .merge-banner--source {
    background: rgba(255, 170, 0, 0.1);
    border: 1px solid rgba(255, 170, 0, 0.3);
    color: #ffaa00;
  }
  .merge-banner--source a {
    color: #ffaa00;
    text-decoration: underline;
  }
  .merge-banner--target {
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.25);
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .merge-banner-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .merge-banner-albums {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }
  .merge-banner-album {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text);
    text-decoration: none;
  }
  .merge-banner-album:hover {
    color: var(--accent);
  }
  .merge-banner-thumb {
    width: 22px;
    height: 22px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-banner-thumb--round {
    border-radius: 50%;
  }
  .merge-banner-thumb--empty {
    background: var(--border);
  }
  .merge-banner-name {
    font-size: 0.85rem;
  }
  .merge-banner-unmerge {
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
    font-family: var(--font);
    opacity: 0.8;
  }
  .merge-banner-unmerge:hover {
    opacity: 1;
  }
  .merge-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.7rem;
    font-family: var(--font);
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    border-radius: 5px;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, border-color 0.15s;
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

