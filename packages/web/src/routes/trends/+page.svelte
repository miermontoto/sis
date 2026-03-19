<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type ListeningTimeItem, type GenreItem } from '$lib/api';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { formatHours } from '$lib/utils/format';
  import type { EChartsOption } from 'echarts';

  let range = $state('month');
  let data = $state<ListeningTimeItem[]>([]);
  let genres = $state<GenreItem[]>([]);
  let loading = $state(true);

  // granularidad según rango: día para cortos, semana/mes para largos
  function granularityForRange(r: string): string {
    if (r === 'week') return 'day';
    if (r === 'month') return 'day';
    if (r === '3months') return 'week';
    if (r === '6months') return 'week';
    return 'month'; // year, thisYear, all
  }

  async function loadData() {
    loading = true;
    try {
      [data, genres] = await Promise.all([
        api.listeningTime(range, granularityForRange(range)),
        api.topGenres(range, 8),
      ]);
    } finally {
      loading = false;
    }
  }

  onMount(loadData);

  $effect(() => {
    void range;
    loadData();
  });

  let totalMs = $derived(data.reduce((sum, d) => sum + d.total_ms, 0));
  let totalPlays = $derived(data.reduce((sum, d) => sum + d.play_count, 0));
  let avgDailyMs = $derived(data.length > 0 ? totalMs / data.length : 0);

  // opciones del line chart de tiempo de escucha diario
  let lineChartOption = $derived<EChartsOption>({
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        return `${p.axisValue}<br/>Plays: <b>${p.value}</b>`;
      },
    },
    xAxis: {
      type: 'category',
      data: data.map(d => d.period),
      axisLabel: {
        color: '#888',
        rotate: data.length > 14 ? 45 : 0,
        formatter: (v: string) => v.length > 5 ? v.slice(5) : v,
      },
      axisLine: { lineStyle: { color: '#2a2a2a' } },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#2a2a2a' } },
      axisLabel: { color: '#888' },
    },
    series: [{
      type: 'line',
      data: data.map(d => d.play_count),
      smooth: true,
      symbol: 'none',
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(29, 185, 84, 0.4)' },
            { offset: 1, color: 'rgba(29, 185, 84, 0.02)' },
          ],
        },
      },
      lineStyle: { color: '#1db954', width: 2 },
      itemStyle: { color: '#1db954' },
    }],
  });

  // opciones del bar chart de duración
  let barChartOption = $derived<EChartsOption>({
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const hours = (p.value / 3_600_000).toFixed(1);
        return `${p.axisValue}<br/>Listening: <b>${hours}h</b>`;
      },
    },
    xAxis: {
      type: 'category',
      data: data.map(d => d.period),
      axisLabel: {
        color: '#888',
        rotate: data.length > 14 ? 45 : 0,
        formatter: (v: string) => v.length > 5 ? v.slice(5) : v,
      },
      axisLine: { lineStyle: { color: '#2a2a2a' } },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#2a2a2a' } },
      axisLabel: {
        color: '#888',
        formatter: (v: number) => `${(v / 3_600_000).toFixed(0)}h`,
      },
    },
    series: [{
      type: 'bar',
      data: data.map(d => d.total_ms),
      itemStyle: {
        color: '#1db954',
        borderRadius: [3, 3, 0, 0],
      },
      barMaxWidth: 30,
    }],
  });
</script>

<div class="page-header">
  <h1>Trends</h1>
  <p>Your listening patterns over time</p>
</div>

<TimeRangeSelector value={range} onchange={(r) => range = r} />

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
  <div class="stats-grid" style="margin-bottom: 1.5rem;">
    <div class="card stat-card">
      <div class="stat-value">{formatHours(totalMs)}</div>
      <div class="stat-label">Total listening</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{totalPlays}</div>
      <div class="stat-label">Total plays</div>
    </div>
    <div class="card stat-card">
      <div class="stat-value">{formatHours(avgDailyMs)}</div>
      <div class="stat-label">Daily average</div>
    </div>
  </div>

  {#if data.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.5rem;">Daily plays</h3>
      <BaseChart option={lineChartOption} height="280px" />
    </div>

    <div class="card">
      <h3 style="margin-bottom: 0.5rem;">Daily listening time</h3>
      <BaseChart option={barChartOption} height="280px" />
    </div>
  {:else}
    <div class="card empty-state">No data for this period.</div>
  {/if}
{/if}
