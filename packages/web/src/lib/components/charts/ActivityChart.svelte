<script lang="ts">
  import { formatDuration } from '$lib/utils/format';
  import { dualAxisGrid, TOOLTIP_BASE, AXIS_LABEL, categoryAxis, valueAxis, secondaryValueAxis, barSeries, cumulativeLineSeries, fitSeries, eventsMarkLine, type ChartEvent, tooltipPoints, type TooltipParams } from '$lib/utils/chart';
  import BaseChart from './BaseChart.svelte';
  import ReleaseRail from './ReleaseRail.svelte';
  import type * as echarts from 'echarts/core';
  import type { EChartsOption } from 'echarts';
  import type { RankingMetric } from '$lib/api';

  let {
    series,
    metric,
    height = '250px',
    events = [],
  }: {
    series: { period: string; play_count: number; total_ms: number }[];
    metric: RankingMetric;
    height?: string;
    events?: ChartEvent[];
  } = $props();

  // ancho medido de la card: la granularidad se adapta a él (ver fitSeries)
  let containerWidth = $state(0);
  let chartInstance = $state<echarts.ECharts | null>(null);

  function fillGaps(data: typeof series): typeof series {
    if (data.length < 2) return data;
    const first = data[0].period;
    const last = data[data.length - 1].period;
    const byPeriod = new Map(data.map(d => [d.period, d]));
    const filled: typeof series = [];

    if (/^\d{4}-\d{2}$/.test(first)) {
      let [y, m] = first.split('-').map(Number);
      const [ey, em] = last.split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        filled.push(byPeriod.get(key) ?? { period: key, play_count: 0, total_ms: 0 });
        if (++m > 12) { m = 1; y++; }
      }
    } else if (/^\d{4}-W\d{2}$/.test(first)) {
      const toNum = (p: string) => { const [y, w] = p.split('-W').map(Number); return y * 100 + w; };
      const nextWeek = (y: number, w: number): [number, number] => {
        const d = new Date(y, 0, 1 + (w - 1) * 7 + 8);
        const jan1 = new Date(d.getFullYear(), 0, 1);
        const nw = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay()) / 7);
        return [d.getFullYear(), nw];
      };
      let [y, w] = first.split('-W').map(Number);
      const end = toNum(last);
      while (toNum(`${y}-W${String(w).padStart(2, '0')}`) <= end) {
        const key = `${y}-W${String(w).padStart(2, '0')}`;
        filled.push(byPeriod.get(key) ?? { period: key, play_count: 0, total_ms: 0 });
        [y, w] = nextWeek(y, w);
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(first)) {
      const d = new Date(first);
      const end = new Date(last);
      while (d <= end) {
        const key = d.toISOString().slice(0, 10);
        filled.push(byPeriod.get(key) ?? { period: key, play_count: 0, total_ms: 0 });
        d.setDate(d.getDate() + 1);
      }
    } else {
      return data;
    }
    return filled;
  }

  // rellenar huecos a la granularidad nativa y luego agregar al ancho disponible
  let filled = $derived(fitSeries(fillGaps(series), containerWidth));
  let periodKeys = $derived(filled.map(d => d.period));

  let chartOption = $derived.by<EChartsOption>(() => {
    if (!series.length) return {};
    const isPlays = metric === 'plays';
    const values = filled.map(d => isPlays ? d.play_count : d.total_ms);
    let acc = 0;
    const cumulative = values.map(v => acc += v);
    const durFmt = isPlays ? undefined : (v: number) => formatDuration(v);
    const markLine = eventsMarkLine(events, periodKeys);
    return {
      grid: dualAxisGrid(),
      tooltip: { ...TOOLTIP_BASE, formatter: (params: TooltipParams) => { const pp = tooltipPoints(params); return pp.map(p => { const label = p.seriesIndex === 0 ? '' : 'Total: '; return isPlays ? `${label}${p.value} plays` : `${label}${formatDuration(p.value)}`; }).join('<br/>') + `<br/><span style="color:#6a7a7a">${pp[0].name}</span>`; } },
      xAxis: categoryAxis(periodKeys),
      yAxis: [
        valueAxis({ axisLabel: { ...AXIS_LABEL, formatter: durFmt } }),
        secondaryValueAxis({ axisLabel: { color: '#4a5a5a', fontSize: 11, formatter: durFmt } }),
      ],
      series: [
        barSeries(values, { markLine }),
        cumulativeLineSeries(cumulative),
      ],
    };
  });
</script>

{#if series.length > 1}
  <div class="card chart-card" bind:clientWidth={containerWidth}>
    <ReleaseRail instance={chartInstance} {events} periods={periodKeys} />
    <BaseChart option={chartOption} {height} bind:instance={chartInstance} />
  </div>
{/if}

<style>
  .chart-card {
    margin-bottom: 1.5rem;
    padding: 1rem;
  }
</style>
