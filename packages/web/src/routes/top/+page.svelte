<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type RankingMetric } from '$lib/api';
  import { formatDuration } from '$lib/utils/format';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import type { EChartsOption } from 'echarts';

  let activeTab = $state<'tracks' | 'artists' | 'albums'>('tracks');
  let range = $state('month');
  let metric = $state<RankingMetric>('time');
  let topTracks = $state<TopTrackItem[]>([]);
  let topArtists = $state<TopArtistItem[]>([]);
  let topAlbums = $state<TopAlbumItem[]>([]);
  let loading = $state(true);

  async function loadData() {
    loading = true;
    try {
      if (activeTab === 'tracks') {
        topTracks = await api.topTracks(range, 50, metric);
      } else if (activeTab === 'artists') {
        topArtists = await api.topArtists(range, 50, metric);
      } else {
        topAlbums = await api.topAlbums(range, 50, metric);
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    metric = getRankingMetric();
    loadData();
  });

  $effect(() => {
    void activeTab;
    void range;
    void metric;
    loadData();
  });

  function metricValue(item: { playCount: number; totalMs: number }): number {
    return metric === 'plays' ? item.playCount : item.totalMs / 60_000;
  }

  function formatChartValue(ms: number): string {
    if (metric === 'plays') return String(ms);
    // ms es realmente minutos aquí (ya dividido)
    const h = Math.floor(ms / 60);
    const m = Math.round(ms % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // bar chart horizontal de top 10
  let chartOption = $derived.by<EChartsOption>(() => {
    let names: string[] = [];
    let values: number[] = [];

    if (activeTab === 'tracks') {
      const top10 = topTracks.slice(0, 10).reverse();
      names = top10.map(t => t.track?.name ?? 'Unknown');
      values = top10.map(t => metricValue(t));
    } else if (activeTab === 'artists') {
      const top10 = topArtists.slice(0, 10).reverse();
      names = top10.map(a => a.artist?.name ?? 'Unknown');
      values = top10.map(a => metricValue(a));
    } else {
      const top10 = topAlbums.slice(0, 10).reverse();
      names = top10.map(a => a.album?.name ?? 'Unknown');
      values = top10.map(a => metricValue(a));
    }

    return {
      grid: { left: 140, right: 30, top: 10, bottom: 20 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.name}<br/>${metric === 'plays' ? `${p.value} plays` : formatChartValue(p.value)}`;
        },
      },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#2a2a2a' } },
        axisLabel: {
          color: '#888',
          formatter: (v: number) => metric === 'plays' ? String(v) : formatChartValue(v),
        },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLabel: {
          color: '#e5e5e5',
          width: 120,
          overflow: 'truncate',
          fontSize: 12,
        },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
      },
      series: [{
        type: 'bar',
        data: values,
        itemStyle: {
          color: '#1db954',
          borderRadius: [0, 4, 4, 0],
        },
        barMaxWidth: 24,
      }],
    };
  });
</script>

<div class="page-header">
  <h1>Top</h1>
</div>

<div class="tabs">
  <button class="tab" class:active={activeTab === 'tracks'} onclick={() => activeTab = 'tracks'}>
    Tracks
  </button>
  <button class="tab" class:active={activeTab === 'artists'} onclick={() => activeTab = 'artists'}>
    Artists
  </button>
  <button class="tab" class:active={activeTab === 'albums'} onclick={() => activeTab = 'albums'}>
    Albums
  </button>
</div>

<TimeRangeSelector value={range} onchange={(r) => range = r} />

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
  {#if (activeTab === 'tracks' && topTracks.length > 0) || (activeTab === 'artists' && topArtists.length > 0) || (activeTab === 'albums' && topAlbums.length > 0)}
    <div class="card" style="margin-bottom: 1.5rem;">
      <BaseChart option={chartOption} height="340px" />
    </div>
  {/if}

  {#if activeTab === 'tracks'}
    <TrackList items={topTracks} showRank {metric} />
  {:else if activeTab === 'artists'}
    <div class="track-list">
      {#each topArtists as item, i}
        {#if item.artist}
          <div class="track-item">
            <span class="track-rank">{i + 1}</span>
            {#if item.artist.imageUrl}
              <img class="track-art" src={item.artist.imageUrl} alt={item.artist.name} style="border-radius: 50%;" />
            {:else}
              <div class="track-art" style="border-radius: 50%;"></div>
            {/if}
            <div class="track-info">
              <div class="track-name">{item.artist.name}</div>
              <div class="track-artist">{item.artist.genres?.slice(0, 3).join(', ') ?? ''}</div>
            </div>
            <div class="track-meta">
              <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="track-list">
      {#each topAlbums as item, i}
        {#if item.album}
          <div class="track-item">
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
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
{/if}
