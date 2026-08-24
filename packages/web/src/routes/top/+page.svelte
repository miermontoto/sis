<script lang="ts">
  import { isAbortError } from '$lib/utils/errors';
  import { onMount, onDestroy, tick } from 'svelte';
  import { TOP_PAGE_LIMIT } from '@sis/shared';
  import { goto, afterNavigate } from '$app/navigation';
  import { api, createFetchController, getRankingMetric, getRankChangeLookback, type TopTrackItem, type TopArtistItem, type TopAlbumItem, type RankingMetric, type RankChangeLookback, type DateRangeParams } from '$lib/api';
  import { formatDuration, formatNumber, formatShortDate } from '$lib/utils/format';
  import { medalColor } from '$lib/utils/medals';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import TrackList from '$lib/components/TrackList.svelte';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { extractColor } from '$lib/utils/color';
  import { GRID, TOOLTIP_BASE, SPLIT_LINE, AXIS_LINE, AXIS_LABEL, zoomX, tooltipPoint, tooltipTuplePoints, type TooltipParams, type ChartClickEvent } from '$lib/utils/chart';
  import { nowPlayingStore } from '$lib/stores/now-playing.svelte';
  import { openEntityContextMenu } from '$lib/utils/entity-context';
  import RankChange from '$lib/components/RankChange.svelte';
  import IconPlus from '$lib/icons/IconPlus.svelte';
  import IconCheckSmall from '$lib/icons/IconCheckSmall.svelte';
  import IconTrack from '$lib/icons/IconTrack.svelte';
  import IconArtist from '$lib/icons/IconArtist.svelte';
  import IconAlbum from '$lib/icons/IconAlbum.svelte';
  import { shortcutStore } from '$lib/stores/keyboard-shortcuts.svelte';
  import type { EChartsOption } from 'echarts';

  let activeTab = $state<'tracks' | 'artists' | 'albums'>('tracks');
  let range = $state('month');
  let startDate = $state('');
  let endDate = $state('');
  let metric = $state<RankingMetric>('time');
  let lookback = $state<RankChangeLookback>('disabled');

  const LOOKBACK_QUALIFYING_RANGES = new Set(['3months', '6months', 'year', 'thisYear', 'all']);
  let showRankChanges = $derived(lookback !== 'disabled' && LOOKBACK_QUALIFYING_RANGES.has(range));

  let topTracks = $state<TopTrackItem[]>([]);
  let topArtists = $state<TopArtistItem[]>([]);
  let topAlbums = $state<TopAlbumItem[]>([]);
  let loading = $state(true);
  let barColors = $state<[number, number, number][]>([]);
  let chartMode = $state<'bar' | 'velocity'>('bar');
  const CHART_COUNT_OPTIONS = [5, 10, 20, 30, 50] as const;
  const DEFAULT_CHART_COUNT = 10;
  const CHART_COUNT_KEY = 'sis:topChartCount';
  let chartCount = $state(DEFAULT_CHART_COUNT);
  const fetchCtrl = createFetchController();

  function loadChartCount(): number {
    if (typeof localStorage === 'undefined') return DEFAULT_CHART_COUNT;
    const v = Number(localStorage.getItem(CHART_COUNT_KEY));
    return (CHART_COUNT_OPTIONS as readonly number[]).includes(v) ? v : DEFAULT_CHART_COUNT;
  }

  function setChartCount(n: number) {
    chartCount = n;
    if (typeof localStorage !== 'undefined') localStorage.setItem(CHART_COUNT_KEY, String(n));
  }

  // --- bar chart ---
  async function extractBarColors(tab: string, tracks: TopTrackItem[], artistsList: TopArtistItem[], albumsList: TopAlbumItem[], count: number) {
    let urls: (string | null)[] = [];
    if (tab === 'tracks') {
      urls = tracks.slice(0, count).map(t => t.track?.album?.imageUrl ?? null);
    } else if (tab === 'artists') {
      urls = artistsList.slice(0, count).map(a => a.artist?.imageUrl ?? null);
    } else {
      urls = albumsList.slice(0, count).map(a => a.album?.imageUrl ?? null);
    }
    return Promise.all(urls.map(u => u ? extractColor(u) : Promise.resolve<[number, number, number]>([29, 185, 84])));
  }

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
    if (activeTab === 'tracks') return topTracks.slice(0, chartCount).map(t => t.trackId).reverse();
    if (activeTab === 'artists') return topArtists.slice(0, chartCount).map(a => a.artistId).reverse();
    return topAlbums.slice(0, chartCount).map(a => a.albumId).reverse();
  });

  let barChartOption = $derived.by<EChartsOption>(() => {
    let names: string[] = [];
    let values: number[] = [];
    let images: (string | null)[] = [];

    if (activeTab === 'tracks') {
      const top = topTracks.slice(0, chartCount);
      names = top.map(t => t.track?.name ?? 'Unknown');
      values = top.map(t => metricValue(t));
      images = top.map(t => t.track?.album?.imageUrl ?? null);
    } else if (activeTab === 'artists') {
      const top = topArtists.slice(0, chartCount);
      names = top.map(a => a.artist?.name ?? 'Unknown');
      values = top.map(a => metricValue(a));
      images = top.map(a => a.artist?.imageUrl ?? null);
    } else {
      const top = topAlbums.slice(0, chartCount);
      names = top.map(a => a.album?.name ?? 'Unknown');
      values = top.map(a => metricValue(a));
      images = top.map(a => a.album?.imageUrl ?? null);
    }

    const MAX_NAME = 18;
    names = names.map(n => n.length > MAX_NAME ? n.slice(0, MAX_NAME - 1) + '…' : n);
    names = names.slice().reverse();
    values = values.slice().reverse();
    images = images.slice().reverse();
    const defaultRgb: [number, number, number] = [29, 185, 84];
    const colors = barColors.length >= names.length
      ? barColors.slice(0, names.length).slice().reverse()
      : names.map(() => defaultRgb);

    const rich: Record<string, any> = {
      name: { fontSize: 12, color: '#e0e8e8', width: 100, overflow: 'truncate', align: 'left' },
    };
    images.forEach((url, i) => {
      if (url) {
        rich[`img${i}`] = { backgroundColor: { image: url }, width: 26, height: 26, borderRadius: activeTab === 'artists' ? 13 : 2, align: 'left' };
      } else {
        rich[`img${i}`] = { backgroundColor: '#1e2a2a', width: 26, height: 26, borderRadius: activeTab === 'artists' ? 13 : 2, align: 'left' };
      }
    });

    return {
      grid: { top: 10, bottom: 5, right: 55, containLabel: false, left: 160 },
      tooltip: {
        ...TOOLTIP_BASE,
        axisPointer: { type: 'shadow' },
        formatter: (params: TooltipParams) => {
          const p = tooltipPoint(params);
          return `${p.name}<br/>${metric === 'plays' ? `${p.value} plays` : formatChartValue(p.value)}`;
        },
      },
      xAxis: {
        type: 'value',
        splitLine: { ...SPLIT_LINE },
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => metric === 'plays' ? String(v) : formatChartValue(v) },
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
              borderRadius: [0, 2, 2, 0],
            },
          };
        }),
        barMaxWidth: 28,
        cursor: 'pointer',
        label: {
          show: true,
          position: 'right',
          color: '#6a7a7a',
          fontSize: 11,
          formatter: (params: TooltipParams) => { const p = tooltipPoint(params); return metric === 'plays' ? `${p.value}` : formatChartValue(p.value); },
        },
      }],
    };
  });

  function handleBarChartClick(params: ChartClickEvent) {
    let dataIdx: number;
    if (params.componentType === 'yAxis') {
      // el eje se construye siempre como uno solo (categoryAxis), pero el tipo de
      // EChartsOption['yAxis'] es "uno o varios" y `data` sólo existe en la rama de
      // categorías: se estrecha a la forma que de verdad se lee
      const yAxis = barChartOption.yAxis;
      const axis = (Array.isArray(yAxis) ? yAxis[0] : yAxis) as { data?: string[] } | undefined;
      const names = axis?.data;
      dataIdx = names ? names.indexOf(String(params.value)) : -1;
    } else {
      dataIdx = params.dataIndex;
    }
    if (dataIdx == null || dataIdx < 0 || dataIdx >= chartEntityIds.length) return;
    const id = chartEntityIds[dataIdx];
    const prefix = activeTab === 'tracks' ? 'track' : activeTab === 'artists' ? 'artist' : 'album';
    goto(`/${prefix}/${id}`);
  }

  // --- velocity chart (auto top 10) ---
  // fallback cuando aún no hay color extraído de la portada
  const DEFAULT_VEL_RGB: [number, number, number] = [29, 185, 84];
  type VelEntry = { id: string; name: string; points: [string, number][] };
  let velSeries = $state<VelEntry[]>([]);
  let velLoading = $state(false);
  let velHiddenIds = $state<Set<string>>(new Set());

  // mapa id -> { imageUrl, color } reusando los colores extraídos del bar chart.
  // barColors está indexado por posición en topX.slice(0, chartCount), igual que las portadas.
  let velMeta = $derived.by(() => {
    type Meta = { imageUrl: string | null; rgb: [number, number, number] };
    const meta = new Map<string, Meta>();
    if (activeTab === 'tracks') {
      topTracks.slice(0, chartCount).forEach((t, i) => {
        meta.set(t.trackId, {
          imageUrl: t.track?.album?.imageUrl ?? null,
          rgb: barColors[i] ?? DEFAULT_VEL_RGB,
        });
      });
    } else if (activeTab === 'artists') {
      topArtists.slice(0, chartCount).forEach((a, i) => {
        meta.set(a.artistId, {
          imageUrl: a.artist?.imageUrl ?? null,
          rgb: barColors[i] ?? DEFAULT_VEL_RGB,
        });
      });
    } else {
      topAlbums.slice(0, chartCount).forEach((a, i) => {
        meta.set(a.albumId, {
          imageUrl: a.album?.imageUrl ?? null,
          rgb: barColors[i] ?? DEFAULT_VEL_RGB,
        });
      });
    }
    return meta;
  });

  function rgbToCss([r, g, b]: [number, number, number]): string {
    return `rgb(${r},${g},${b})`;
  }

  function velMetricValue(s: { play_count: number; total_ms: number }): number {
    return metric === 'plays' ? s.play_count : s.total_ms / 60_000;
  }

  function velFormatValue(v: number): string {
    if (metric === 'plays') return formatNumber(Math.round(v));
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function velFormatMetric(v: number): string {
    return metric === 'plays' ? `${formatNumber(Math.round(v))} plays` : velFormatValue(v);
  }

  function seriesToCumulative(raw: { period: string; play_count: number; total_ms: number }[], id: string, name: string): VelEntry | null {
    const sorted = [...raw].sort((a, b) => a.period.localeCompare(b.period));
    let acc = 0;
    const points: [string, number][] = sorted.map((s) => {
      acc += velMetricValue(s);
      return [s.period, acc];
    });
    return points.length > 0 ? { id, name, points } : null;
  }

  async function loadVelocity(tab: typeof activeTab, entries: { id: string; name: string }[], r: string) {
    if (entries.length === 0) { velSeries = []; return; }
    velLoading = true;
    try {
      const results = await Promise.all(entries.map(async ({ id, name }) => {
        try {
          let series: { period: string; play_count: number; total_ms: number }[];
          if (tab === 'tracks') {
            series = (await api.trackDetail(id, r)).series;
          } else if (tab === 'artists') {
            series = (await api.artistDetail(id, r)).series;
          } else {
            series = (await api.albumDetail(id, r)).series;
          }
          return seriesToCumulative(series, id, name);
        } catch { return null; }
      }));
      velSeries = results.filter((s): s is VelEntry => s !== null);
    } finally {
      velLoading = false;
    }
  }

  let velTopEntries = $derived.by(() => {
    if (activeTab === 'tracks') return topTracks.slice(0, chartCount).filter(t => t.track).map(t => ({ id: t.trackId, name: t.track!.name }));
    if (activeTab === 'artists') return topArtists.slice(0, chartCount).filter(a => a.artist).map(a => ({ id: a.artistId, name: a.artist!.name }));
    return topAlbums.slice(0, chartCount).filter(a => a.album).map(a => ({ id: a.albumId, name: a.album!.name }));
  });

  $effect(() => {
    const tab = activeTab;
    const entries = velTopEntries;
    const r = range;
    if (!loading && entries.length > 0) {
      loadVelocity(tab, entries, r);
    }
  });

  let velChartOption = $derived.by<EChartsOption>(() => {
    if (velSeries.length === 0) return {} as EChartsOption;

    const isArtists = activeTab === 'artists';
    const COVER = 18;

    const series = velSeries
      .filter((s) => !velHiddenIds.has(s.id))
      .map((s) => {
        const meta = velMeta.get(s.id);
        const color = rgbToCss(meta?.rgb ?? DEFAULT_VEL_RGB);
        const imageUrl = meta?.imageUrl ?? null;
        const richKey = `img_${s.id.replace(/[^a-zA-Z0-9]/g, '')}`;
        const MAX_NAME = 16;
        const displayName = s.name.length > MAX_NAME ? s.name.slice(0, MAX_NAME - 1) + '…' : s.name;
        const rich: Record<string, any> = {
          name: { color, fontWeight: 700, fontSize: 11, padding: [0, 0, 0, 6], verticalAlign: 'middle' },
        };
        if (imageUrl) {
          rich[richKey] = {
            backgroundColor: { image: imageUrl },
            width: COVER,
            height: COVER,
            borderRadius: isArtists ? COVER / 2 : 2,
          };
        } else {
          rich[richKey] = {
            backgroundColor: '#1e2a2a',
            width: COVER,
            height: COVER,
            borderRadius: isArtists ? COVER / 2 : 2,
          };
        }
        return {
          id: s.id,
          name: s.name,
          type: 'line' as const,
          showSymbol: false,
          smooth: false,
          cursor: 'pointer',
          data: s.points,
          lineStyle: { width: 2, color },
          itemStyle: { color },
          emphasis: { lineStyle: { width: 3 } },
          labelLayout: { moveOverlap: 'shiftY' as const },
          endLabel: {
            show: true,
            formatter: `{${richKey}|} {name|${displayName}}`,
            rich,
            padding: [2, 0, 0, 0],
          },
        };
      });

    return {
      grid: { ...GRID, right: 150, bottom: 52 },
      dataZoom: zoomX(),
      tooltip: {
        ...TOOLTIP_BASE,
        formatter: (params: TooltipParams) => {
          const list = tooltipTuplePoints(params);
          if (list.length === 0) return '';
          const header = formatShortDate(String(list[0].value[0]));
          const rows = list
            .sort((a, b) => b.value[1] - a.value[1])
            .map(p => `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${velFormatMetric(p.value[1])}</b>`)
            .join('<br/>');
          return `<b>${header}</b><br/>${rows}`;
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { ...AXIS_LINE },
        axisLabel: { ...AXIS_LABEL },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { ...AXIS_LINE },
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => velFormatValue(v) },
        splitLine: { ...SPLIT_LINE },
      },
      series,
    };
  });

  function handleVelocityClick(params: ChartClickEvent) {
    const id = params?.seriesId as string | undefined;
    if (!id) return;
    const next = new Set(velHiddenIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    velHiddenIds = next;
  }

  function showVelocityEntity(id: string) {
    if (!velHiddenIds.has(id)) return;
    const next = new Set(velHiddenIds);
    next.delete(id);
    velHiddenIds = next;
  }

  // limpiar items ocultos cuando cambia el dataset mostrado
  $effect(() => {
    void activeTab;
    void range;
    void metric;
    void startDate;
    void endDate;
    void chartCount;
    velHiddenIds = new Set();
  });

  // re-extraer colores cuando cambia chartCount (sin recargar datos)
  $effect(() => {
    const count = chartCount;
    if (loading) return;
    if (barColors.length === count) return;
    const signal = fetchCtrl.signal;
    (async () => {
      const colors = await extractBarColors(activeTab, topTracks, topArtists, topAlbums, count);
      if (!signal?.aborted) barColors = colors;
    })();
  });

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

  async function loadData() {
    const signal = fetchCtrl.reset();
    loading = true;
    visibleCount = PAGE_SIZE;
    try {
      const dates = getCustomDates();
      const lb = lookback !== 'disabled' && LOOKBACK_QUALIFYING_RANGES.has(range) ? lookback : undefined;
      if (activeTab === 'tracks') {
        topTracks = await api.topTracks(range, TOP_PAGE_LIMIT, metric, dates, lb, signal);
      } else if (activeTab === 'artists') {
        topArtists = await api.topArtists(range, TOP_PAGE_LIMIT, metric, dates, lb, signal);
      } else {
        topAlbums = await api.topAlbums(range, TOP_PAGE_LIMIT, metric, dates, lb, signal);
      }
      if (!signal.aborted) {
        barColors = await extractBarColors(activeTab, topTracks, topArtists, topAlbums, chartCount);
      }
    } catch (e) {
      if (isAbortError(e)) return;
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

  // sincroniza el estado local con los query params; se llama al montar y en cada
  // navegación posterior (los links a /top?focus=... no remontan el componente)
  function syncFromUrl() {
    const newRange = getQueryParam('range', 'month');
    const newStartDate = getQueryParam('startDate', '');
    const newEndDate = getQueryParam('endDate', '');
    const newTab = getQueryParam('tab', 'tracks') as 'tracks' | 'artists' | 'albums';
    const changed = newRange !== range || newStartDate !== startDate
      || newEndDate !== endDate || newTab !== activeTab;
    range = newRange;
    startDate = newStartDate;
    endDate = newEndDate;
    activeTab = newTab;
    const focus = getQueryParam('focus', '') || null;
    if (!focus) return;
    // si va a haber recarga de datos (o ya hay una en curso), loadData consume
    // el focus al terminar; si no, los datos ya están y se puede enfocar directo
    if (changed || loading) pendingFocusId = focus;
    else void focusEntity(focus);
  }

  afterNavigate(() => {
    if (initialized) syncFromUrl();
  });

  onMount(() => {
    metric = getRankingMetric();
    lookback = getRankChangeLookback();
    chartCount = loadChartCount();
    syncFromUrl();
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

  const RANGES = ['week', 'month', '3months', '6months', 'year', 'thisYear', 'all'];
  const TABS: ('tracks' | 'artists' | 'albums')[] = ['tracks', 'albums', 'artists'];

  shortcutStore.registerPageShortcuts(
    [
      { key: '1', description: 'Tracks', category: 'page' },
      { key: '2', description: 'Albums', category: 'page' },
      { key: '3', description: 'Artists', category: 'page' },
      { key: '[', description: 'Previous range', category: 'page' },
      { key: ']', description: 'Next range', category: 'page' },
    ],
    (e) => {
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        setTab(TABS[+e.key - 1]);
        return true;
      }
      if (e.key === '[' || e.key === ']') {
        const idx = RANGES.indexOf(range);
        if (idx < 0) return false;
        const next = e.key === '[' ? idx - 1 : idx + 1;
        if (next >= 0 && next < RANGES.length) { e.preventDefault(); setRange(RANGES[next]); }
        return true;
      }
      return false;
    },
  );
  onDestroy(() => shortcutStore.unregisterPageShortcuts());

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
  <h1>Rankings</h1>
</div>

<div class="tabs">
  <button class="tab" class:active={activeTab === 'tracks'} onclick={() => setTab('tracks')}>
    <IconTrack size={14} /> Tracks
  </button>
  <button class="tab" class:active={activeTab === 'albums'} onclick={() => setTab('albums')}>
    <IconAlbum size={14} /> Albums
  </button>
  <button class="tab" class:active={activeTab === 'artists'} onclick={() => setTab('artists')}>
    <IconArtist size={14} /> Artists
  </button>
</div>

<div class="range-row">
  <TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />
  {#if !loading}
    {#if createdPlaylistId}
      <a href="/playlists/{createdPlaylistId}" class="range-btn range-btn--playlist range-btn--ok">
        <IconCheckSmall />
        Created
      </a>
    {:else}
      <button
        class="range-btn range-btn--playlist"
        class:range-btn--busy={creatingPlaylist}
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
  <div class="card chart-card">
    <div class="chart-controls">
      <select
        class="chart-count-select"
        value={chartCount}
        onchange={(e) => setChartCount(+(e.currentTarget as HTMLSelectElement).value)}
        title="Number of entities shown"
      >
        {#each CHART_COUNT_OPTIONS as n}
          <option value={n}>Top {n}</option>
        {/each}
      </select>
      <div class="chart-mode-toggle">
        <button class:active={chartMode === 'bar'} onclick={() => chartMode = 'bar'}>Bar</button>
        <button class:active={chartMode === 'velocity'} onclick={() => chartMode = 'velocity'}>Velocity</button>
      </div>
    </div>
    {#if chartMode === 'bar'}
      <BaseChart option={barChartOption} height="{Math.max(chartCount * 44 + 30, 360)}px" onclick={handleBarChartClick} />
    {:else if velLoading}
      <div class="vel-loading" style:height="{Math.max(chartCount * 22 + 180, 380)}px"><div class="spinner"></div></div>
    {:else if velSeries.length > 0}
      <BaseChart option={velChartOption} height="{Math.max(chartCount * 22 + 180, 380)}px" replaceMerge={['series']} onclick={handleVelocityClick} />
      {#if velHiddenIds.size > 0}
        <div class="vel-hidden-row">
          <span class="vel-hidden-label">Hidden:</span>
          {#each velSeries as s (s.id)}
            {#if velHiddenIds.has(s.id)}
              {@const meta = velMeta.get(s.id)}
              <button
                class="vel-hidden-chip"
                onclick={() => showVelocityEntity(s.id)}
                title="Show {s.name}"
                style:border-left-color={meta ? rgbToCss(meta.rgb) : undefined}
              >
                {#if meta?.imageUrl}
                  <img
                    class="vel-hidden-cover"
                    class:vel-hidden-cover--round={activeTab === 'artists'}
                    src={meta.imageUrl}
                    alt=""
                  />
                {:else}
                  <span
                    class="vel-hidden-cover vel-hidden-cover--placeholder"
                    class:vel-hidden-cover--round={activeTab === 'artists'}
                  ></span>
                {/if}
                {s.name}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#if activeTab === 'tracks'}
    <TrackList items={topTracks.slice(0, visibleCount)} showRank {showRankChanges} {metric} focusId={focusedId} />
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
            {#if showRankChanges}
              <div class="rank-col">
                <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
                <RankChange rankChange={item.rankChange} isNew={item.isNew} />
              </div>
            {:else}
              <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
            {/if}
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
            {#if showRankChanges}
              <div class="rank-col">
                <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
                <RankChange rankChange={item.rankChange} isNew={item.isNew} />
              </div>
            {:else}
              <span class="track-rank" style:color={medalColor(i + 1)}>{i + 1}</span>
            {/if}
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
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 1.25rem;
  }
  .range-row :global(.time-range-selector) {
    display: contents;
  }

  .chart-card {
    position: relative;
    margin-bottom: 1.5rem;
  }

  .chart-controls {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 1;
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }

  .chart-count-select {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
    font-size: 0.7rem;
    font-family: inherit;
    cursor: pointer;
  }

  .chart-count-select:hover {
    color: var(--text);
  }

  .chart-mode-toggle {
    display: flex;
    gap: 0.15rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.15rem;
  }

  .chart-mode-toggle button {
    padding: 0.15rem 0.5rem;
    border-radius: calc(var(--radius) - 2px);
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.7rem;
  }

  .chart-mode-toggle button.active {
    background: var(--accent);
    color: #000;
  }

  .vel-loading {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 380px;
  }

  .vel-hidden-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem 0.25rem;
    font-size: 0.75rem;
  }

  .vel-hidden-label {
    color: var(--text-muted);
    margin-right: 0.15rem;
  }

  .vel-hidden-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.15rem 0.5rem 0.15rem 0.3rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    border-left-width: 3px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.75rem;
    font-family: inherit;
    transition: color 0.05s, border-color 0.05s, background 0.05s;
  }

  .vel-hidden-chip:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.03);
  }

  .vel-hidden-cover {
    width: 18px;
    height: 18px;
    border-radius: 2px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .vel-hidden-cover--round {
    border-radius: 50%;
  }

  .vel-hidden-cover--placeholder {
    background: #1e2a2a;
    display: inline-block;
  }
</style>
