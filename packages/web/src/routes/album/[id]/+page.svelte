<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, createFetchController, type AlbumDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate } from '$lib/utils/format';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import type { EChartsOption } from 'echarts';

  let data = $state<AlbumDetail | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  const fetchCtrl = createFetchController();

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
    initialized = true;
  });

  $effect(() => {
    const id = $page.params.id;
    void metric;
    if (!initialized || !id) return;
    // resetear al cambiar de álbum para mostrar spinner
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
      {#if data.album.imageUrl}
        <img class="detail-image" src={data.album.imageUrl} alt={data.album.name} />
      {:else}
        <div class="detail-image detail-image--placeholder"></div>
      {/if}
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
    {#if !data.mergedInto}
      <Accolades entityType="album" entityId={$page.params.id} />
    {/if}
  </div>

  {#if data.mergedInto}
    <div class="merge-banner merge-banner--source">
      <span>Merged into <a href="/album/{data.mergedInto.id}">{data.mergedInto.name}</a></span>
      <button class="merge-banner-unmerge" onclick={async () => { await api.deleteMerge(data!.mergedInto!.ruleId); loadData($page.params.id); }}>Unmerge</button>
    </div>
  {/if}

  {#if data.mergedFrom.length > 0}
    <div class="merge-banner merge-banner--target">
      <div class="merge-banner-label">Includes plays from:</div>
      <div class="merge-banner-albums">
        {#each data.mergedFrom as merge}
          <a href="/album/{merge.id}" class="merge-banner-album">
            {#if merge.imageUrl}
              <img class="merge-banner-thumb" src={merge.imageUrl} alt="" />
            {:else}
              <div class="merge-banner-thumb merge-banner-thumb--empty"></div>
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
      <a href="/history?date={data.stats.first_played.split('T')[0]}" class="card stat-card stat-card--link">
        <div class="stat-value">{new Date(data.stats.first_played).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
        <div class="stat-label">First played</div>
      </a>
    {/if}
    {#if data.stats.last_played}
      <a href="/history?date={data.stats.last_played.split('T')[0]}" class="card stat-card stat-card--link">
        <div class="stat-value">{new Date(data.stats.last_played).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
        <div class="stat-label">Last played</div>
      </a>
    {/if}
  </div>

  {#if !data.mergedInto}
    <RankingBadges entityType="album" entityId={$page.params.id} bind:highlightedMonth />
    <ChartStats entityType="albums" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />
  {/if}

  {#if data.series.length > 1}
    <div class="card chart-card">
      <BaseChart option={chartOption} height="250px" />
    </div>
  {/if}

  {#if data.tracks.length > 0}
    <h2 class="section-title">Tracks</h2>
    <TrackList items={data.tracks} showRank {metric} />
  {/if}

  {#if data.recentPlays.length > 0}
    <h2 class="section-title"><a href="/history?album={$page.params.id}" class="section-link">Recent plays</a></h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
{/if}

<style>
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
  .merge-banner--target {
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.2);
    color: var(--text-muted);
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .merge-banner-label {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .merge-banner-albums {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .merge-banner-album {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    text-decoration: none;
    color: var(--text);
    padding: 0.2rem 0.5rem 0.2rem 0.2rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    transition: background 0.15s;
  }
  .merge-banner-album:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .merge-banner-thumb {
    width: 24px;
    height: 24px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .merge-banner-thumb--empty {
    background: var(--border);
  }
  .merge-banner-name {
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .merge-banner-unmerge {
    background: none;
    border: 1px solid rgba(255, 170, 0, 0.4);
    color: #ffaa00;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font);
    flex-shrink: 0;
  }
  .merge-banner-unmerge:hover {
    background: rgba(255, 170, 0, 0.15);
  }
  .chart-card {
    margin-bottom: 1.5rem;
    padding: 1rem;
  }
</style>
