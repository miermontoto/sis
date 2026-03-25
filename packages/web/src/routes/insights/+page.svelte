<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type HeatmapItem, type GenreItem, type StreaksData } from '$lib/api';
  import { getQueryParam, setQueryParams } from '$lib/utils/query-state';
  import TimeRangeSelector from '$lib/components/TimeRangeSelector.svelte';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { DAY_NAMES } from '$lib/utils/format';
  import type { EChartsOption } from 'echarts';

  let range = $state('month');
  let heatmap = $state<HeatmapItem[]>([]);
  let genres = $state<GenreItem[]>([]);
  let streaks = $state<StreaksData | null>(null);
  let loading = $state(true);

  async function loadData() {
    loading = true;
    try {
      [heatmap, genres, streaks] = await Promise.all([
        api.heatmap(range),
        api.topGenres(range, 10),
        api.streaks(),
      ]);
    } finally {
      loading = false;
    }
  }

  function setRange(r: string) {
    range = r;
    setQueryParams({ range: r });
  }

  onMount(() => {
    range = getQueryParam('range', 'month');
    loadData();
  });

  $effect(() => {
    void range;
    loadData();
  });

  let maxHeatmapValue = $derived(Math.max(...heatmap.map(h => h.play_count), 1));

  // opciones del heatmap echarts
  let heatmapOption = $derived<EChartsOption>({
    tooltip: {
      formatter: (params: any) => {
        const [hour, day] = params.value;
        return `${DAY_NAMES[day]} ${hour}:00<br/>Plays: <b>${params.value[2]}</b>`;
      },
    },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, i) => `${i}`),
      splitArea: { show: true },
      axisLabel: { color: '#888' },
      axisLine: { lineStyle: { color: '#2a2a2a' } },
    },
    yAxis: {
      type: 'category',
      data: DAY_NAMES,
      splitArea: { show: true },
      axisLabel: { color: '#888' },
      axisLine: { lineStyle: { color: '#2a2a2a' } },
    },
    visualMap: {
      min: 0,
      max: maxHeatmapValue,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: -5,
      show: false,
      inRange: {
        color: ['#141414', '#0d3320', '#1a6b3f', '#1db954'],
      },
    },
    series: [{
      type: 'heatmap',
      data: heatmap.map(h => [h.hour, h.day_of_week, h.play_count]),
      emphasis: {
        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' },
      },
      itemStyle: { borderRadius: 3 },
    }],
  });

  // opciones del pie chart de géneros
  let pieOption = $derived<EChartsOption>({
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
    },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderRadius: 6,
        borderColor: '#141414',
        borderWidth: 2,
      },
      label: {
        color: '#888',
        fontSize: 12,
      },
      data: genres.map((g, i) => ({
        name: g.genre,
        value: g.play_count,
        itemStyle: {
          color: [
            '#1db954', '#1ed760', '#2ecc71', '#27ae60',
            '#16a085', '#1abc9c', '#3498db', '#2980b9',
            '#9b59b6', '#8e44ad',
          ][i % 10],
        },
      })),
    }],
  });

  // opciones del radar chart de géneros (top 6)
  let radarOption = $derived<EChartsOption>({
    radar: {
      indicator: genres.slice(0, 6).map(g => ({
        name: g.genre,
        max: Math.max(...genres.slice(0, 6).map(g2 => g2.play_count), 1),
      })),
      axisName: { color: '#888', fontSize: 11 },
      splitLine: { lineStyle: { color: '#2a2a2a' } },
      splitArea: { areaStyle: { color: ['transparent'] } },
      axisLine: { lineStyle: { color: '#2a2a2a' } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: genres.slice(0, 6).map(g => g.play_count),
        areaStyle: { color: 'rgba(29, 185, 84, 0.2)' },
        lineStyle: { color: '#1db954' },
        itemStyle: { color: '#1db954' },
      }],
    }],
  });
</script>

<div class="page-header">
  <h1>Insights</h1>
  <p>Patterns and habits in your listening</p>
</div>

<TimeRangeSelector value={range} onchange={setRange} />

{#if loading}
  <div class="loading">
    <div class="spinner"></div>
  </div>
{:else}
  {#if streaks}
    <div class="stats-grid" style="margin-bottom: 1.5rem;">
      <div class="card stat-card">
        <div class="stat-value">{streaks.currentStreak}</div>
        <div class="stat-label">Current streak (days)</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{streaks.longestStreak}</div>
        <div class="stat-label">Longest streak</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">{streaks.totalDays}</div>
        <div class="stat-label">Active days</div>
      </div>
    </div>
  {/if}

  {#if heatmap.length > 0}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 0.5rem;">Listening heatmap</h3>
      <BaseChart option={heatmapOption} height="240px" />
    </div>
  {/if}

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
    {#if genres.length > 0}
      <div class="card">
        <h3 style="margin-bottom: 0.5rem;">Genre distribution</h3>
        <BaseChart option={pieOption} height="300px" />
      </div>

      {#if genres.length >= 3}
        <div class="card">
          <h3 style="margin-bottom: 0.5rem;">Genre radar</h3>
          <BaseChart option={radarOption} height="300px" />
        </div>
      {/if}
    {/if}
  </div>
{/if}
