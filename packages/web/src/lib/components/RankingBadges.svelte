<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, createFetchController, getRankingMetric, type Rankings, type RankingHistoryPointWithCrossovers, type RankingMetric, type EntityType } from '$lib/api';
  import { medalColor } from '$lib/utils/medals';
  import { periodLabel } from '$lib/utils/periods';
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
  let history = $state<RankingHistoryPointWithCrossovers[]>([]);
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

  // pico histórico: mejor posición all-time alcanzada nunca. el historial ya es el ranking
  // acumulado mes a mes, así que el pico sale de ahí sin query ni endpoint extra.
  let allTimePeak = $derived.by(() => {
    if (history.length === 0) return null;
    let best = history[0];
    for (const p of history) if (p.rank < best.rank) best = p;
    return best;
  });

  let allTimePeakTitle = $derived(
    allTimePeak ? `All-time peak: #${allTimePeak.rank} (${periodLabel(allTimePeak.period, 'month')})` : undefined
  );

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
        className: 'xo-tooltip',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const point = history[p.dataIndex];
          if (!point) return '';
          if (point.period && highlightedMonth !== point.period) highlightedMonth = point.period;
          let html = `${p.axisValue}<br/><b>#${p.value}</b>`;
          if (point.crossovers) {
            const { surpassedBy, surpassed } = point.crossovers;
            const renderEntity = (e: typeof surpassedBy[0], arrow: string, cls: string) => {
              const img = e.imageUrl ? `<img class="xo-img" src="${e.imageUrl}"/>` : '';
              return `<div class="xo-row"><span class="${cls}">${arrow}</span>${img}<span>${e.name}</span></div>`;
            };
            if (surpassedBy.length > 0 || surpassed.length > 0) html += `<div class="xo-sep"></div>`;
            for (const e of surpassed.slice(0, 5)) html += renderEntity(e, '▲', 'xo-up');
            if (surpassed.length > 5) html += `<div class="xo-more">+${surpassed.length - 5} más</div>`;
            for (const e of surpassedBy.slice(0, 5)) html += renderEntity(e, '▼', 'xo-down');
            if (surpassedBy.length > 5) html += `<div class="xo-more">+${surpassedBy.length - 5} más</div>`;
          }
          return html;
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
    <!-- el pico all-time vive dentro del badge "All": misma métrica, mejor posición alcanzada.
         solo se muestra si mejora la actual (si coincide, la entidad está en su pico ahora) -->
    {@const peak = key === 'all' && rank != null && allTimePeak != null && allTimePeak.rank < rank ? allTimePeak : null}
    {#if rank != null}
      <a
        class="ranking-badge ranking-badge--active ranking-badge--link"
        class:ranking-badge--top3={rank <= 3}
        style:border-color={color}
        style:--medal-color={color}
        href="/top?tab={chartType}&range={key}&focus={entityId}"
        title={key === 'all' ? allTimePeakTitle : undefined}
        onmouseenter={() => { if (peak) highlightedMonth = peak.period; }}
        onmouseleave={() => { if (peak) highlightedMonth = ''; }}
      >
        <span class="ranking-label">{label}</span>
        <span class="ranking-value" style:color={color}>#{rank}{#if peak}<span class="ranking-peak" style:color={medalColor(peak.rank)}>▲#{peak.rank}</span>{/if}</span>
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
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }
  .rankings-row:last-child {
    margin-bottom: 1.5rem;
  }
  .ranking-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    flex: 1;
    min-width: 60px;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    background: var(--bg-card);
    border: 1px solid var(--border);
    text-decoration: none;
    color: inherit;
    transition: background 0.05s, border-color 0.05s, transform 0.05s;
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
    border-radius: var(--radius);
    background: linear-gradient(90deg, #1e2a2a 25%, #253030 50%, #1e2a2a 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    display: inline-block;
  }
  .ranking-label {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ranking-value {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--accent);
  }
  .ranking-badge--active .ranking-value {
    color: #1db954;
  }
  .ranking-peak {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-left: 0.25em;
  }
  .chart-wrap {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    margin-bottom: 1.5rem;
  }
  .chart-ghost {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    margin-bottom: 1.5rem;
    height: 180px;
    overflow: hidden;
  }
  .chart-ghost-inner {
    width: 100%;
    height: 100%;
    border-radius: var(--radius);
    background: linear-gradient(90deg, #161a1d 25%, #1e2a2a 50%, #161a1d 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
  :global(.xo-row) {
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 3px;
  }
  :global(.xo-img) {
    width: 18px;
    height: 18px;
    border-radius: 3px;
    object-fit: cover;
  }
  :global(.xo-artist) {
    color: #6a7a7a;
  }
  :global(.xo-up) {
    color: #1db954;
  }
  :global(.xo-down) {
    color: #ff6b6b;
  }
  :global(.xo-sep) {
    margin-top: 5px;
  }
  :global(.xo-more) {
    font-size: 10px;
    color: #6a7a7a;
  }
  :global(.xo-tooltip) {
    max-width: 300px;
    white-space: normal;
  }
</style>
