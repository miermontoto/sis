<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, type AlbumDetail, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate } from '$lib/utils/format';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import type { EChartsOption } from 'echarts';

  let data = $state<AlbumDetail | null>(null);
  let loading = $state(true);
  let range = $state('all');
  let metric = $state<RankingMetric>('time');

  async function loadData() {
    loading = true;
    try {
      data = await api.albumDetail($page.params.id, range, metric === 'plays' ? 'plays' : 'time');
    } finally {
      loading = false;
    }
  }

  function setRange(r: string) {
    range = r;
    setQueryParams({ range: r });
  }

  onMount(() => {
    range = getQueryParam('range', 'all');
    metric = getRankingMetric();
    loadData();
  });

  $effect(() => {
    void range;
    void metric;
    loadData();
  });

  const rankLabels = { week: '7D', month: '30D', thisYear: 'YTD', all: 'All' } as const;

  let chartOption = $derived.by<EChartsOption>(() => {
    if (!data?.series.length) return {};
    const s = data.series;
    const isPlays = metric === 'plays';
    return {
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return isPlays
            ? `${p.name}<br/>${p.value} plays`
            : `${p.name}<br/>${formatDuration(p.value)}`;
        },
      },
      xAxis: {
        type: 'category',
        data: s.map(d => d.period),
        axisLabel: { color: '#888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#2a2a2a' } },
        axisLabel: {
          color: '#888',
          formatter: isPlays ? undefined : (v: number) => formatDuration(v),
        },
      },
      series: [{
        type: 'bar',
        data: s.map(d => isPlays ? d.play_count : d.total_ms),
        itemStyle: { color: '#1db954', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 20,
      }],
    };
  });
</script>

{#if loading && !data}
  <div class="loading"><div class="spinner"></div></div>
{:else if data}
  <div class="detail-hero">
    {#if data.album.imageUrl}
      <img class="detail-image" src={data.album.imageUrl} alt={data.album.name} />
    {:else}
      <div class="detail-image detail-image--placeholder"></div>
    {/if}
    <div class="detail-header-info">
      <h1>{data.album.name}</h1>
      <p class="detail-subtitle">
        {#each data.artists as artist, i}
          <a href="/artist/{artist.id}">{artist.name}</a>{#if i < data.artists.length - 1}, {/if}
        {/each}
        {#if data.album.releaseDate}
          <span class="detail-meta"> &middot; {data.album.releaseDate}</span>
        {/if}
        {#if data.album.totalTracks}
          <span class="detail-meta"> &middot; {data.album.totalTracks} tracks</span>
        {/if}
      </p>
    </div>
  </div>

  <TimeRangeSelector value={range} onchange={setRange} />

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
  </div>

  <div class="rankings-row">
    {#each Object.entries(rankLabels) as [key, label]}
      {@const rank = data.rankings[key as keyof typeof data.rankings]}
      <div class="ranking-badge" class:ranking-badge--active={rank != null}>
        <span class="ranking-label">{label}</span>
        <span class="ranking-value">{rank != null ? `#${rank}` : '—'}</span>
      </div>
    {/each}
  </div>

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
    <h2 class="section-title">Recent plays</h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
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
</style>
