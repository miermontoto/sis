<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import type { EntityType } from '$lib/api';
  import type { RankingCrossovers } from '@sis/shared';
  import type { EntityRanks } from '$lib/stores/entity-ranks.svelte';
  import { periodLabel } from '$lib/utils/periods';
  import { GRID, TOOLTIP_BASE, AXIS_LABEL, SPLIT_LINE, GREEN, categoryAxis, lineSeries, areaGradient, escapeHtml, tooltipPoint, type TooltipParams } from '$lib/utils/chart';
  import { timelineMonths, type TimelineBucket } from '$lib/utils/entity-timeline';
  import { linkMonthPointer, showMonthTip } from '$lib/utils/month-pointer';
  import BaseChart from './BaseChart.svelte';
  import type * as echarts from 'echarts/core';
  import type { EChartsOption } from 'echarts';

  // posición all-time acumulada mes a mes, con los cruces de cada mes (a quién adelantó
  // y quién la adelantó) en el tooltip. Va bajo los ranking badges, enlazada por mes con
  // la gráfica de actividad y con el chart run. Siempre mensual, sin agregar: los cruces
  // son de un mes, y en un trimestre sólo serían los del último
  let {
    entityType,
    ranks,
    highlightedMonth = $bindable(''),
  }: {
    entityType: EntityType;
    ranks: EntityRanks;
    highlightedMonth?: string;
  } = $props();

  const HEIGHT = '180px';
  // un eje log con el techo en #1 (siempre primero) degenera en una sola línea
  const RANK_AXIS_MIN_MAX = 10;
  // echarts escribe white-space:nowrap como estilo inline en el tooltip, y una regla
  // de clase no puede con un inline: el ancho máximo sí se aplicaba, pero el texto no
  // partía y los nombres largos se salían de la caja. extraCssText va al final de ese
  // mismo inline, así que aquí sí gana
  const XO_TOOLTIP_CSS = 'white-space:normal;max-width:300px;';
  const XO_LIMIT = 5; // máximo de entidades listadas por sentido

  let chartInstance = $state<echarts.ECharts | null>(null);
  let pointerIdx = $state(-1);
  let chartType = $derived(entityType === 'artist' ? 'artists' : entityType === 'album' ? 'albums' : 'tracks');

  // meses hasta el mes en curso, con la posición arrastrada por los meses sin historial:
  // el mismo eje que la gráfica de actividad, para que el enlace por mes case
  let months = $derived(timelineMonths({ series: [], rankHistory: ranks.history, now: new Date() }));
  let crossovers = $derived(new Map(ranks.history.flatMap(h => h.crossovers ? [[h.period, h.crossovers] as const] : [])));

  function crossoverRows(xo: RankingCrossovers): string {
    const row = (e: RankingCrossovers['surpassed'][number], arrow: string, cls: string) => {
      const img = e.imageUrl ? `<img class="xo-img" src="${escapeHtml(e.imageUrl)}"/>` : '';
      return `<div class="xo-row"><span class="${cls}">${arrow}</span>${img}<span class="xo-name">${escapeHtml(e.name)}</span></div>`;
    };
    const more = (n: number) => (n > XO_LIMIT ? `<div class="xo-more">+${n - XO_LIMIT} more</div>` : '');
    const rows = [
      ...xo.surpassed.slice(0, XO_LIMIT).map(e => row(e, '▲', 'xo-up')), more(xo.surpassed.length),
      ...xo.surpassedBy.slice(0, XO_LIMIT).map(e => row(e, '▼', 'xo-down')), more(xo.surpassedBy.length),
    ].join('');
    return rows ? `<div class="xo-sep"></div>${rows}` : '';
  }

  function tooltipHtml(m: TimelineBucket | undefined): string {
    if (!m) return '';
    const lines = [`<b>${escapeHtml(periodLabel(m.key, 'month'))}</b>`];
    if (m.rank != null) lines.push(`<b>#${m.rank}</b>`);
    const xo = crossovers.get(m.key);
    return lines.join('<br/>') + (xo ? crossoverRows(xo) : '');
  }

  let chartOption = $derived.by<EChartsOption>(() => {
    if (months.length < 2) return {};
    return {
      grid: { ...GRID },
      tooltip: { ...TOOLTIP_BASE, extraCssText: XO_TOOLTIP_CSS, formatter: (params: TooltipParams) => tooltipHtml(months[tooltipPoint(params)?.dataIndex ?? -1]) },
      xAxis: categoryAxis(months.map(m => m.key)),
      yAxis: {
        type: 'log',
        inverse: true,
        min: 1,
        max: ({ max }: { max: number }) => Math.max(RANK_AXIS_MIN_MAX, 10 ** Math.ceil(Math.log10(max))),
        splitLine: { ...SPLIT_LINE },
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => `#${Math.round(v)}` },
      },
      series: [
        lineSeries(months.map(m => m.rank), {
          symbol: 'circle',
          symbolSize: 4,
          cursor: 'pointer',
          // con el eje invertido el área va de la línea al #1: más intensa junto a la línea
          areaStyle: areaGradient(GREEN, 0.02, 0.3),
        }),
      ],
    };
  });

  $effect(() => {
    const chart = chartInstance;
    if (!chart) return;
    return linkMonthPointer(chart, {
      buckets: () => months,
      highlighted: () => highlightedMonth,
      setHighlighted: m => { highlightedMonth = m; },
      setPointer: i => { pointerIdx = i; },
      onClick: m => goto(`/charts?type=${chartType}&granularity=month&period=${m.key}`),
    });
  });

  $effect(() => {
    if (chartInstance) showMonthTip(chartInstance, months, highlightedMonth, untrack(() => pointerIdx), 0);
  });
</script>

{#if ranks.rankingsLoading}
  <div class="chart-ghost">
    <div class="chart-ghost-inner"></div>
  </div>
{:else if months.length >= 2}
  <div class="chart-wrap" class:clickable={pointerIdx >= 0}>
    <BaseChart option={chartOption} height={HEIGHT} bind:instance={chartInstance} />
  </div>
{/if}

<style>
  .chart-wrap {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
  }
  .chart-wrap.clickable {
    cursor: pointer;
  }
  .chart-ghost {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    height: 180px;
    overflow: hidden;
  }
  .chart-ghost-inner {
    width: 100%;
    height: 100%;
    border-radius: var(--radius);
    background: linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-placeholder) 50%, var(--bg-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
  /* el HTML del tooltip lo monta echarts fuera del árbol de svelte */
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
    color: var(--text-muted);
  }
  :global(.xo-up) {
    color: var(--accent);
  }
  :global(.xo-down) {
    color: var(--negative);
  }
  :global(.xo-sep) {
    margin-top: 5px;
  }
  :global(.xo-more) {
    font-size: 10px;
    color: var(--text-muted);
  }
  /* el nombre es el único hijo de la fila que cede: min-width 0 para que el flex lo deje
     encoger y partir en líneas, y anywhere por si un título sin espacios no cabe ni así */
  :global(.xo-name) {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
