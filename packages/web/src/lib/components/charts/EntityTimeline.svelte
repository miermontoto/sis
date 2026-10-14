<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { getLocale, getWeekStart, type EntityType, type RankingMetric } from '$lib/api';
  import type { RankingCrossovers } from '@sis/shared';
  import type { EntityRanks } from '$lib/stores/entity-ranks.svelte';
  import { canvasColors } from '$lib/stores/theme.svelte';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import { periodLabel } from '$lib/utils/periods';
  import {
    TOOLTIP_BASE, AXIS_LABEL, SPLIT_LINE, MONO_STACK, GREEN, categoryAxis, valueAxis, secondaryValueAxis, barSeries, lineSeries,
    cumulativeLineSeries, areaGradient, eventsMarkLine, groupEventsByBucket, measureTextWidth, niceAxisMax, escapeHtml, tooltipPoint,
    type ChartEvent, type TooltipParams,
  } from '$lib/utils/chart';
  import { timelineMonths, fitTimeline, bucketIndexOf, isMonthBucket, type TimelineBucket, type TimelineGranularity } from '$lib/utils/entity-timeline';
  import BaseChart from './BaseChart.svelte';
  import ReleaseRail from './ReleaseRail.svelte';
  import type * as echarts from 'echarts/core';
  import type { EChartsOption } from 'echarts';

  // la historia de una entidad en UNA gráfica: arriba su posición (ranking all-time
  // acumulado + mejor semana en los charts), abajo sus escuchas por periodo y el
  // acumulado. Dos paneles con el mismo eje x y un solo puntero, porque tres escalas
  // en un panel no se leen: el acumulado y el ranking invertido suben juntos y se
  // enredan. Sustituye a la gráfica de actividad, a la línea de los ranking badges y
  // a la vista por años del rail (que es el modo "year", con el mismo drill-down)
  let {
    entityType,
    series,
    metric,
    events = [],
    ranks,
    highlightedMonth = $bindable(''),
  }: {
    entityType: EntityType;
    series: { period: string; play_count: number; total_ms: number }[];
    metric: RankingMetric;
    events?: ChartEvent[];
    // null = esta entidad no rankea (un alias, un miembro de colección): sin panel de ranking
    ranks: EntityRanks | null;
    highlightedMonth?: string;
  } = $props();

  // alturas fijas en px: los dos paneles tienen que medir lo mismo pase lo que pase con
  // el ranking (llega después que la serie) y el carril de portadas se ancla a su eje
  const TOP_PAD_PX = 8;
  const RANK_PLOT_PX = 96;
  const PANEL_GAP_PX = 18;
  const ACTIVITY_PLOT_PX = 170;
  const PLAIN_PLOT_PX = 218;
  const X_LABEL_PX = 24;
  // separación por defecto de echarts entre el eje y sus etiquetas, más holgura
  const AXIS_LABEL_MARGIN_PX = 8;
  const LABEL_SLACK_PX = 4;
  // techo del eje de ranking mientras no hay datos: reserva el ancho de su etiqueta más
  // ancha en el caso común ("#10": la página de algo que escuchas mucho) para que las
  // barras no se desplacen al llegar el ranking
  const RANK_AXIS_PLACEHOLDER = 100;
  const RANK_AXIS_MIN_MAX = 10;
  // los ejes de tiempo se pintan en la unidad de su etiqueta: en ms, echarts elegía
  // ticks redondos en ms y salían "16.667 min". Desde 10h el eje pasa a horas
  const MINUTE_MS = 60_000;
  const HOUR_MS = 3_600_000;
  const HOUR_AXIS_FROM_MS = 10 * HOUR_MS;
  // por debajo de este ancho de card el eje del acumulado pierde sus etiquetas (la
  // línea sigue, y su cifra va en el tooltip): las dos columnas de etiquetas dejaban
  // la gráfica en menos de la mitad de un móvil
  const NARROW_CARD_PX = 480;
  const XO_TOOLTIP_CSS = 'white-space:normal;max-width:300px;';
  const XO_LIMIT = 5;
  const GRANULARITY_KEY = 'sis:timelineGranularity';
  const GRANULARITIES: { value: TimelineGranularity; label: string }[] = [
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
  ];
  const EVENT_LABEL: Record<ChartEvent['kind'], string> = { album: 'Album', single: 'Single', concert: 'Concert' };
  const LABEL_FONT = `${AXIS_LABEL.fontSize}px ${MONO_STACK}`;

  interface AxisPointerEvent { axesInfo?: { axisDim: string; value: number }[] }
  // unidad de un eje: divisor del valor crudo y su etiqueta
  interface AxisScale { div: number; label: (v: number) => string }

  function readGranularity(): TimelineGranularity {
    try {
      return localStorage.getItem(GRANULARITY_KEY) === 'year' ? 'year' : 'month';
    } catch {
      return 'month';
    }
  }

  let granularity = $state<TimelineGranularity>(readGranularity());
  let focusYear = $state<string | null>(null);
  let containerWidth = $state(0);
  let chartInstance = $state<echarts.ECharts | null>(null);
  // columna bajo el puntero de echarts (ratón o showTip), -1 fuera de los paneles
  let pointerIdx = $state(-1);

  function setGranularity(value: TimelineGranularity) {
    granularity = value;
    focusYear = null;
    try { localStorage.setItem(GRANULARITY_KEY, value); } catch { /* preferencia de vista: sin storage, no se recuerda */ }
  }

  let chartType = $derived(entityType === 'artist' ? 'artists' : entityType === 'album' ? 'albums' : 'tracks');
  let rankHistory = $derived(ranks?.history ?? []);

  let months = $derived(timelineMonths({
    series,
    rankHistory,
    chartWeeks: ranks?.chart?.history ?? [],
    weekStart: getWeekStart(),
    now: new Date(),
  }));
  // un año enfocado que ya no está en el eje (otra entidad) no deja la gráfica vacía
  let activeFocus = $derived(focusYear && months.some(m => m.key.startsWith(`${focusYear}-`)) ? focusYear : null);
  let buckets = $derived(fitTimeline(months, containerWidth, granularity, activeFocus));
  let keys = $derived(buckets.map(b => b.key));
  let eventsByIdx = $derived(groupEventsByBucket(events, keys));
  let crossovers = $derived(new Map(rankHistory.flatMap(h => h.crossovers ? [[h.period, h.crossovers] as const] : [])));

  let rankLoading = $derived(ranks != null && (ranks.rankingsLoading || ranks.chartLoading));
  let hasRankData = $derived(buckets.some(b => b.rank != null || b.chartRank != null));
  // el panel se reserva mientras el ranking viene de camino (si apareciera después, las
  // barras encogerían de golpe) y sólo se pliega si llegó vacío
  let rankPanel = $derived(ranks != null && (rankLoading || hasRankData));
  let height = $derived(TOP_PAD_PX + (rankPanel ? RANK_PLOT_PX + PANEL_GAP_PX + ACTIVITY_PLOT_PX : PLAIN_PLOT_PX) + X_LABEL_PX);

  let isPlays = $derived(metric === 'plays');
  const value = (b: TimelineBucket) => (isPlays ? b.plays : b.ms);
  const cumulative = (b: TimelineBucket) => (isPlays ? b.cumPlays : b.cumMs);

  function axisScale(max: number): AxisScale {
    if (isPlays) return { div: 1, label: v => formatNumber(v) };
    return max >= HOUR_AXIS_FROM_MS
      ? { div: HOUR_MS, label: v => `${formatNumber(v)}h` }
      : { div: MINUTE_MS, label: v => `${formatNumber(v)} min` };
  }
  let barMax = $derived(Math.max(0, ...buckets.map(value)));
  let cumMax = $derived(buckets.length ? cumulative(buckets[buckets.length - 1]) : 0);
  let barScale = $derived(axisScale(barMax));
  let cumScale = $derived(axisScale(cumMax));
  let narrow = $derived(containerWidth > 0 && containerWidth < NARROW_CARD_PX);

  // los dos paneles comparten los bordes izquierdo y derecho, así que no puede ser
  // containLabel (cada grid reservaría lo suyo y las columnas no casarían): se mide la
  // etiqueta más ancha de cada eje antes de pintar, con el techo que echarts va a elegir
  let rankAxisMax = $derived.by(() => {
    const worst = Math.max(0, ...buckets.flatMap(b => [b.rank ?? 0, b.chartRank ?? 0]));
    if (!worst) return RANK_AXIS_PLACEHOLDER;
    return Math.max(RANK_AXIS_MIN_MAX, 10 ** Math.ceil(Math.log10(worst)));
  });
  let edges = $derived.by(() => {
    const barW = measureTextWidth(barScale.label(niceAxisMax(barMax / barScale.div)), LABEL_FONT);
    // el techo del eje de ranking no se etiqueta (ver showMaxLabel): la más ancha es la anterior
    const rankW = rankPanel ? measureTextWidth(`#${rankAxisMax / 10}`, LABEL_FONT) : 0;
    const cumW = narrow ? 0 : measureTextWidth(cumScale.label(niceAxisMax(cumMax / cumScale.div)), LABEL_FONT) + AXIS_LABEL_MARGIN_PX;
    return {
      left: Math.ceil(Math.max(barW, rankW)) + AXIS_LABEL_MARGIN_PX + LABEL_SLACK_PX,
      right: Math.ceil(cumW) + LABEL_SLACK_PX,
    };
  });

  // índice de la serie de barras: es la que recibe el showTip de los badges y del chart run
  let barSeriesIndex = $derived(rankPanel ? 2 : 0);

  function monthShort(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(getLocale(), { month: 'short', timeZone: 'UTC' });
  }

  function bucketLabel(b: TimelineBucket): string {
    if (isMonthBucket(b)) return periodLabel(b.key, 'month');
    const quarter = b.key.match(/^(\d{4})-Q(\d)$/);
    return quarter ? `Q${quarter[2]} ${quarter[1]}` : b.key;
  }

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

  function tooltipHtml(idx: number): string {
    const b = buckets[idx];
    if (!b) return '';
    const listened = isPlays ? `${formatNumber(b.plays)} plays` : formatDuration(b.ms);
    const lines = [
      `<b>${escapeHtml(bucketLabel(b))}</b>`,
      listened,
      `<span class="xo-artist">Total:</span> ${isPlays ? `${formatNumber(b.cumPlays)} plays` : formatDuration(b.cumMs)}`,
    ];
    if (b.rank != null) lines.push(`<span class="xo-artist">All-time:</span> <b>#${b.rank}</b>`);
    if (b.chartRank != null) lines.push(`<span class="xo-artist">Best week:</span> <b>#${b.chartRank}</b>`);
    // los crossovers son de un mes: en un trimestre o un año serían sólo los del último
    const xo = isMonthBucket(b) ? crossovers.get(b.key) : undefined;
    const evs = (eventsByIdx.get(idx) ?? [])
      .map(e => `<div class="xo-row"><span class="xo-artist">${EVENT_LABEL[e.kind]}</span><span class="xo-name">${escapeHtml(e.label)}</span></div>`)
      .join('');
    return lines.join('<br/>') + (xo ? crossoverRows(xo) : '') + (evs ? `<div class="xo-sep"></div>${evs}` : '');
  }

  let chartOption = $derived.by<EChartsOption>(() => {
    if (buckets.length < 2) return {};
    const { fg } = canvasColors();
    const { left, right } = edges;
    const g = rankPanel ? 1 : 0;
    const activityTop = TOP_PAD_PX + (rankPanel ? RANK_PLOT_PX + PANEL_GAP_PX : 0);
    const markLine = eventsMarkLine(events, keys);
    const xLabel = { ...AXIS_LABEL, formatter: activeFocus ? monthShort : undefined };

    const activityGrid = { left, right, top: activityTop, bottom: X_LABEL_PX };
    const activityX = categoryAxis(keys, { gridIndex: g, axisLabel: xLabel });
    const barsY = valueAxis({ gridIndex: g, axisLabel: { formatter: barScale.label } });
    const cumY = secondaryValueAxis({ gridIndex: g, axisLabel: { show: !narrow, formatter: cumScale.label } });
    const bars = barSeries(buckets.map(b => value(b) / barScale.div), { xAxisIndex: g, yAxisIndex: g, markLine, cursor: 'pointer' });
    const cum = cumulativeLineSeries(buckets.map(b => cumulative(b) / cumScale.div), { xAxisIndex: g, yAxisIndex: g + 1 });

    const base = {
      tooltip: { ...TOOLTIP_BASE, extraCssText: XO_TOOLTIP_CSS, formatter: (params: TooltipParams) => tooltipHtml(tooltipPoint(params)?.dataIndex ?? -1) },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
    };
    if (!rankPanel) {
      return { ...base, grid: [activityGrid], xAxis: [activityX], yAxis: [barsY, cumY], series: [bars, cum] };
    }

    // las líneas de los lanzamientos cruzan también el panel de ranking, sin su etiqueta
    // (ya la pinta el de abajo al pasar por encima). Apagarla en la serie y no sólo
    // quitarla de cada línea: sin etiqueta propia, echarts pinta la por defecto, que es
    // el índice de la columna
    const rankMarkLine = markLine && {
      ...markLine,
      silent: true,
      label: { show: false },
      emphasis: { label: { show: false } },
      data: markLine.data.map(({ label: _label, emphasis: _emphasis, ...line }) => line),
    };
    const dotColor = `rgba(${fg},0.6)`;
    return {
      ...base,
      grid: [{ left, right, top: TOP_PAD_PX, height: RANK_PLOT_PX }, activityGrid],
      xAxis: [
        categoryAxis(keys, { gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } }),
        activityX,
      ],
      yAxis: [
        {
          type: 'log',
          gridIndex: 0,
          inverse: true,
          min: 1,
          max: rankAxisMax,
          splitLine: { ...SPLIT_LINE },
          // con el eje invertido el techo (#100, #1000) es la etiqueta de abajo, y caía
          // pegada a la de arriba del eje de escuchas: se lee como suya. Su línea se queda
          axisLabel: { ...AXIS_LABEL, show: !rankLoading || hasRankData, showMaxLabel: false, formatter: (v: number) => `#${Math.round(v)}` },
        },
        barsY,
        cumY,
      ],
      series: [
        lineSeries(buckets.map(b => b.rank), {
          xAxisIndex: 0,
          yAxisIndex: 0,
          symbol: 'circle',
          symbolSize: 4,
          cursor: 'pointer',
          // con el eje invertido el área va de la línea al #1: más intensa junto a la línea
          areaStyle: areaGradient(GREEN, 0.02, 0.3),
          markLine: rankMarkLine,
        }),
        // las semanas en los charts: la mejor de cada columna, en la misma escala que el
        // ranking all-time. Es una línea sin trazo porque ScatterChart no está registrado
        lineSeries(buckets.map(b => b.chartRank), {
          xAxisIndex: 0,
          yAxisIndex: 0,
          symbol: 'circle',
          symbolSize: 5,
          showAllSymbol: true,
          lineStyle: { opacity: 0 },
          itemStyle: { color: dotColor },
          emphasis: { disabled: true },
          z: 3,
        }),
        bars,
        cum,
      ],
    };
  });

  // la acción del click depende de la columna: un trimestre o un año se abre en sus
  // meses (el drill-down de la antigua vista por años); un mes lleva a su chart mensual
  function activate(b: TimelineBucket) {
    if (!isMonthBucket(b)) {
      focusYear = b.key.slice(0, 4);
      return;
    }
    if (ranks) goto(`/charts?type=${chartType}&granularity=month&period=${b.key}`);
  }

  let clickable = $derived(pointerIdx >= 0 && !!buckets[pointerIdx] && (!isMonthBucket(buckets[pointerIdx]) || ranks != null));

  // puntero de echarts → mes destacado (lo leen chart stats y el badge del pico). Un
  // bucket que ya contiene el mes destacado no lo pisa: si el destacado vino de una
  // celda del chart run, moverlo al cierre del trimestre apagaría esa celda
  $effect(() => {
    const chart = chartInstance;
    if (!chart) return;
    const zr = chart.getZr();
    // echarts tipa el evento como unknown; en un eje de categorías `value` es el índice
    const onPointer = (e: unknown) => {
      const x = (e as AxisPointerEvent).axesInfo?.find(a => a.axisDim === 'x');
      pointerIdx = x ? x.value : -1;
      const b = x ? buckets[x.value] : undefined;
      if (b && bucketIndexOf([b], highlightedMonth) < 0) highlightedMonth = b.months[b.months.length - 1];
    };
    const onClick = () => {
      const b = buckets[pointerIdx];
      if (b) activate(b);
    };
    // sólo la salida del ratón limpia: un hideTip programático (el destacado vino de
    // fuera y no cae en el eje) no puede borrar el destacado de quien lo puso
    const onOut = () => {
      pointerIdx = -1;
      highlightedMonth = '';
    };
    chart.on('updateAxisPointer', onPointer);
    zr.on('click', onClick);
    zr.on('globalout', onOut);
    return () => {
      if (chart.isDisposed()) return;
      chart.off('updateAxisPointer', onPointer);
      zr.off('click', onClick);
      zr.off('globalout', onOut);
    };
  });

  // mes destacado desde fuera (celda del chart run, badge del pico) → puntero en su columna
  $effect(() => {
    const chart = chartInstance;
    const month = highlightedMonth;
    const idx = month ? bucketIndexOf(buckets, month) : -1;
    if (!chart || idx === untrack(() => pointerIdx)) return;
    chart.dispatchAction(idx >= 0 ? { type: 'showTip', seriesIndex: barSeriesIndex, dataIndex: idx } : { type: 'hideTip' });
  });
</script>

{#if buckets.length > 1}
  <div class="section-header section-header--views">
    <h2 class="section-title">Listening history</h2>
    <div class="section-actions">
      {#if activeFocus}
        <button class="show-all-btn" onclick={() => (focusYear = null)}>‹ All years</button>
      {/if}
      <div class="view-toggle" role="group" aria-label="Group by">
        {#each GRANULARITIES as opt (opt.value)}
          <button
            class="show-all-btn"
            class:active={granularity === opt.value}
            aria-pressed={granularity === opt.value}
            onclick={() => setGranularity(opt.value)}
          >{opt.label}</button>
        {/each}
      </div>
    </div>
  </div>
  <div class="card timeline-card" bind:clientWidth={containerWidth}>
    <ReleaseRail instance={chartInstance} {events} periods={keys} />
    <div class="timeline-canvas" class:clickable>
      <BaseChart option={chartOption} height="{height}px" replaceMerge={['grid', 'xAxis', 'yAxis', 'series']} bind:instance={chartInstance} />
      {#if rankPanel && rankLoading && !hasRankData}
        <div
          class="rank-ghost"
          style:top="{TOP_PAD_PX}px"
          style:height="{RANK_PLOT_PX}px"
          style:left="{edges.left}px"
          style:right="{edges.right}px"
        ></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .timeline-card {
    padding: 1rem;
  }
  .timeline-canvas {
    position: relative;
  }
  .timeline-canvas.clickable {
    cursor: pointer;
  }
  .rank-ghost {
    position: absolute;
    border-radius: var(--radius);
    background: var(--shimmer);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    pointer-events: none;
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
