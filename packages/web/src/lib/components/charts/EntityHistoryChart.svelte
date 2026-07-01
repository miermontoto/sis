<script lang="ts">
  import { formatDuration } from '$lib/utils/format';
  import { GRID, TOOLTIP_BASE, AXIS_LABEL, categoryAxis, valueAxis, barSeries } from '$lib/utils/chart';
  import BaseChart from './BaseChart.svelte';
  import type { EChartsOption } from 'echarts';
  import type { RankingMetric } from '$lib/api';

  // gráfica de barras estilo last.fm con drill-down: arranca en años y, al pinchar un año,
  // baja a sus meses. espera la serie mensual all-time (period = 'YYYY-MM') que las páginas de
  // detalle ya cargan (range='all'); toda la agregación año/mes es en cliente (sin refetch).
  let {
    series,
    metric,
    height = '250px',
  }: {
    series: { period: string; play_count: number; total_ms: number }[];
    metric: RankingMetric;
    height?: string;
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

    return {
      grid: GRID,
      tooltip: {
        ...TOOLTIP_BASE,
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const val = isPlays ? `${p.value} plays` : formatDuration(p.value);
          return `${val}<br/><span style="color:#6a7a7a">${names[p.dataIndex] ?? p.name}</span>`;
        },
      },
      xAxis: categoryAxis(labels),
      yAxis: valueAxis({ axisLabel: { ...AXIS_LABEL, formatter: durFmt } }),
      // cursor pointer solo en vista de años (donde el click drillea)
      series: [barSeries(values, { cursor: effectiveYear ? 'default' : 'pointer' })],
    };
  });

  function handleClick(params: any) {
    if (effectiveYear) return; // ya en vista de meses
    if (params?.componentType !== 'series') return;
    const y = yearTotals[params.dataIndex]?.year;
    if (y) drillYear = y;
  }
</script>

{#if yearTotals.length > 0}
  <div class="card chart-card">
    <div class="history-head">
      {#if userDrilled}
        <button class="history-back" onclick={() => (drillYear = null)}>‹ all years</button>
      {/if}
      <span class="history-label">{effectiveYear ?? 'By year — click to drill in'}</span>
    </div>
    <BaseChart option={chartOption} {height} onclick={handleClick} replaceMerge={['xAxis', 'series']} />
  </div>
{/if}

<style>
  .chart-card {
    margin-bottom: 1.5rem;
    padding: 1rem;
  }
  .history-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
    min-height: 1.6rem;
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
  .history-label {
    color: var(--text-muted);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
</style>
