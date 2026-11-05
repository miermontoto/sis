<script lang="ts">
  import { untrack } from 'svelte';
  import { canvasColors } from '$lib/stores/theme.svelte';
  import { GRID, TOOLTIP_BASE, SANS_STACK, categoryAxis, lineSeries, escapeHtml, tooltipPoint, truncateToWidth, type TooltipParams } from '$lib/utils/chart';
  import { bucketIndexOf, type TimelineBucket } from '$lib/utils/entity-timeline';
  import { linkMonthPointer, showMonthTip } from '$lib/utils/month-pointer';
  import { timelineKeyLabel } from '$lib/utils/periods';
  import { VERSUS_NO_VALUE } from '$lib/utils/artist-versus';
  import BaseChart from './BaseChart.svelte';
  import type * as echarts from 'echarts/core';
  import type { EChartsOption } from 'echarts';

  export interface VersusLine {
    name: string;
    values: (number | null)[];
  }

  // los dos artistas sobre un solo eje: dos escalas inventarían cruces que no existen. Las
  // dos gráficas de la comparación se enlazan por mes igual que las del detalle
  let {
    buckets,
    a,
    b,
    yAxis,
    format,
    marks = [],
    endLabels = true,
    highlightedMonth = $bindable(''),
  }: {
    buckets: TimelineBucket[];
    a: VersusLine;
    b: VersusLine;
    yAxis: NonNullable<EChartsOption['yAxis']>;
    format: (value: number) => string;
    // meses con una línea vertical: los adelantamientos
    marks?: string[];
    // nombre al final de cada línea: sólo sirve si las líneas acaban separadas. En escuchas
    // por periodo las dos suelen morir en cero, encima una de otra y de la etiqueta del eje
    endLabels?: boolean;
    highlightedMonth?: string;
  } = $props();

  const HEIGHT = '250px';
  // el nombre va al final de cada línea sólo si queda sitio para él y para la gráfica:
  // la leyenda de la cabecera identifica en cualquier ancho
  const END_LABEL_MIN_WIDTH_PX = 480;
  const END_LABEL_WIDTH_PX = 96;
  const END_LABEL_FONT_SIZE = 11;
  const END_LABEL_FONT = `${END_LABEL_FONT_SIZE}px ${SANS_STACK}`;
  const MARK_ALPHA = 0.35;

  let width = $state(0);
  let chartInstance = $state<echarts.ECharts | null>(null);
  let pointerIdx = $state(-1);

  let labelled = $derived(endLabels && width >= END_LABEL_MIN_WIDTH_PX);

  function tooltipHtml(idx: number): string {
    const bucket = buckets[idx];
    if (!bucket) return '';
    const { versusA, versusB } = canvasColors();
    const row = (line: VersusLine, color: string) => {
      const value = line.values[idx];
      return `<div class="vs-tip-row"><span class="vs-tip-key" style="background:${color}"></span><span class="vs-tip-name">${escapeHtml(line.name)}</span><b>${value == null ? VERSUS_NO_VALUE : escapeHtml(format(value))}</b></div>`;
    };
    return `<b>${escapeHtml(timelineKeyLabel(bucket.key))}</b>${row(a, versusA)}${row(b, versusB)}`;
  }

  let chartOption = $derived.by<EChartsOption>(() => {
    if (buckets.length < 2) return {};
    const { versusA, versusB, text, fg } = canvasColors();
    const marked = [...new Set(marks.map(m => bucketIndexOf(buckets, m)).filter(i => i >= 0))];
    const line = ({ name, values }: VersusLine, color: string) => lineSeries(values, {
      name,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      labelLayout: { moveOverlap: 'shiftY' as const },
      endLabel: {
        show: labelled,
        formatter: () => truncateToWidth(name, END_LABEL_FONT, END_LABEL_WIDTH_PX),
        color: text,
        fontSize: END_LABEL_FONT_SIZE,
        fontFamily: SANS_STACK,
      },
    });
    return {
      grid: { ...GRID, right: labelled ? END_LABEL_WIDTH_PX : GRID.right },
      tooltip: { ...TOOLTIP_BASE, formatter: (params: TooltipParams) => tooltipHtml(tooltipPoint(params)?.dataIndex ?? -1) },
      xAxis: categoryAxis(buckets.map(bucket => bucket.key)),
      yAxis,
      series: [
        {
          ...line(a, versusA),
          markLine: marked.length ? {
            silent: true,
            symbol: 'none',
            animation: false,
            label: { show: false },
            lineStyle: { color: `rgba(${fg},${MARK_ALPHA})`, type: 'dashed' as const, width: 1 },
            data: marked.map(xAxis => ({ xAxis })),
          } : undefined,
        },
        line(b, versusB),
      ],
    };
  });

  $effect(() => {
    const chart = chartInstance;
    if (!chart) return;
    return linkMonthPointer(chart, {
      buckets: () => buckets,
      highlighted: () => highlightedMonth,
      setHighlighted: m => { highlightedMonth = m; },
      setPointer: i => { pointerIdx = i; },
      onClick: () => {},
    });
  });

  $effect(() => {
    if (chartInstance) showMonthTip(chartInstance, buckets, highlightedMonth, untrack(() => pointerIdx), 0);
  });
</script>

<div bind:clientWidth={width}>
  <BaseChart option={chartOption} height={HEIGHT} replaceMerge={['xAxis', 'series']} bind:instance={chartInstance} />
</div>

<style>
  /* el HTML del tooltip lo monta echarts fuera del árbol de svelte */
  :global(.vs-tip-row) {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
    font-size: 11px;
  }
  :global(.vs-tip-key) {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  :global(.vs-tip-name) {
    flex: 1;
    margin-right: 10px;
  }
</style>
