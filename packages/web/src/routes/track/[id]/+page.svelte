<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, createFetchController, type TrackDetail, type ChartHistoryResponse, type RankingMetric, getRankingMetric } from '$lib/api';
  import { formatDuration, formatNumber, formatDate } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { extractColor } from '$lib/utils/color';
  import TrackList from '$lib/components/TrackList.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import ChartStats from '$lib/components/ChartStats.svelte';
  import RankingBadges from '$lib/components/RankingBadges.svelte';
  import Accolades from '$lib/components/Accolades.svelte';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';

  import type { EChartsOption } from 'echarts';

  let data = $state<TrackDetail | null>(null);
  let chartHistoryData = $state<ChartHistoryResponse | null>(null);
  let loading = $state(true);
  let heroColor = $state('');
  let highlightedMonth = $state('');
  let metric = $state<RankingMetric>('time');
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
          </p>
        {/if}
      </div>
    </div>
    <Accolades entityType="track" entityId={$page.params.id} />
  </div>

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

  <RankingBadges entityType="track" entityId={$page.params.id} bind:highlightedMonth />
  <ChartStats entityType="tracks" entityId={$page.params.id} bind:chartData={chartHistoryData} bind:highlightedMonth />

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
    <div class="card chart-card">
      <BaseChart option={chartOption} height="260px" />
    </div>
  {/if}

  {#if data.recentPlays.length > 0}
    <h2 class="section-title">Recent plays</h2>
    <TrackList items={data.recentPlays} showTime />
  {/if}
{/if}

<style>
  .chart-card {
    margin-bottom: 1.5rem;
    padding: 1rem;
  }
</style>
