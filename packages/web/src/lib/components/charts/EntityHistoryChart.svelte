<script lang="ts">
  import { formatDuration } from '$lib/utils/format';
  import { GRID, TOOLTIP_BASE, AXIS_LABEL, categoryAxis, valueAxis, barSeries, eventsMarkLine, type ChartEvent, tooltipPoint, type TooltipParams, type ChartClickEvent } from '$lib/utils/chart';
  import BaseChart from './BaseChart.svelte';
  import ReleaseRail from './ReleaseRail.svelte';
  import type * as echarts from 'echarts/core';
  import type { EChartsOption } from 'echarts';
  import type { RankingMetric } from '$lib/api';

  // gráfica de barras estilo last.fm con drill-down: arranca en años y, al pinchar un año,
  // baja a sus meses. espera la serie mensual all-time (period = 'YYYY-MM') que las páginas de
  // detalle ya cargan (range='all'); toda la agregación año/mes es en cliente (sin refetch).
  let {
    series,
    metric,
    height = '180px',
    events = [],
  }: {
    series: { period: string; play_count: number; total_ms: number }[];
    metric: RankingMetric;
    height?: string;
    events?: ChartEvent[];
  } = $props();

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let drillYear = $state<string | null>(null);

  // agrega la serie mensual en totales por año, rellenando años sin datos con cero para que la
  // línea temporal sea continua (un artista que se dejó de escuchar un año muestra barra vacía)
  let yearTotals = $derived.by(() => {
    const byYear = new Map<string, { play_count: number; total_ms: number }>();
    for (const d of series) {
      const y = d.period.slice(0, 4);
      if (!/^\d{4}$/.test(y)) continue;
      const acc = byYear.get(y) ?? { play_count: 0, total_ms: 0 };
      acc.play_count += d.play_count;
      acc.total_ms += d.total_ms;
      byYear.set(y, acc);
    }
    const present = [...byYear.keys()].map(Number).sort((a, b) => a - b);
    const out: { year: string; play_count: number; total_ms: number }[] = [];
    for (let y = present[0]; y <= present[present.length - 1]; y++) {
      out.push({ year: String(y), ...(byYear.get(String(y)) ?? { play_count: 0, total_ms: 0 }) });
    }
    return present.length ? out : [];
  });

  // meses (Ene..Dic) del año dado, con cero donde no hay datos
  function monthsOf(year: string) {
    const byMonth = new Map<string, { play_count: number; total_ms: number }>();
    for (const d of series) {
      if (d.period.slice(0, 4) === year) byMonth.set(d.period.slice(5, 7), { play_count: d.play_count, total_ms: d.total_ms });
    }
    return MONTHS.map((label, i) => ({
      label,
      ...(byMonth.get(String(i + 1).padStart(2, '0')) ?? { play_count: 0, total_ms: 0 }),
    }));
  }

  // año en vista de meses: el que el usuario drilleó, o el único año si solo hay uno (sin volver)
  let effectiveYear = $derived(drillYear ?? (yearTotals.length === 1 ? yearTotals[0].year : null));
  let userDrilled = $derived(drillYear !== null);
  let chartInstance = $state<echarts.ECharts | null>(null);

  // claves canónicas (YYYY o YYYY-MM) de los buckets mostrados, para mapear eventos a ellos
  let periodKeys = $derived(effectiveYear
    ? MONTHS.map((_, i) => `${effectiveYear}-${String(i + 1).padStart(2, '0')}`)
    : yearTotals.map(y => y.year));

  let chartOption = $derived.by<EChartsOption>(() => {
    const isPlays = metric === 'plays';
    const durFmt = isPlays ? undefined : (v: number) => formatDuration(v);
    const pick = (o: { play_count: number; total_ms: number }) => (isPlays ? o.play_count : o.total_ms);

    let labels: string[];
    let values: number[];
    let names: string[];
    if (effectiveYear) {
      const months = monthsOf(effectiveYear);
      labels = months.map(m => m.label);
      values = months.map(pick);
      names = months.map(m => `${m.label} ${effectiveYear}`);
    } else {
      labels = yearTotals.map(y => y.year);
      values = yearTotals.map(pick);
      names = labels;
    }

    const markLine = eventsMarkLine(events, periodKeys);
    return {
      grid: GRID,
      tooltip: {
        ...TOOLTIP_BASE,
        formatter: (params: TooltipParams) => {
          const p = tooltipPoint(params);
          const val = isPlays ? `${p.value} plays` : formatDuration(p.value);
          return `${val}<br/><span style="color:#6a7a7a">${names[p.dataIndex] ?? p.name}</span>`;
        },
      },
      xAxis: categoryAxis(labels),
      yAxis: valueAxis({ axisLabel: { ...AXIS_LABEL, formatter: durFmt } }),
      // cursor pointer solo en vista de años (donde el click drillea)
      series: [barSeries(values, { cursor: effectiveYear ? 'default' : 'pointer', markLine })],
    };
  });

  function handleClick(params: ChartClickEvent) {
    if (effectiveYear) return; // ya en vista de meses
    if (params?.componentType !== 'series') return;
    const y = yearTotals[params.dataIndex]?.year;
    if (y) drillYear = y;
  }
</script>

{#if yearTotals.length > 0}
  <div class="card chart-card">
    {#if userDrilled}
      <div class="history-head">
        <button class="history-back" onclick={() => (drillYear = null)}>‹ all years</button>
      </div>
    {/if}
    <ReleaseRail instance={chartInstance} {events} periods={periodKeys} />
    <BaseChart option={chartOption} {height} onclick={handleClick} replaceMerge={['xAxis', 'series']} bind:instance={chartInstance} />
  </div>
{/if}

<style>
  .chart-card {
    margin-bottom: 1rem;
    padding: 0.75rem;
  }
  .history-head {
    display: flex;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .history-back {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 6px;
    padding: 0.1rem 0.5rem;
    font-size: 0.8rem;
    cursor: pointer;
    font-family: inherit;
  }
  .history-back:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }
</style>
