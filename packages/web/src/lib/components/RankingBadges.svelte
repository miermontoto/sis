<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, createFetchController, getRankingMetric, type Rankings, type RankingHistoryPoint, type RankingMetric, type EntityType } from '$lib/api';
  import { medalColor } from '$lib/utils/medals';
  import { GRID, TOOLTIP_BASE, categoryAxis, SPLIT_LINE, AXIS_LABEL, lineSeries } from '$lib/utils/chart';
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import type { EChartsOption, ECharts } from 'echarts';

  let {
    entityType,
    entityId,
    highlightedMonth = $bindable(''),
  }: {
    entityType: EntityType;
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
      grid: { ...GRID },
      tooltip: {
        ...TOOLTIP_BASE,
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const period = history[p.dataIndex]?.period;
          if (period && highlightedMonth !== period) highlightedMonth = period;
          return `${p.axisValue}<br/>#${p.value}`;
        },
      },
      xAxis: categoryAxis(history.map(d => d.period)),
      yAxis: {
        type: 'log',
        inverse: true,
        min: 1,
        splitLine: { ...SPLIT_LINE },
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => `#${Math.round(v)}` },
      },
      series: [lineSeries(history.map(d => d.rank), {
        symbol: 'circle',
        symbolSize: 4,
        cursor: 'pointer',
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
      })],
    };
  });
</script>

<div class="rankings-row">
  {#each Object.entries(rankLabels) as [key, label]}
    {@const rank = rankings?.[key as keyof Rankings] ?? null}
    {@const color = rank ? medalColor(rank) : undefined}
    {#if rank != null}
      <a
        class="ranking-badge ranking-badge--active ranking-badge--link"
        class:ranking-badge--top3={rank <= 3}
        style:border-color={color}
        style:--medal-color={color}
        href="/top?tab={chartType}&range={key}&focus={entityId}"
      >
        <span class="ranking-label">{label}</span>
        <span class="ranking-value" style:color={color}>#{rank}</span>
      </a>
    {:else}
      <div class="ranking-badge" class:ranking-badge--loading={rankingsLoading}>
        <span class="ranking-label">{label}</span>
        <span class="ranking-value">{rankingsLoading ? '' : '—'}</span>
      </div>
    {/if}
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
    text-decoration: none;
    color: inherit;
    transition: background 0.15s, border-color 0.15s, transform 0.15s;
  }
  .ranking-badge--active {
    border-color: #1db954;
  }
  .ranking-badge--link {
    cursor: pointer;
  }
  .ranking-badge--link:hover {
    background: rgba(29, 185, 84, 0.06);
  }
  .ranking-badge--top3:hover {
    background: color-mix(in srgb, var(--medal-color, #1db954) 10%, var(--bg-card));
  }
  .ranking-badge--link:active {
    transform: translateY(1px);
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
