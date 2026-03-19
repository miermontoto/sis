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

  let chartOption = $derived.by<EChartsOption>(() => {
    if (!data?.dailySeries.length) return {};
    const days = data.dailySeries;
    return {
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.name}<br/>${p.value} plays`;
        },
      },
      xAxis: {
        type: 'category',
        data: days.map(d => d.day),
        axisLabel: { color: '#888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#2a2a2a' } },
        axisLabel: { color: '#888' },
      },
      series: [{
        type: 'bar',
        data: days.map(d => d.play_count),
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

  {#if data.dailySeries.length > 1}
    <h2 class="section-title">Listening history</h2>
    <div class="card" style="margin-bottom: 1.5rem;">
      <BaseChart option={chartOption} height="260px" />
    </div>
  {/if}
{/if}

