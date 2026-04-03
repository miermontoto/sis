<script lang="ts">
  import { onMount } from 'svelte';
  import { api, getRankingMetric, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type RankingMetric, type DateRangeParams } from '$lib/api';
  import { formatDuration } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { extractColor } from '$lib/utils/color';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import type { EChartsOption } from 'echarts';

  let activeTab = $state<'tracks' | 'artists' | 'albums'>('tracks');
  let range = $state('month');
  let startDate = $state('');
  let endDate = $state('');
  let metric = $state<RankingMetric>('time');
  let topTracks = $state<TopTrackItem[]>([]);
  let topArtists = $state<TopArtistItem[]>([]);
  let topAlbums = $state<TopAlbumItem[]>([]);
  let loading = $state(true);
  let barColors = $state<[number, number, number][]>([]);

  function getCustomDates(): DateRangeParams | undefined {
    if (range === 'custom' && startDate && endDate) return { startDate, endDate };
    return undefined;
  }

  const PAGE_SIZE = 50;
  let visibleCount = $state(PAGE_SIZE);
  let sentinel = $state<HTMLElement | null>(null);
  let observer: IntersectionObserver | null = null;

  async function loadData() {
    loading = true;
    visibleCount = PAGE_SIZE;
    try {
      const dates = getCustomDates();
      if (activeTab === 'tracks') {
        topTracks = await api.topTracks(range, 200, metric, dates);
      } else if (activeTab === 'artists') {
        topArtists = await api.topArtists(range, 200, metric, dates);
      } else {
        topAlbums = await api.topAlbums(range, 200, metric, dates);
      }
    } finally {
      loading = false;
    }
  }

  function totalItems(): number {
    if (activeTab === 'tracks') return topTracks.length;
    if (activeTab === 'artists') return topArtists.length;
    return topAlbums.length;
  }

  function setRange(r: string) {
    range = r;
    if (r !== 'custom') {
      startDate = '';
      endDate = '';
      setQueryParams({ range: r, tab: activeTab, startDate: null, endDate: null });
    } else {
      // default a últimos 30 días si no hay fechas
      if (!startDate || !endDate) {
        const now = new Date();
        endDate = now.toISOString().split('T')[0];
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        startDate = start.toISOString().split('T')[0];
      }
      setQueryParams({ range: r, tab: activeTab, startDate, endDate });
    }
  }

  function setCustomDates(s: string, e: string) {
    startDate = s;
    endDate = e;
    setQueryParams({ startDate: s, endDate: e });
  }

  function setTab(t: 'tracks' | 'artists' | 'albums') {
    activeTab = t;
    setQueryParams({ tab: t, range });
  }

  let initialized = false;

  onMount(() => {
    range = getQueryParam('range', 'month');
    startDate = getQueryParam('startDate', '');
    endDate = getQueryParam('endDate', '');
    activeTab = getQueryParam('tab', 'tracks') as 'tracks' | 'artists' | 'albums';
    metric = getRankingMetric();
    initialized = true;

    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount < totalItems()) {
          visibleCount = Math.min(visibleCount + PAGE_SIZE, totalItems());
        }
      },
      { threshold: 0.1 },
    );

    return () => observer?.disconnect();
  });

  $effect(() => {
    if (sentinel && observer) observer.observe(sentinel);
  });

  $effect(() => {
    void activeTab;
    void range;
    void metric;
    void startDate;
    void endDate;
    if (initialized) loadData();
  });

  // extraer colores del top 10 cuando cambian los datos
  $effect(() => {
    let urls: (string | null)[] = [];
    if (activeTab === 'tracks') {
      urls = topTracks.slice(0, 10).map(t => t.track?.album?.imageUrl ?? null);
    } else if (activeTab === 'artists') {
      urls = topArtists.slice(0, 10).map(a => a.artist?.imageUrl ?? null);
    } else {
      urls = topAlbums.slice(0, 10).map(a => a.album?.imageUrl ?? null);
    }

    Promise.all(urls.map(u => u ? extractColor(u) : Promise.resolve<[number, number, number]>([29, 185, 84])))
      .then(colors => { barColors = colors; });
  });

  function metricValue(item: { playCount: number; totalMs: number }): number {
    return metric === 'plays' ? item.playCount : item.totalMs / 60_000;
  }

  function formatChartValue(ms: number): string {
    if (metric === 'plays') return String(ms);
    const h = Math.floor(ms / 60);
    const m = Math.round(ms % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  let chartOption = $derived.by<EChartsOption>(() => {
    let names: string[] = [];
    let values: number[] = [];
    let images: (string | null)[] = [];

    if (activeTab === 'tracks') {
      const top10 = topTracks.slice(0, 10);
      names = top10.map(t => t.track?.name ?? 'Unknown');
      values = top10.map(t => metricValue(t));
      images = top10.map(t => t.track?.album?.imageUrl ?? null);
    } else if (activeTab === 'artists') {
      const top10 = topArtists.slice(0, 10);
      names = top10.map(a => a.artist?.name ?? 'Unknown');
      values = top10.map(a => metricValue(a));
      images = top10.map(a => a.artist?.imageUrl ?? null);
    } else {
      const top10 = topAlbums.slice(0, 10);
      names = top10.map(a => a.album?.name ?? 'Unknown');
      values = top10.map(a => metricValue(a));
      images = top10.map(a => a.album?.imageUrl ?? null);
    }

    // truncar nombres largos para que no invadan el chart
    const MAX_NAME = 18;
    names = names.map(n => n.length > MAX_NAME ? n.slice(0, MAX_NAME - 1) + '…' : n);

    // invertir para que #1 quede arriba
    names = names.slice().reverse();
    values = values.slice().reverse();
    images = images.slice().reverse();
    const defaultRgb: [number, number, number] = [29, 185, 84];
    const colors = barColors.length >= names.length
      ? barColors.slice(0, names.length).slice().reverse()
      : names.map(() => defaultRgb);

    // rich styles para imágenes en las labels del eje Y
    const rich: Record<string, any> = {
      name: { fontSize: 12, color: '#e5e5e5', width: 130, overflow: 'truncate', align: 'left' },
    };
    images.forEach((url, i) => {
      if (url) {
        rich[`img${i}`] = {
          backgroundColor: { image: url },
          width: 26,
          height: 26,
          borderRadius: activeTab === 'artists' ? 13 : 3,
          align: 'left',
        };
      } else {
        rich[`img${i}`] = {
          backgroundColor: '#2a2a2a',
          width: 26,
          height: 26,
          borderRadius: activeTab === 'artists' ? 13 : 3,
          align: 'left',
        };
      }
    });

    return {
      grid: { left: 190, right: 55, top: 10, bottom: 20 },
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
        axisLine: { lineStyle: { color: '#2a2a2a' } },
        axisTick: { show: false },
        axisLabel: {
          rich,
          align: 'left',
          margin: 180,
          formatter: (name: string) => {
            const idx = names.indexOf(name);
            return `{img${idx}|}  {name|${name}}`;
          },
        },
      },
      series: [{
        type: 'bar',
        data: values.map((v, i) => {
          const [r, g, b] = colors[i] ?? defaultRgb;
          return {
            value: v,
            itemStyle: {
              color: {
                type: 'linear' as const,
                x: 0, y: 0, x2: 1, y2: 0,
                colorStops: [
                  { offset: 0, color: `rgba(${r},${g},${b},0.9)` },
                  { offset: 1, color: `rgba(${r},${g},${b},0.3)` },
                ],
              },
              borderRadius: [0, 4, 4, 0],
            },
          };
        }),
        barMaxWidth: 28,
        label: {
          show: true,
          position: 'right',
          color: '#888',
          fontSize: 11,
          formatter: (p: any) => metric === 'plays' ? `${p.value}` : formatChartValue(p.value),
        },
      }],
    };
  });
</script>

<div class="page-header">
  <h1>Top</h1>
</div>

<div class="tabs">
  <button class="tab" class:active={activeTab === 'tracks'} onclick={() => setTab('tracks')}>
    Tracks
  </button>
  <button class="tab" class:active={activeTab === 'artists'} onclick={() => setTab('artists')}>
    Artists
  </button>
  <button class="tab" class:active={activeTab === 'albums'} onclick={() => setTab('albums')}>
    Albums
  </button>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
  {#if (activeTab === 'tracks' && topTracks.length > 0) || (activeTab === 'artists' && topArtists.length > 0) || (activeTab === 'albums' && topAlbums.length > 0)}
    <div class="card" style="margin-bottom: 1.5rem;">
      <BaseChart option={chartOption} height="380px" />
    </div>
  {/if}

  {#if activeTab === 'tracks'}
    <TrackList items={topTracks.slice(0, visibleCount)} showRank {metric} />
  {:else if activeTab === 'artists'}
    <div class="track-list">
      {#each topArtists.slice(0, visibleCount) as item, i}
        {#if item.artist}
          <a href="/artist/{item.artistId}" class="track-item">
            <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
            {#if item.artist.imageUrl}
              <img class="track-art" src={item.artist.imageUrl} alt={item.artist.name} style="border-radius: 50%;" />
            {:else}
              <div class="track-art" style="border-radius: 50%;"></div>
            {/if}
            <div class="track-info">
              <div class="track-name">{item.artist.name}{#if nowPlayingStore.artistIds.includes(item.artistId)} <span class="live-dot"></span>{/if}</div>
            </div>
            <div class="track-meta">
              <div class="track-plays">{metric === 'plays' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
              <div class="track-time">{metric === 'time' ? `${item.playCount} plays` : formatDuration(item.totalMs)}</div>
            </div>
          </a>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="track-list">
      {#each topAlbums.slice(0, visibleCount) as item, i}
        {#if item.album}
          <a href="/album/{item.albumId}" class="track-item">
            <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
            {#if item.album.imageUrl}
              <img class="track-art" src={item.album.imageUrl} alt={item.album.name} />
            {:else}
              <div class="track-art"></div>
            {/if}
            <div class="track-info">
              <div class="track-name">{item.album.name}{#if item.albumId === nowPlayingStore.albumId} <span class="live-dot"></span>{/if}</div>
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

  {#if visibleCount < totalItems()}
    <div class="scroll-sentinel" bind:this={sentinel}>
      <div class="spinner"></div>
    </div>
  {/if}
{/if}
