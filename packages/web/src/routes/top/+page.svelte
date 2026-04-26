<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, createFetchController, getRankingMetric, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type RankingMetric, type DateRangeParams } from '$lib/api';
  import { formatDuration } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { extractColor } from '$lib/utils/color';
  import { GRID, TOOLTIP_BASE, SPLIT_LINE, AXIS_LINE, AXIS_LABEL } from '$lib/utils/chart';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { openEntityContextMenu } from '$lib/utils/entity-context';
  import IconPlus from '$lib/icons/IconPlus.svelte';
  import IconCheckSmall from '$lib/icons/IconCheckSmall.svelte';
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
  const fetchCtrl = createFetchController();

  function getCustomDates(): DateRangeParams | undefined {
    if (range === 'custom' && startDate && endDate) return { startDate, endDate };
    return undefined;
  }

  const PAGE_SIZE = 50;
  let visibleCount = $state(PAGE_SIZE);
  let sentinel = $state<HTMLElement | null>(null);
  let observer: IntersectionObserver | null = null;

  // ID que llega vía ?focus=... para hacer scroll al item al cargar la página
  let pendingFocusId = $state<string | null>(null);
  let focusedId = $state<string | null>(null);

  async function extractBarColors(tab: string, tracks: TopTrackItem[], artistsList: TopArtistItem[], albumsList: TopAlbumItem[]) {
    let urls: (string | null)[] = [];
    if (tab === 'tracks') {
      urls = tracks.slice(0, 10).map(t => t.track?.album?.imageUrl ?? null);
    } else if (tab === 'artists') {
      urls = artistsList.slice(0, 10).map(a => a.artist?.imageUrl ?? null);
    } else {
      urls = albumsList.slice(0, 10).map(a => a.album?.imageUrl ?? null);
    }
    return Promise.all(urls.map(u => u ? extractColor(u) : Promise.resolve<[number, number, number]>([29, 185, 84])));
  }

  async function loadData() {
    const signal = fetchCtrl.reset();
    loading = true;
    visibleCount = PAGE_SIZE;
    try {
      const dates = getCustomDates();
      if (activeTab === 'tracks') {
        topTracks = await api.topTracks(range, 200, metric, dates, signal);
      } else if (activeTab === 'artists') {
        topArtists = await api.topArtists(range, 200, metric, dates, signal);
      } else {
        topAlbums = await api.topAlbums(range, 200, metric, dates, signal);
      }
      // extraer colores en el mismo ciclo para evitar doble re-render del chart
      if (!signal.aborted) {
        barColors = await extractBarColors(activeTab, topTracks, topArtists, topAlbums);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loading = false;
      if (!signal.aborted && pendingFocusId) {
        const id = pendingFocusId;
        pendingFocusId = null;
        void focusEntity(id);
      }
    }
  }

  function findIndex(id: string): number {
    if (activeTab === 'tracks') return topTracks.findIndex(t => t.trackId === id);
    if (activeTab === 'artists') return topArtists.findIndex(a => a.artistId === id);
    return topAlbums.findIndex(a => a.albumId === id);
  }

  async function waitForElement(selector: string, timeoutMs = 2000): Promise<HTMLElement | null> {
    const deadline = performance.now() + timeoutMs;
    let el = document.querySelector<HTMLElement>(selector);
    while (!el && performance.now() < deadline) {
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      el = document.querySelector<HTMLElement>(selector);
    }
    return el;
  }

  async function focusEntity(id: string) {
    const idx = findIndex(id);
    if (idx < 0) return;
    if (idx >= visibleCount) visibleCount = Math.min(idx + 1, totalItems());
    focusedId = id;
    await tick();
    const el = await waitForElement(`[data-focus-id="${CSS.escape(id)}"]`);
    if (!el) return;
    // dejar que el navegador termine cualquier scroll pendiente (p.ej. el reset
    // de SvelteKit tras la navegación) antes de posicionar el item
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // limpiar el parámetro de URL después de que el scroll haya tenido tiempo de ejecutarse
    setTimeout(() => setQueryParams({ focus: null }), 1000);
    setTimeout(() => { if (focusedId === id) focusedId = null; }, 2000);
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
    pendingFocusId = getQueryParam('focus', '') || null;
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

  function metricValue(item: { playCount: number; totalMs: number }): number {
    return metric === 'plays' ? item.playCount : item.totalMs / 60_000;
  }

  function formatChartValue(ms: number): string {
    if (metric === 'plays') return String(ms);
    const h = Math.floor(ms / 60);
    const m = Math.round(ms % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  let chartEntityIds = $derived.by(() => {
    if (activeTab === 'tracks') return topTracks.slice(0, 10).map(t => t.trackId).reverse();
    if (activeTab === 'artists') return topArtists.slice(0, 10).map(a => a.artistId).reverse();
    return topAlbums.slice(0, 10).map(a => a.albumId).reverse();
  });

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
      name: { fontSize: 12, color: '#e5e5e5', width: 100, overflow: 'truncate', align: 'left' },
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
      grid: { top: 10, bottom: 5, right: 55, containLabel: false, left: 160 },
      tooltip: {
        ...TOOLTIP_BASE,
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.name}<br/>${metric === 'plays' ? `${p.value} plays` : formatChartValue(p.value)}`;
        },
      },
      xAxis: {
        type: 'value',
        splitLine: { ...SPLIT_LINE },
        axisLabel: {
          ...AXIS_LABEL,
          formatter: (v: number) => metric === 'plays' ? String(v) : formatChartValue(v),
        },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { ...AXIS_LINE },
        axisTick: { show: false },
        axisLabel: {
          rich,
          align: 'left',
          margin: 155,
          formatter: (name: string) => {
            const idx = names.indexOf(name);
            return `{img${idx}|}  {name|${name}}`;
          },
        },
        triggerEvent: true,
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
        cursor: 'pointer',
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

  function handleChartClick(params: any) {
    const idx = params.dataIndex ?? (params.componentType === 'yAxis' ? chartEntityIds.length - 1 - (params.value ? chartEntityIds.indexOf(params.value) : -1) : -1);
    let dataIdx: number;
    if (params.componentType === 'yAxis') {
      const names = (chartOption as any)?.yAxis?.data as string[] | undefined;
      dataIdx = names ? names.indexOf(params.value) : -1;
    } else {
      dataIdx = params.dataIndex;
    }
    if (dataIdx == null || dataIdx < 0 || dataIdx >= chartEntityIds.length) return;
    const id = chartEntityIds[dataIdx];
    const prefix = activeTab === 'tracks' ? 'track' : activeTab === 'artists' ? 'artist' : 'album';
    goto(`/${prefix}/${id}`);
  }

  // --- playlist creation ---
  let creatingPlaylist = $state(false);
  let createdPlaylistId = $state<number | null>(null);

  // reset cuando cambia tab/range
  $effect(() => {
    void activeTab;
    void range;
    void startDate;
    void endDate;
    createdPlaylistId = null;
  });

  function singularTab(t: 'tracks' | 'artists' | 'albums'): 'track' | 'album' | 'artist' {
    if (t === 'tracks') return 'track';
    if (t === 'albums') return 'album';
    return 'artist';
  }

  async function createTopPlaylist() {
    if (creatingPlaylist) return;
    creatingPlaylist = true;
    try {
      const params: Record<string, unknown> = {
        entityType: singularTab(activeTab),
        range,
        sort: metric,
        limit: 50,
      };
      if (range === 'custom' && startDate && endDate) {
        params.startDate = startDate;
        params.endDate = endDate;
      }
      const result = await api.generatePlaylist({ strategy: 'top', params });
      if ('id' in result) createdPlaylistId = result.libraryPlaylistId ?? result.id;
    } catch { /* silently fail */ }
    finally { creatingPlaylist = false; }
  }
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

<div class="range-row">
  <TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />
  {#if !loading}
    {#if createdPlaylistId}
      <a href="/playlists/{createdPlaylistId}" class="playlist-btn playlist-btn--ok">
        <IconCheckSmall />
        Created
      </a>
    {:else}
      <button
        class="playlist-btn"
        class:playlist-btn--busy={creatingPlaylist}
        onclick={createTopPlaylist}
        disabled={creatingPlaylist}
        title="Create Spotify playlist from current top"
      >
        {#if creatingPlaylist}
          <span class="btn-spinner"></span>
          Creating…
        {:else}
          <IconPlus />
          Playlist
        {/if}
      </button>
    {/if}
  {/if}
</div>

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
  {#if (activeTab === 'tracks' && topTracks.length > 0) || (activeTab === 'artists' && topArtists.length > 0) || (activeTab === 'albums' && topAlbums.length > 0)}
    <div class="card" style="margin-bottom: 1.5rem;">
      <BaseChart option={chartOption} height="380px" onclick={handleChartClick} />
    </div>
  {/if}

  {#if activeTab === 'tracks'}
    <TrackList items={topTracks.slice(0, visibleCount)} showRank {metric} {focusedId} />
  {:else if activeTab === 'artists'}
    <div class="track-list">
      {#each topArtists.slice(0, visibleCount) as item, i}
        {#if item.artist}
          <a
            href="/artist/{item.artistId}"
            class="track-item"
            class:track-item--focused={focusedId === item.artistId}
            data-focus-id={item.artistId}
            oncontextmenu={openEntityContextMenu({ type: 'artist', id: item.artistId, name: item.artist.name, imageUrl: item.artist.imageUrl })}
          >
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
          <a
            href="/album/{item.albumId}"
            class="track-item"
            class:track-item--focused={focusedId === item.albumId}
            data-focus-id={item.albumId}
            oncontextmenu={openEntityContextMenu({ type: 'album', id: item.albumId, name: item.album.name, imageUrl: item.album.imageUrl })}
          >
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

<style>
  .range-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }
  .range-row :global(.time-range-selector) {
    margin-bottom: 0;
  }
</style>
