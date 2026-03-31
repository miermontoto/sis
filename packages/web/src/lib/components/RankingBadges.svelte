<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, createFetchController, getRankingMetric, type Rankings, type RankingHistoryPoint, type RankingMetric } from '$lib/api';
  import { medalColor } from '$lib/utils/medals';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import type { EChartsOption, ECharts } from 'echarts';

  let {
    entityType,
    entityId,
    highlightedMonth = $bindable(''),
  }: {
    entityType: 'artist' | 'track' | 'album';
    entityId: string;
    highlightedMonth?: string;
  } = $props();

  let rankings = $state<Rankings | null>(null);
  let rankingsLoading = $state(true);
  let history = $state<RankingHistoryPoint[]>([]);
  let historyLoading = $state(true);
  let chartInstance = $state<ECharts | null>(null);
  const fetchCtrl = createFetchController();

  const rankLabels = { week: '7D', month: '30D', thisYear: 'YTD', all: 'All' } as const;
  let chartType = $derived(entityType === 'artist' ? 'artists' : entityType === 'album' ? 'albums' : 'tracks');

  $effect(() => {
    void entityId;
    const signal = fetchCtrl.reset();
    rankingsLoading = true;
    historyLoading = true;
    rankings = null;
    history = [];
    const metric = getRankingMetric();

    api.rankings(entityType, entityId, metric, signal)
      .then(r => { if (!signal.aborted) { rankings = r; rankingsLoading = false; } })
      .catch(() => { if (!signal.aborted) { rankings = null; rankingsLoading = false; } });

    api.rankingHistory(entityType, entityId, metric, signal)
      .then(h => { if (!signal.aborted) { history = h; historyLoading = false; } })
      .catch(() => { if (!signal.aborted) { history = []; historyLoading = false; } });

    return () => fetchCtrl.abort();
  });

  function handleChartClick() {
    if (!highlightedMonth) return;
    goto(`/charts?type=${chartType}&granularity=month&period=${highlightedMonth}`);
  }

  function handleChartOut() {
    highlightedMonth = '';
  }

  // cuando ChartStats cambia el highlightedMonth, destacar el punto correspondiente
  $effect(() => {
    if (!chartInstance || history.length < 2) return;
    if (highlightedMonth) {
      const idx = history.findIndex(h => h.period === highlightedMonth);
      if (idx >= 0) {
        chartInstance.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx });
        return;
      }
    }
    chartInstance.dispatchAction({ type: 'hideTip' });
  });

  let chartOption = $derived.by<EChartsOption>(() => {
    if (history.length < 2) return {};
    return {
      grid: { left: 45, right: 20, top: 10, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const period = history[p.dataIndex]?.period;
          if (period && highlightedMonth !== period) highlightedMonth = period;
          return `${p.axisValue}<br/>#${p.value}`;
        },
      },
      xAxis: {
        type: 'category',
        data: history.map(d => d.period),
        axisLabel: { color: '#888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
      },
      yAxis: {
        type: 'log',
        inverse: true,
        min: 1,
        splitLine: { lineStyle: { color: '#2a2a2a' } },
        axisLabel: { color: '#888', formatter: (v: number) => `#${Math.round(v)}` },
      },
      series: [{
        type: 'line',
        data: history.map(d => d.rank),
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        cursor: 'pointer',
        lineStyle: { color: '#1db954', width: 2 },
        itemStyle: { color: '#1db954' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 1, x2: 0, y2: 0,
            colorStops: [
              { offset: 0, color: 'rgba(29, 185, 84, 0.3)' },
              { offset: 1, color: 'rgba(29, 185, 84, 0.02)' },
            ],
          },
        },
      }],
    };
  });
</script>

<div class="rankings-row">
  {#each Object.entries(rankLabels) as [key, label]}
    {@const rank = rankings?.[key as keyof Rankings] ?? null}
    <div class="ranking-badge" class:ranking-badge--active={rank != null} class:ranking-badge--loading={rankingsLoading}>
      <span class="ranking-label">{label}</span>
      <span class="ranking-value" style:color={rank ? medalColor(rank) : undefined}>{rankingsLoading ? '' : (rank != null ? `#${rank}` : '—')}</span>
    </div>
  {/each}
</div>

{#if historyLoading}
  <div class="chart-ghost">
    <div class="chart-ghost-inner"></div>
  </div>
{:else if history.length >= 2}
  <div class="chart-wrap">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div onmouseleave={handleChartOut} onclick={handleChartClick} onkeydown={(e) => { if (e.key === 'Enter') handleChartClick(e as any); }} role="button" tabindex="0" style="cursor: pointer;">
      <BaseChart
        option={chartOption}
        height="180px"
        bind:instance={chartInstance}
      />
    </div>
  </div>
{/if}

<style>
  .rankings-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .ranking-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    flex: 1;
    min-width: 60px;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    background: var(--bg-card);
    border: 1px solid #2a2a2a;
  }
  .ranking-badge--active {
    border-color: #1db954;
  }
  .ranking-badge--loading .ranking-value {
    width: 28px;
    height: 1.1rem;
    border-radius: 4px;
    background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    display: inline-block;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .ranking-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ranking-value {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
  }
  .ranking-badge--active .ranking-value {
    color: #1db954;
  }
  .chart-wrap {
    background: var(--bg-card);
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    padding: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .chart-ghost {
    background: var(--bg-card);
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    padding: 0.75rem;
    margin-bottom: 1.5rem;
    height: 180px;
    overflow: hidden;
  }
  .chart-ghost-inner {
    width: 100%;
    height: 100%;
    border-radius: 6px;
    background: linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
</style>
