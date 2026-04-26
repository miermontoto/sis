<script lang="ts">
  import { onMount } from 'svelte';
  import { api, createFetchController, getRankingMetric, type TopArtistItem, type ArtistDetail, type RankingMetric } from '$lib/api';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { formatNumber, formatShortDate } from '$lib/utils/format';
  import { GRID, TOOLTIP_BASE, AXIS_LINE, AXIS_LABEL, SPLIT_LINE } from '$lib/utils/chart';
  import type { EChartsOption } from 'echarts';

  // paleta fija de colores asignados por orden de selección
  const PALETTE = [
    '#1db954', '#ff1493', '#ff8c42', '#3b9bd9', '#a88bff',
    '#ffd166', '#ef476f', '#06d6a0', '#e5e5e5', '#f95738',
  ];

  // cada punto: [periodo ISO, acumulado metric]
  type CumulativeSeries = { artistId: string; name: string; points: [string, number][] };

  let topArtists = $state<TopArtistItem[]>([]);
  let selected = $state<string[]>([]);
  let cache = new Map<string, CumulativeSeries>();
  let loadingTop = $state(true);
  let loadingSeries = $state<Set<string>>(new Set());
  // absoluto: eje X = fecha real. relativo: eje X = días desde la primera escucha del artista.
  let mode = $state<'absolute' | 'relative'>('absolute');
  let metric = $state<RankingMetric>('time');
  const fetchCtrl = createFetchController();

  // cuando metric == 'time' acumulamos en MINUTOS (evita números enormes en eje Y)
  function metricValue(s: { play_count: number; total_ms: number }): number {
    return metric === 'plays' ? s.play_count : s.total_ms / 60_000;
  }

  // formatea un valor del eje/tooltip con la unidad correcta
  function formatMetricValue(v: number): string {
    if (metric === 'plays') return formatNumber(Math.round(v));
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function formatMetric(v: number): string {
    return metric === 'plays' ? `${formatNumber(Math.round(v))} plays` : formatMetricValue(v);
  }

  async function loadTop() {
    const signal = fetchCtrl.reset();
    loadingTop = true;
    // invalidar cache si cambia la métrica (los acumulados ya no son válidos)
    cache = new Map();
    selected = [];
    try {
      topArtists = await api.topArtists('all', 50, metric, undefined, signal);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    } finally {
      if (!signal.aborted) loadingTop = false;
    }
  }

  function toCumulative(detail: ArtistDetail, artistId: string, name: string): CumulativeSeries {
    const sorted = [...detail.series].sort((a, b) => a.period.localeCompare(b.period));
    let acc = 0;
    const points: [string, number][] = sorted.map((s) => {
      acc += metricValue(s);
      return [s.period, acc];
    });
    return { artistId, name, points };
  }

  async function toggleArtist(item: TopArtistItem) {
    if (!item.artist) return;
    const id = item.artistId;
    if (selected.includes(id)) {
      selected = selected.filter(x => x !== id);
      return;
    }
    if (!cache.has(id)) {
      loadingSeries = new Set(loadingSeries).add(id);
      try {
        const detail = await api.artistDetail(id, 'all');
        cache.set(id, toCumulative(detail, id, item.artist.name));
      } finally {
        const next = new Set(loadingSeries);
        next.delete(id);
        loadingSeries = next;
      }
    }
    selected = [...selected, id];
  }

  // convierte un punto a [x, y] según el modo
  function toDataPoint(periodStr: string, firstPeriod: string, value: number): [number | string, number] {
    if (mode === 'absolute') return [periodStr, value];
    const days = Math.round((new Date(periodStr).getTime() - new Date(firstPeriod).getTime()) / 86_400_000);
    return [days, value];
  }

  const chartOption = $derived.by<EChartsOption>(() => {
    if (selected.length === 0) return {} as EChartsOption;

    const series = selected
      .map((id) => cache.get(id))
      .filter((s): s is CumulativeSeries => !!s && s.points.length > 0)
      .map((s, i) => {
        const first = s.points[0][0];
        const data = s.points.map(([p, v]) => toDataPoint(p, first, v));
        return {
          name: s.name,
          type: 'line' as const,
          showSymbol: false,
          smooth: false,
          data,
          lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
          itemStyle: { color: PALETTE[i % PALETTE.length] },
          endLabel: {
            show: true,
            formatter: '{a}',
            color: PALETTE[i % PALETTE.length],
            fontWeight: 700,
          },
        };
      });

    return {
      grid: { ...GRID, right: 120, bottom: 40 },
      tooltip: {
        ...TOOLTIP_BASE,
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          if (list.length === 0) return '';
          const xVal = list[0].value[0];
          const header = mode === 'absolute'
            ? formatShortDate(String(xVal))
            : `day ${formatNumber(Number(xVal))}`;
          const rows = list
            .sort((a: any, b: any) => b.value[1] - a.value[1])
            .map((p: any) => `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${formatMetric(p.value[1])}</b>`)
            .join('<br/>');
          return `<b>${header}</b><br/>${rows}`;
        },
      },
      xAxis: mode === 'absolute'
        ? {
          type: 'time',
          axisLine: { ...AXIS_LINE },
          axisLabel: { ...AXIS_LABEL },
          splitLine: { show: false },
        }
        : {
          type: 'value',
          name: 'days since first listen',
          nameLocation: 'middle',
          nameGap: 28,
          nameTextStyle: { color: '#666', fontSize: 11 },
          axisLine: { ...AXIS_LINE },
          axisLabel: { ...AXIS_LABEL },
          splitLine: { show: false },
        },
      yAxis: {
        type: 'value',
        axisLine: { ...AXIS_LINE },
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => formatMetricValue(v) },
        splitLine: { ...SPLIT_LINE },
      },
      series,
    };
  });

  onMount(() => {
    metric = getRankingMetric();
    loadTop();
  });
</script>

<div class="page-header">
  <h1>Artist Velocity</h1>
  <p>Compare the cumulative listening trajectory of each artist.</p>
</div>

<div class="av-layout">
  <aside class="av-sidebar card">
    <div class="av-header">
      <span>Top 50 artists</span>
      <div class="mode-toggle">
        <button class="mode-btn" class:active={mode === 'absolute'} onclick={() => mode = 'absolute'}>Absolute</button>
        <button class="mode-btn" class:active={mode === 'relative'} onclick={() => mode = 'relative'}>Relative</button>
      </div>
    </div>
    {#if loadingTop}
      <div class="loading"><div class="spinner"></div></div>
    {:else}
      <div class="chips">
        {#each topArtists as item}
          {@const isSel = selected.includes(item.artistId)}
          {@const isLoading = loadingSeries.has(item.artistId)}
          {@const selIdx = selected.indexOf(item.artistId)}
          <button
            class="chip"
            class:active={isSel}
            style:border-color={isSel ? PALETTE[selIdx % PALETTE.length] : undefined}
            style:color={isSel ? PALETTE[selIdx % PALETTE.length] : undefined}
            onclick={() => toggleArtist(item)}
            disabled={isLoading}
          >
            {item.artist?.name ?? '—'}
            {#if isLoading}<span class="mini-spin"></span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </aside>

  <div class="av-chart card">
    {#if selected.length === 0}
      <div class="hint">Select artists on the left to compare their trajectories.</div>
    {:else}
      <BaseChart option={chartOption} height="560px" />
    {/if}
  </div>
</div>

<style>
  .page-header p {
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }

  .av-layout {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 1rem;
    margin-top: 1rem;
  }

  @media (max-width: 900px) {
    .av-layout { grid-template-columns: 1fr; }
  }

  .av-sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 660px;
    overflow: hidden;
  }

  .av-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--text-muted);
    font-size: 0.85rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .mode-toggle {
    display: flex;
    gap: 0.25rem;
  }

  .mode-btn {
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.75rem;
    font-family: var(--font);
  }

  .mode-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #000;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    overflow-y: auto;
    padding-right: 0.3rem;
  }

  .chip {
    padding: 0.3rem 0.6rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.8rem;
    font-family: var(--font);
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    transition: all 0.15s;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--text-muted);
    color: var(--text);
  }

  .chip.active {
    background: transparent;
    font-weight: 600;
  }

  .chip:disabled { opacity: 0.6; cursor: wait; }

  .mini-spin {
    width: 10px;
    height: 10px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .av-chart {
    min-height: 600px;
    padding: 0.5rem;
  }

  .hint {
    text-align: center;
    color: var(--text-muted);
    padding: 4rem 1rem;
    font-size: 0.9rem;
  }
</style>
