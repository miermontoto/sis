<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, type TrackDetail, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate } from '$lib/utils/format';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import type { EChartsOption } from 'echarts';

  let data = $state<TrackDetail | null>(null);
  let loading = $state(true);
  let range = $state('all');
  let metric = $state<RankingMetric>('time');

  async function loadData() {
    loading = true;
    try {
      data = await api.trackDetail($page.params.id, range);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    metric = getRankingMetric();
    loadData();
  });

  $effect(() => {
    void range;
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
    {#if data.track.album?.imageUrl}
      <img class="detail-image" src={data.track.album.imageUrl} alt={data.track.album?.name ?? ''} />
    {:else}
      <div class="detail-image detail-image--placeholder"></div>
    {/if}
    <div class="detail-header-info">
      <h1>{data.track.name}</h1>
      <p class="detail-subtitle">
        {#each data.track.artists as artist, i}
          <a href="/artist/{artist.id}">{artist.name}</a>{#if i < data.track.artists.length - 1}, {/if}
        {/each}
      </p>
      {#if data.track.album}
        <p class="detail-album">
          <a href="/album/{data.track.album.id}">{data.track.album.name}</a>
          {#if data.track.album.releaseDate}
            <span class="detail-meta"> &middot; {data.track.album.releaseDate}</span>
          {/if}
        </p>
      {/if}
    </div>
  </div>

  <TimeRangeSelector value={range} onchange={(r) => range = r} />

  <div class="stats-grid">
    <div class="card stat-card">
      <div class="stat-value">{formatNumber(data.stats.play_count)}</div>
      <div class="stat-label">Plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatDuration(data.stats.total_ms)}</div>
      <div class="stat-label">Total listening time</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatDuration(data.track.durationMs)}</div>
      <div class="stat-label">Duration</div>
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

  {#if data.albumBreakdown.length > 1}
    <h2 class="section-title">Played in</h2>
    <div class="track-list">
      {#each data.albumBreakdown as item, i}
        <a href="/album/{item.album.id}" class="track-item">
          <span class="track-rank">{i + 1}</span>
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
    <div class="card chart-card">
      <BaseChart option={chartOption} height="260px" />
    </div>
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
