<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, createFetchController, type ArtistDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import MergeAlbumModal from '$lib/components/MergeAlbumModal.svelte';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';

  import type { EChartsOption } from 'echarts';

  let data = $state<ArtistDetail | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let showAllTracks = $state(false);
  let showAllAlbums = $state(false);
  let showMergeModal = $state(false);
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let mergeTarget = $state<{ id: string; name: string; imageUrl: string | null } | null>(null);
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
        <h1>{data.artist.name}</h1>
      </div>
    </div>
    <Accolades entityType="artist" entityId={$page.params.id} />
  </div>

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
      <div class="card stat-card">
        <div class="stat-value">{new Date(data.stats.first_played).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
        <div class="stat-label">First played</div>
      </div>
    {/if}
    {#if data.stats.last_played}
      <div class="card stat-card">
        <div class="stat-value">{new Date(data.stats.last_played).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
        <div class="stat-label">Last played</div>
      </div>
    {/if}
  </div>

  <RankingBadges entityType="artist" entityId={$page.params.id} bind:highlightedMonth />
  <ChartStats entityType="artists" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />

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
          <a href="/album/{item.albumId}" class="track-item">
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
            <button class="merge-btn" title="Manage merges" onclick={(e) => { e.preventDefault(); e.stopPropagation(); mergeTarget = { id: item.albumId, name: item.album!.name, imageUrl: item.album!.imageUrl }; showMergeModal = true; }}>Merge</button>
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
    <h2 class="section-title">Recent plays</h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
{/if}

{#if mergeTarget}
  <MergeAlbumModal
    bind:show={showMergeModal}
    targetAlbum={mergeTarget}
    artistId={$page.params.id}
    onMerged={() => loadData($page.params.id)}
  />
{/if}

<style>
  .rankings-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }
  .ranking-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    flex: 1;
    min-width: 60px;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    background: var(--bg-card);
    border: 1px solid #2a2a2a;
  }
  .ranking-badge--active {
    border-color: #1db954;
  }
  .ranking-badge--loading .ranking-value {
    width: 28px;
    height: 1.1rem;
    border-radius: 4px;
    background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    display: inline-block;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .ranking-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ranking-value {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
  }
  .ranking-badge--active .ranking-value {
    color: #1db954;
  }
  .chart-card {
    margin-bottom: 1.5rem;
    padding: 1rem;
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

