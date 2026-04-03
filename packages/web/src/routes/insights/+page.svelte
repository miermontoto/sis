<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type ListeningTimeItem, type HeatmapItem, type GenreItem, type StreaksData, type DateRangeParams } from '$lib/api';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { formatHours, DAY_NAMES } from '$lib/utils/format';
  import type { EChartsOption } from 'echarts';

  let range = $state('all');
  let startDate = $state('');
  let endDate = $state('');
  let listeningData = $state<ListeningTimeItem[]>([]);
  let heatmap = $state<HeatmapItem[]>([]);
  let genres = $state<GenreItem[]>([]);
  let streaks = $state<StreaksData | null>(null);
  let loading = $state(true);

  function granularityForRange(r: string): string {
    if (r === 'custom' && startDate && endDate) {
      const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 30) return 'day';
      if (days <= 180) return 'week';
      return 'month';
    }
    if (r === 'week' || r === 'month') return 'day';
    if (r === '3months' || r === '6months') return 'week';
    return 'month';
  }

  function getCustomDates(): DateRangeParams | undefined {
    if (range === 'custom' && startDate && endDate) return { startDate, endDate };
    return undefined;
  }

  async function loadData() {
    loading = true;
    try {
      const dates = getCustomDates();
      [listeningData, heatmap, genres, streaks] = await Promise.all([
        api.listeningTime(range, granularityForRange(range), dates),
        api.heatmap(range, dates),
        api.topGenres(range, 10, dates),
        api.streaks(),
      ]);
    } finally {
      loading = false;
    }
  }

  function setRange(r: string) {
    range = r;
    if (r !== 'custom') {
      startDate = '';
      endDate = '';
      setQueryParams({ range: r, startDate: null, endDate: null });
    } else {
      if (!startDate || !endDate) {
        const now = new Date();
        endDate = now.toISOString().split('T')[0];
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        startDate = start.toISOString().split('T')[0];
      }
      setQueryParams({ range: r, startDate, endDate });
    }
  }

  function setCustomDates(s: string, e: string) {
    startDate = s;
    endDate = e;
    setQueryParams({ startDate: s, endDate: e });
  }

  let initialized = false;

  onMount(() => {
    range = getQueryParam('range', 'all');
    startDate = getQueryParam('startDate', '');
    endDate = getQueryParam('endDate', '');
    initialized = true;
  });

  $effect(() => {
    void range;
    void startDate;
    void endDate;
    if (initialized) loadData();
  });

  let totalMs = $derived(listeningData.reduce((s, d) => s + d.total_ms, 0));
  let totalPlays = $derived(listeningData.reduce((s, d) => s + d.play_count, 0));
  let dayCount = $derived.by(() => {
    if (listeningData.length === 0) return 1;
    const first = listeningData[0].period;
    const last = listeningData[listeningData.length - 1].period;
    const gran = granularityForRange(range);
    if (gran === 'day') return listeningData.length;
    // para week/month, calcular días reales entre primer y último periodo
    const start = new Date(first + (first.length <= 7 ? '-01' : ''));
    const end = new Date(last + (last.length <= 7 ? '-01' : ''));
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + (gran === 'month' ? 30 : 7));
    return days;
  });
  let avgDailyMs = $derived(listeningData.length > 0 ? totalMs / dayCount : 0);
  let maxHeatmapValue = $derived(Math.max(...heatmap.map(h => h.play_count), 1));

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
      type: 'category', data: listeningData.map(d => d.period),
      axisLabel: { color: '#888', rotate: listeningData.length > 14 ? 45 : 0, formatter: (v: string) => v.length > 5 ? v.slice(5) : v },
      axisLine: { lineStyle: { color: '#2a2a2a' } },
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#2a2a2a' } }, axisLabel: { color: '#888' } },
    series: [{
      type: 'line', data: listeningData.map(d => d.play_count), smooth: true, symbol: 'none',
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(29, 185, 84, 0.4)' }, { offset: 1, color: 'rgba(29, 185, 84, 0.02)' }] } },
      lineStyle: { color: '#1db954', width: 2 }, itemStyle: { color: '#1db954' },
    }],
  });

  let barChartOption = $derived<EChartsOption>({
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => { const p = Array.isArray(params) ? params[0] : params; return `${p.axisValue}<br/>Listening: <b>${(p.value / 3_600_000).toFixed(1)}h</b>`; },
    },
    xAxis: {
      type: 'category', data: listeningData.map(d => d.period),
      axisLabel: { color: '#888', rotate: listeningData.length > 14 ? 45 : 0, formatter: (v: string) => v.length > 5 ? v.slice(5) : v },
      axisLine: { lineStyle: { color: '#2a2a2a' } },
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#2a2a2a' } }, axisLabel: { color: '#888', formatter: (v: number) => `${(v / 3_600_000).toFixed(0)}h` } },
    series: [{ type: 'bar', data: listeningData.map(d => d.total_ms), itemStyle: { color: '#1db954', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 30 }],
  });

  let heatmapOption = $derived<EChartsOption>({
    tooltip: { formatter: (params: any) => { const [hour, day] = params.value; return `${DAY_NAMES[day]} ${hour}:00<br/>Plays: <b>${params.value[2]}</b>`; } },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, i) => `${i}`), splitArea: { show: true }, axisLabel: { color: '#888' }, axisLine: { lineStyle: { color: '#2a2a2a' } } },
    yAxis: { type: 'category', data: DAY_NAMES, splitArea: { show: true }, axisLabel: { color: '#888' }, axisLine: { lineStyle: { color: '#2a2a2a' } } },
    visualMap: { min: 0, max: maxHeatmapValue, show: false, inRange: { color: ['#141414', '#0d3320', '#1a6b3f', '#1db954'] } },
    series: [{ type: 'heatmap', data: heatmap.map(h => [h.hour, h.day_of_week, h.play_count]), emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } }, itemStyle: { borderRadius: 3 } }],
  });

  let pieOption = $derived<EChartsOption>({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [{
      type: 'pie', radius: ['40%', '70%'], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#141414', borderWidth: 2 },
      label: { color: '#888', fontSize: 12 },
      data: genres.map((g, i) => ({ name: g.genre, value: g.play_count, itemStyle: { color: ['#1db954', '#1ed760', '#2ecc71', '#27ae60', '#16a085', '#1abc9c', '#3498db', '#2980b9', '#9b59b6', '#8e44ad'][i % 10] } })),
    }],
  });
</script>

<div class="page-header">
  <h1>Insights</h1>
  <p>Listening patterns and habits</p>
</div>

<TimeRangeSelector value={range} onchange={setRange} {startDate} {endDate} ondatechange={setCustomDates} />

{#if loading}
  <div class="loading"><div class="spinner"></div></div>
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
    {#if streaks}
      <div class="card stat-card">
        <div class="stat-value">{streaks.currentStreak}</div>
        <div class="stat-label">Current streak</div>
      </div>
    {/if}
  </div>

  {#if listeningData.length > 0}
    <div class="charts-row">
      <div class="card chart-half">
        <h3>Plays</h3>
        <BaseChart option={lineChartOption} height="220px" />
      </div>
      <div class="card chart-half">
        <h3>Listening time</h3>
        <BaseChart option={barChartOption} height="220px" />
      </div>
    </div>
  {/if}

  {#if heatmap.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.5rem;">Listening heatmap</h3>
      <BaseChart option={heatmapOption} height="220px" />
    </div>
  {/if}

  {#if genres.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.5rem;">Genre distribution</h3>
      <BaseChart option={pieOption} height="280px" />
    </div>
  {/if}
{/if}

<style>
  .charts-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .chart-half h3 {
    margin-bottom: 0.5rem;
  }
  @media (max-width: 768px) {
    .charts-row {
      grid-template-columns: 1fr;
    }
  }
</style>
