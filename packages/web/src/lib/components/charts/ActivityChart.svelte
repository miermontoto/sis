<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { getLocale, type EntityType, type RankingMetric } from '$lib/api';
  import { formatDuration, formatNumber } from '$lib/utils/format';
  import { periodLabel } from '$lib/utils/periods';
  import {
    dualAxisGrid, TOOLTIP_BASE, AXIS_LABEL, categoryAxis, valueAxis, secondaryValueAxis, barSeries, cumulativeLineSeries,
    eventsMarkLine, groupEventsByBucket, escapeHtml, tooltipPoint, type ChartEvent, type TooltipParams,
  } from '$lib/utils/chart';
  import { timelineMonths, fitTimeline, isMonthBucket, type TimelineBucket, type TimelineGranularity } from '$lib/utils/entity-timeline';
  import { linkMonthPointer, showMonthTip } from '$lib/utils/month-pointer';
  import BaseChart from './BaseChart.svelte';
  import ReleaseRail from './ReleaseRail.svelte';
  import type * as echarts from 'echarts/core';
  import type { EChartsOption } from 'echarts';

  // escuchas por periodo (barras) y su acumulado (línea, eje derecho), con los
  // lanzamientos y bolos encima. Month · Year en la cabecera: el modo año sustituye a la
  // antigua "History by year" del rail, con el mismo drill-down (click en un año = sus
  // meses). Enlazada por mes con la gráfica de ranking y con el chart run
  let {
    entityType,
    series,
    metric,
    events = [],
    linkCharts,
    highlightedMonth = $bindable(''),
  }: {
    entityType: EntityType;
    series: { period: string; play_count: number; total_ms: number }[];
    metric: RankingMetric;
    events?: ChartEvent[];
    // la entidad tiene chart propio: un click en un mes lleva a su chart mensual (un
    // alias o un miembro de colección rankean dentro de otra)
    linkCharts: boolean;
    highlightedMonth?: string;
  } = $props();

  const HEIGHT = '250px';
  // los ejes de tiempo se pintan en la unidad de su etiqueta: en ms, echarts elegía
  // ticks redondos en ms y salían "16.667 min". Desde 10h el eje pasa a horas
  const MINUTE_MS = 60_000;
  const HOUR_MS = 3_600_000;
  const HOUR_AXIS_FROM_MS = 10 * HOUR_MS;
  // por debajo de este ancho de card el eje del acumulado pierde sus etiquetas (la línea
  // sigue, y su cifra va en el tooltip): las dos columnas de etiquetas dejaban la
  // gráfica en menos de la mitad de un móvil
  const NARROW_CARD_PX = 480;
  const GRANULARITY_KEY = 'sis:timelineGranularity';
  const GRANULARITIES: { value: TimelineGranularity; label: string }[] = [
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
  ];
  const EVENT_LABEL: Record<ChartEvent['kind'], string> = { album: 'Album', single: 'Single', concert: 'Concert' };

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
  let pointerIdx = $state(-1);

  function setGranularity(value: TimelineGranularity) {
    granularity = value;
    focusYear = null;
    try { localStorage.setItem(GRANULARITY_KEY, value); } catch { /* preferencia de vista: sin storage, no se recuerda */ }
  }

  let chartType = $derived(entityType === 'artist' ? 'artists' : entityType === 'album' ? 'albums' : 'tracks');
  // hasta el mes en curso aunque la entidad lleve años sin sonar: el mismo eje que la
  // gráfica de ranking, y el hueco del final dice que se dejó de escuchar
  let months = $derived(timelineMonths({ series, rankHistory: [], now: new Date() }));
  // un año enfocado que ya no está en el eje (otra entidad) no deja la gráfica vacía
  let activeFocus = $derived(focusYear && months.some(m => m.key.startsWith(`${focusYear}-`)) ? focusYear : null);
  let buckets = $derived(fitTimeline(months, containerWidth, granularity, activeFocus));
  let keys = $derived(buckets.map(b => b.key));
  let eventsByIdx = $derived(groupEventsByBucket(events, keys));

  let isPlays = $derived(metric === 'plays');
  const value = (b: TimelineBucket) => (isPlays ? b.plays : b.ms);
  const cumulative = (b: TimelineBucket) => (isPlays ? b.cumPlays : b.cumMs);

  function axisScale(max: number): AxisScale {
    if (isPlays) return { div: 1, label: v => formatNumber(v) };
    return max >= HOUR_AXIS_FROM_MS
      ? { div: HOUR_MS, label: v => `${formatNumber(v)}h` }
      : { div: MINUTE_MS, label: v => `${formatNumber(v)} min` };
  }
  let barScale = $derived(axisScale(Math.max(0, ...buckets.map(value))));
  let cumScale = $derived(axisScale(buckets.length ? cumulative(buckets[buckets.length - 1]) : 0));
  let narrow = $derived(containerWidth > 0 && containerWidth < NARROW_CARD_PX);

  function monthShort(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(getLocale(), { month: 'short', timeZone: 'UTC' });
  }

  function bucketLabel(b: TimelineBucket): string {
    if (isMonthBucket(b)) return periodLabel(b.key, 'month');
    const quarter = b.key.match(/^(\d{4})-Q(\d)$/);
    return quarter ? `Q${quarter[2]} ${quarter[1]}` : b.key;
  }

  function tooltipHtml(idx: number): string {
    const b = buckets[idx];
    if (!b) return '';
    const total = isPlays ? `${formatNumber(b.cumPlays)} plays` : formatDuration(b.cumMs);
    const lines = [
      `<b>${escapeHtml(bucketLabel(b))}</b>`,
      isPlays ? `${formatNumber(b.plays)} plays` : formatDuration(b.ms),
      `<span class="tl-muted">Total:</span> ${total}`,
    ];
    const evs = (eventsByIdx.get(idx) ?? [])
      .map(e => `<div class="tl-event"><span class="tl-muted">${EVENT_LABEL[e.kind]}</span> ${escapeHtml(e.label)}</div>`)
      .join('');
    return lines.join('<br/>') + evs;
  }

  let chartOption = $derived.by<EChartsOption>(() => {
    if (buckets.length < 2) return {};
    return {
      grid: dualAxisGrid(),
      tooltip: { ...TOOLTIP_BASE, formatter: (params: TooltipParams) => tooltipHtml(tooltipPoint(params)?.dataIndex ?? -1) },
      xAxis: categoryAxis(keys, { axisLabel: { ...AXIS_LABEL, formatter: activeFocus ? monthShort : undefined } }),
      yAxis: [
        valueAxis({ axisLabel: { formatter: barScale.label } }),
        secondaryValueAxis({ axisLabel: { show: !narrow, formatter: cumScale.label } }),
      ],
      series: [
        barSeries(buckets.map(b => value(b) / barScale.div), { markLine: eventsMarkLine(events, keys), cursor: 'pointer' }),
        cumulativeLineSeries(buckets.map(b => cumulative(b) / cumScale.div)),
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
    if (linkCharts) goto(`/charts?type=${chartType}&granularity=month&period=${b.key}`);
  }

  let clickable = $derived(pointerIdx >= 0 && !!buckets[pointerIdx] && (!isMonthBucket(buckets[pointerIdx]) || linkCharts));

  $effect(() => {
    const chart = chartInstance;
    if (!chart) return;
    return linkMonthPointer(chart, {
      buckets: () => buckets,
      highlighted: () => highlightedMonth,
      setHighlighted: m => { highlightedMonth = m; },
      setPointer: i => { pointerIdx = i; },
      onClick: activate,
    });
  });

  $effect(() => {
    if (chartInstance) showMonthTip(chartInstance, buckets, highlightedMonth, untrack(() => pointerIdx), 0);
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
  <div class="card chart-card" class:clickable bind:clientWidth={containerWidth}>
    <ReleaseRail instance={chartInstance} {events} periods={keys} />
    <BaseChart option={chartOption} height={HEIGHT} replaceMerge={['xAxis', 'series']} bind:instance={chartInstance} />
  </div>
{/if}

<style>
  .chart-card {
    padding: 1rem;
  }
  .chart-card.clickable {
    cursor: pointer;
  }
  /* el HTML del tooltip lo monta echarts fuera del árbol de svelte */
  :global(.tl-muted) {
    color: var(--text-muted);
  }
  :global(.tl-event) {
    font-size: 11px;
    margin-top: 3px;
  }
</style>
