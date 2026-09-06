<script lang="ts" module>
  // fila de una gráfica de ranking: lo justo para pintarla y para navegar al
  // pincharla. Cada consumidor la construye desde su propia lista top
  export interface RankingChartItem {
    id: string;
    name: string;
    imageUrl: string | null;
    playCount: number;
    totalMs: number;
    href: string;
    // pick manual de color (#rrggbb): manda sobre el extraído de la portada
    color?: string | null;
  }

  export type RankingChartMode = 'bar' | 'velocity';
</script>

<script lang="ts">
  // gráfica de ranking compartida: barras horizontales (nombre dentro de la barra
  // cuando cabe, fuera delante de su cifra cuando no) o velocity (acumulado de
  // cada fila en el tiempo, una línea por entidad). Las filas llegan ya
  // ordenadas (posición 0 = nº1); las series del velocity las pide ella misma en
  // un solo lote cuando se entra en ese modo
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import type { EChartsOption } from 'echarts';
  import { api, createFetchController, type EntityType, type RankingMetric, type DateRangeParams } from '$lib/api';
  import { isAbortError } from '$lib/utils/errors';
  import { formatNumber, formatShortDate } from '$lib/utils/format';
  import { periodLabel } from '$lib/utils/periods';
  import { resolveEntityColor, readableTextOn } from '$lib/utils/color';
  import { fitZipf } from '$lib/utils/zipf';
  import {
    GRID, TOOLTIP_BASE, SPLIT_LINE, AXIS_LINE, AXIS_LABEL, SANS_STACK, MONO_STACK, zoomX,
    tooltipPoint, tooltipTuplePoints, measureTextWidth, truncateToWidth, niceAxisMax,
    type SeriesPoint, type TooltipParams, type ChartClickEvent,
  } from '$lib/utils/chart';
  import BaseChart from './BaseChart.svelte';

  let {
    items,
    entityType,
    metric,
    mode,
    range = 'all',
    dates,
    minHeight = 0,
  }: {
    items: RankingChartItem[];
    // decide la forma de las portadas (redondas para artistas) y el tipo con el
    // que se piden las series
    entityType: EntityType;
    metric: RankingMetric;
    mode: RankingChartMode;
    range?: string;
    dates?: DateRangeParams;
    // suelo de alto en px: la altura natural es proporcional al nº de filas y
    // en una card ancha pocas filas quedan perdidas
    minHeight?: number;
  } = $props();

  type Rgb = [number, number, number];
  const DEFAULT_RGB: Rgb = [29, 185, 84];
  const MS_PER_MINUTE = 60_000;
  const MINUTES_PER_HOUR = 60;

  // --- colores ---
  // color de cada fila, por id: el pick manual del álbum si lo hay y, si no, el
  // dominante de su portada. Al cambiar la lista solo se resuelven las que faltan;
  // un color es un hecho de la fila, no de la lista, así que un resultado que
  // llega tarde se guarda igual
  let colors = $state<Map<string, Rgb>>(new Map());

  $effect(() => {
    const known = untrack(() => colors);
    const pending = items.filter(i => (i.color || i.imageUrl) && !known.has(i.id));
    if (pending.length === 0) return;
    Promise.all(pending.map(i => resolveEntityColor(i.color, i.imageUrl))).then(rgbs => {
      const next = new Map(untrack(() => colors));
      pending.forEach((i, k) => next.set(i.id, rgbs[k]));
      colors = next;
    });
  });

  function rgbToCss([r, g, b]: Rgb): string {
    return `rgb(${r},${g},${b})`;
  }

  // --- métrica ---
  function metricValue(item: { playCount: number; totalMs: number }): number {
    return metric === 'plays' ? item.playCount : item.totalMs / MS_PER_MINUTE;
  }

  function formatValue(v: number): string {
    if (metric === 'plays') return formatNumber(Math.round(v));
    const h = Math.floor(v / MINUTES_PER_HOUR);
    const m = Math.round(v % MINUTES_PER_HOUR);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function formatMetric(v: number): string {
    return metric === 'plays' ? `${formatValue(v)} plays` : formatValue(v);
  }

  // --- bar chart ---
  // filas en orden de ranking (posición 0 = nº1). El chart las invierte para
  // pintar de arriba abajo; el ajuste de zipf las lee tal cual
  let chartRows = $derived(items.map(i => ({ id: i.id, name: i.name, value: metricValue(i), image: i.imageUrl, href: i.href })));

  // el exponente describe las barras dibujadas, así que se recalcula con la lista
  let zipf = $derived(fitZipf(chartRows.map(r => r.value)));

  // --- geometría de las etiquetas ---
  // el nombre va DENTRO de la barra cuando cabe y fuera, delante de su cifra,
  // cuando no. "Caber" es una pregunta en píxeles, así que el eje se fija a un
  // techo propio (niceAxisMax) en vez de dejar que echarts elija el suyo, que no
  // es consultable hasta después de pintar: con el techo fijado, cada barra mide
  // exactamente valor/techo del ancho útil del grid
  const COVER_SIZE = 26;
  const COVER_GAP = 8;
  const GRID_LEFT = COVER_SIZE + COVER_GAP * 2;
  const GRID_RIGHT = 55;
  const BAR_WIDTH = 28;
  const NAME_FONT_SIZE = 12;
  // aire entre el borde de la barra y el texto, dentro y fuera
  const LABEL_DISTANCE = 6;
  // aire que debe sobrar dentro de la barra detrás del nombre para que se
  // considere que cabe: pegado al borde derecho se lee como desbordado
  const NAME_TAIL = 6;
  // separación entre el nombre que ha salido fuera y la cifra que lo sigue
  const NAME_STAT_GAP = 8;
  const STAT_FONT_SIZE = 11;
  // el nombre que sale fuera puede pintarse sobre el margen que el grid reserva
  // a la derecha: su límite real es el borde del canvas, no el del grid
  const CANVAS_RIGHT_MARGIN = 4;
  // extremos de opacidad del degradado de cada barra, de su izquierda a su derecha
  const FILL_HEAD_ALPHA = 0.9;
  const FILL_TAIL_ALPHA = 0.3;
  const NAME_OUTSIDE_COLOR = '#e0e8e8';
  const STAT_COLOR = '#6a7a7a';
  const COVER_PLACEHOLDER = '#1e2a2a';
  // alto por fila y aire de ejes de cada modo
  const BAR_ROW_HEIGHT = 44;
  const BAR_CHART_PADDING = 30;
  const VEL_ROW_HEIGHT = 22;
  const VEL_CHART_PADDING = 180;

  let chartHostWidth = $state(0);
  let coverRadius = $derived(entityType === 'artist' ? COVER_SIZE / 2 : 2);
  // en un host estrecho (móvil, rail) el velocity no puede regalar 150px a las
  // etiquetas de cola: se acortan los nombres y se estrecha el margen
  const COMPACT_HOST_WIDTH = 560;
  let compact = $derived(chartHostWidth > 0 && chartHostWidth < COMPACT_HOST_WIDTH);
  let barHeight = $derived(Math.max(minHeight, items.length * BAR_ROW_HEIGHT + BAR_CHART_PADDING));
  let velHeight = $derived(Math.max(minHeight, items.length * VEL_ROW_HEIGHT + VEL_CHART_PADDING));

  let barAxisMax = $derived(niceAxisMax(Math.max(0, ...chartRows.map(r => r.value))));

  // filas tal y como se pintan: invertidas (echarts numera las categorías de
  // abajo arriba) y con la decisión de colocación ya tomada, que el nombre y el
  // desplazamiento de la cifra tienen que compartir para no pisarse
  let barRows = $derived.by(() => {
    const plotWidth = Math.max(0, chartHostWidth - GRID_LEFT - GRID_RIGHT);
    const nameFont = `${NAME_FONT_SIZE}px ${SANS_STACK}`;
    const statFont = `${STAT_FONT_SIZE}px ${MONO_STACK}`;
    const rightLimit = chartHostWidth - CANVAS_RIGHT_MARGIN;

    return chartRows.map((row) => {
      const barWidth = (row.value / barAxisMax) * plotWidth;
      const statWidth = measureTextWidth(formatValue(row.value), statFont);
      const fullWidth = measureTextWidth(row.name, nameFont);

      // hueco a cada lado: dentro es lo que queda de barra descontando el aire de
      // sus dos bordes; fuera, lo que va del final de la barra hasta su cifra
      const insideRoom = barWidth - LABEL_DISTANCE - NAME_TAIL;
      const outsideRoom = rightLimit - (GRID_LEFT + barWidth + LABEL_DISTANCE) - NAME_STAT_GAP - statWidth;

      // dentro si cabe entero; si no, fuera si cabe entero ahí. Recortar es el
      // último recurso y se hace contra el mayor de los dos huecos, no contra un
      // tope de caracteres: un nombre que cabe no debe perder ni un carácter
      const inside = fullWidth <= insideRoom || (fullWidth > outsideRoom && insideRoom >= outsideRoom);
      const room = inside ? insideRoom : outsideRoom;
      const name = fullWidth <= room ? row.name : truncateToWidth(row.name, nameFont, room);
      const nameWidth = measureTextWidth(name, nameFont);
      const rgb = colors.get(row.id) ?? DEFAULT_RGB;

      // el degradado se apaga hacia la derecha, así que un nombre que ocupa casi
      // toda una barra corta se lee sobre un relleno mucho más flojo que el de
      // una larga: el contraste se decide en el punto medio del propio texto
      const midpoint = barWidth > 0 ? Math.min(1, (LABEL_DISTANCE + nameWidth / 2) / barWidth) : 0;
      const alpha = FILL_HEAD_ALPHA + (FILL_TAIL_ALPHA - FILL_HEAD_ALPHA) * midpoint;

      return {
        ...row,
        name,
        fullName: row.name,
        nameWidth,
        inside,
        rgb,
        nameColor: inside ? readableTextOn(rgb, alpha) : NAME_OUTSIDE_COLOR,
      };
    }).reverse();
  });

  let barChartOption = $derived.by<EChartsOption>(() => {
    const rich: Record<string, any> = {};
    barRows.forEach((row, i) => {
      rich[`img${i}`] = {
        backgroundColor: row.image ? { image: row.image } : COVER_PLACEHOLDER,
        width: COVER_SIZE,
        height: COVER_SIZE,
        borderRadius: coverRadius,
        align: 'left',
      };
    });

    return {
      grid: { top: 10, bottom: 5, right: GRID_RIGHT, containLabel: false, left: GRID_LEFT },
      tooltip: {
        ...TOOLTIP_BASE,
        axisPointer: { type: 'shadow' },
        formatter: (params: TooltipParams) => {
          const p = tooltipPoint(params);
          // el nombre en sans (es texto, no cifra); el valor se queda en el mono del
          // tooltip. Se enseña entero aunque su etiqueta haya tenido que recortarse
          const name = barRows[p.dataIndex]?.fullName ?? p.name;
          return `<span style="font-family: var(--font-sans)">${name}</span><br/>${formatMetric(p.value)}`;
        },
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: barAxisMax,
        splitLine: { ...SPLIT_LINE },
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => formatValue(v) },
      },
      yAxis: {
        type: 'category',
        data: barRows.map(r => r.name),
        axisLine: { ...AXIS_LINE },
        axisTick: { show: false },
        // el eje solo lleva la portada: el nombre vive sobre la barra
        axisLabel: {
          rich,
          align: 'left',
          margin: COVER_SIZE + COVER_GAP,
          formatter: (_name: string, index: number) => `{img${index}|}`,
        },
        triggerEvent: true,
      },
      series: [{
        type: 'bar',
        barWidth: BAR_WIDTH,
        data: barRows.map((row) => {
          const [r, g, b] = row.rgb;
          return {
            value: row.value,
            itemStyle: {
              color: {
                type: 'linear' as const,
                x: 0, y: 0, x2: 1, y2: 0,
                colorStops: [
                  { offset: 0, color: `rgba(${r},${g},${b},${FILL_HEAD_ALPHA})` },
                  { offset: 1, color: `rgba(${r},${g},${b},${FILL_TAIL_ALPHA})` },
                ],
              },
              borderRadius: [0, 2, 2, 0],
            },
            // cuando el nombre no cabe dentro sale delante de la cifra, así que la
            // cifra se aparta justo lo que ocupa. El offset se escribe SIEMPRE: al
            // remerger la opción, una clave ausente no borra la del render anterior
            label: { offset: row.inside ? [0, 0] : [row.nameWidth + NAME_STAT_GAP, 0] },
          };
        }),
        cursor: 'pointer',
        label: {
          show: true,
          position: 'right',
          distance: LABEL_DISTANCE,
          color: STAT_COLOR,
          fontSize: STAT_FONT_SIZE,
          formatter: (params: TooltipParams) => formatValue(tooltipPoint(params).value),
        },
      }, {
        // una serie de barras solo admite UNA etiqueta por dato, y aquí hacen falta
        // dos anclajes distintos (nombre y cifra): esta serie calca la geometría de
        // la anterior (barGap -100% la superpone), no pinta nada y solo existe para
        // colgar de ella la etiqueta del nombre, que al dibujarse después queda
        // por encima de las barras
        type: 'bar',
        barWidth: BAR_WIDTH,
        barGap: '-100%',
        silent: true,
        tooltip: { show: false },
        itemStyle: { color: 'transparent' },
        emphasis: { disabled: true },
        data: barRows.map(row => ({
          value: row.value,
          label: { position: row.inside ? 'insideLeft' : 'right', color: row.nameColor },
        })),
        label: {
          show: true,
          distance: LABEL_DISTANCE,
          fontSize: NAME_FONT_SIZE,
          fontFamily: SANS_STACK,
          formatter: '{b}',
        },
      }],
    };
  });

  function handleBarClick(params: ChartClickEvent) {
    // la portada es una etiqueta del eje: llega con el nombre de la categoría,
    // no con el índice, y se localiza en las filas pintadas
    const dataIdx = params.componentType === 'yAxis'
      ? barRows.findIndex(r => r.name === String(params.value))
      : params.dataIndex;
    const href = barRows[dataIdx]?.href;
    if (href) goto(href);
  }

  // --- velocity ---
  type VelEntry = RankingChartItem & { points: [string, number][] };
  const VEL_COVER = 18;
  const VEL_MAX_NAME = 16;
  const VEL_MAX_NAME_COMPACT = 10;
  const VEL_GRID_RIGHT = 150;
  const VEL_GRID_RIGHT_COMPACT = 105;
  const VEL_GRID_BOTTOM = 52;

  let series = $state<Record<string, SeriesPoint[]>>({});
  let velLoading = $state(false);
  let velHidden = $state<Set<string>>(new Set());
  const seriesCtrl = createFetchController();
  // clave del lote ya pedido: cambiar de modo y volver no repite la petición
  let loadedKey = '';

  $effect(() => {
    if (mode !== 'velocity') return;
    const ids = items.map(i => i.id);
    const key = [entityType, range, dates?.startDate ?? '', dates?.endDate ?? '', ...ids].join('|');
    if (ids.length === 0 || key === loadedKey) return;
    loadedKey = key;
    const signal = seriesCtrl.reset();
    velLoading = true;
    api.seriesBatch(entityType, ids, range, dates, signal)
      .then((res) => { if (!signal.aborted) series = res; })
      // un fallo no deja la clave marcada: la siguiente entrada en velocity reintenta
      .catch((e) => { if (!isAbortError(e)) loadedKey = ''; })
      .finally(() => { if (!signal.aborted) velLoading = false; });
  });

  // lo oculto a mano se olvida cuando cambia lo que se pinta
  $effect(() => {
    void items;
    void metric;
    velHidden = new Set();
  });

  // acumulado de la serie en orden cronológico
  function cumulative(raw: SeriesPoint[]): [string, number][] {
    let acc = 0;
    return [...raw]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((s) => { acc += metricValue({ playCount: s.play_count, totalMs: s.total_ms }); return [s.period, acc]; });
  }

  let velSeries = $derived<VelEntry[]>(items.flatMap((i) => {
    const raw = series[i.id];
    return raw?.length ? [{ ...i, points: cumulative(raw) }] : [];
  }));

  // las series de 'all' vienen por mes: new Date('2024-03') es el día 1 a
  // medianoche UTC, que formatShortDate pintaría como "Mar 1" (o "Feb 29" al
  // oeste de Greenwich). Un mes se etiqueta como mes; un día, como día
  function formatPeriod(period: string): string {
    if (/^\d{4}-\d{2}$/.test(period)) return periodLabel(period, 'month');
    if (/^\d{4}$/.test(period)) return period;
    return formatShortDate(period);
  }

  let velChartOption = $derived.by<EChartsOption>(() => {
    if (velSeries.length === 0) return {} as EChartsOption;

    const velRadius = entityType === 'artist' ? VEL_COVER / 2 : 2;
    const maxName = compact ? VEL_MAX_NAME_COMPACT : VEL_MAX_NAME;
    const chartSeries = velSeries
      .filter((s) => !velHidden.has(s.id))
      .map((s) => {
        const color = rgbToCss(colors.get(s.id) ?? DEFAULT_RGB);
        const richKey = `img_${s.id.replace(/[^a-zA-Z0-9]/g, '')}`;
        const displayName = s.name.length > maxName ? s.name.slice(0, maxName - 1) + '…' : s.name;
        const rich: Record<string, any> = {
          name: { color, fontWeight: 700, fontSize: 11, padding: [0, 0, 0, 6], verticalAlign: 'middle' },
          [richKey]: {
            backgroundColor: s.imageUrl ? { image: s.imageUrl } : COVER_PLACEHOLDER,
            width: VEL_COVER,
            height: VEL_COVER,
            borderRadius: velRadius,
          },
        };
        return {
          id: s.id,
          name: s.name,
          type: 'line' as const,
          showSymbol: false,
          smooth: false,
          cursor: 'pointer',
          data: s.points,
          lineStyle: { width: 2, color },
          itemStyle: { color },
          emphasis: { lineStyle: { width: 3 } },
          labelLayout: { moveOverlap: 'shiftY' as const },
          endLabel: {
            show: true,
            formatter: `{${richKey}|} {name|${displayName}}`,
            rich,
            padding: [2, 0, 0, 0],
          },
        };
      });

    return {
      grid: { ...GRID, right: compact ? VEL_GRID_RIGHT_COMPACT : VEL_GRID_RIGHT, bottom: VEL_GRID_BOTTOM },
      dataZoom: zoomX(),
      tooltip: {
        ...TOOLTIP_BASE,
        formatter: (params: TooltipParams) => {
          const list = tooltipTuplePoints(params);
          if (list.length === 0) return '';
          const header = formatPeriod(String(list[0].value[0]));
          const rows = list
            .sort((a, b) => b.value[1] - a.value[1])
            .map(p => `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${formatMetric(p.value[1])}</b>`)
            .join('<br/>');
          return `<b>${header}</b><br/>${rows}`;
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { ...AXIS_LINE },
        // en estrecho los años se pisaban unos a otros
        axisLabel: { ...AXIS_LABEL, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { ...AXIS_LINE },
        axisLabel: { ...AXIS_LABEL, formatter: (v: number) => formatValue(v) },
        splitLine: { ...SPLIT_LINE },
      },
      series: chartSeries,
    };
  });

  function handleVelocityClick(params: ChartClickEvent) {
    const id = params?.seriesId as string | undefined;
    if (!id) return;
    const next = new Set(velHidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    velHidden = next;
  }

  function showVelocityEntity(id: string) {
    if (!velHidden.has(id)) return;
    const next = new Set(velHidden);
    next.delete(id);
    velHidden = next;
  }
</script>

<!-- el ancho del host es lo que decide si cada nombre cabe dentro de su barra
     (y cuánto margen de etiquetas se puede permitir el velocity): hasta medirlo
     no se monta ningún chart, para no pintar un primer frame con todos los
     nombres fuera y corregirlo después -->
<div bind:clientWidth={chartHostWidth}>
{#if chartHostWidth === 0}
  <div class="vel-loading" style:height="{mode === 'bar' ? barHeight : velHeight}px"></div>
{:else if mode === 'bar'}
  <BaseChart option={barChartOption} height="{barHeight}px" onclick={handleBarClick} />
  {#if zipf}
    <div class="zipf-row">
      <span
        class="zipf-pill"
        title="Least-squares fit of log({metric === 'plays' ? 'plays' : 'listening time'}) against log(rank) over the {zipf.n} bars shown. α=1 is classic Zipf (each rank keeps half of the one above it), α&lt;1 a flatter spread, α&gt;1 a head that dominates. R² is how closely the ranking follows a power law at all: a low R² means the α is not describing much."
      >ZIPF α {zipf.alpha.toFixed(2)} · R² {zipf.r2.toFixed(2)}</span>
    </div>
  {/if}
{:else if velLoading}
  <div class="vel-loading" style:height="{velHeight}px"><div class="spinner"></div></div>
{:else if velSeries.length > 0}
  <BaseChart option={velChartOption} height="{velHeight}px" replaceMerge={['series']} onclick={handleVelocityClick} />
  {#if velHidden.size > 0}
    <div class="vel-hidden-row">
      <span class="vel-hidden-label">Hidden:</span>
      {#each velSeries as s (s.id)}
        {#if velHidden.has(s.id)}
          <button
            class="vel-hidden-chip"
            onclick={() => showVelocityEntity(s.id)}
            title="Show {s.name}"
            style:border-left-color={rgbToCss(colors.get(s.id) ?? DEFAULT_RGB)}
          >
            {#if s.imageUrl}
              <img class="vel-hidden-cover" class:vel-hidden-cover--round={entityType === 'artist'} src={s.imageUrl} alt="" />
            {:else}
              <span class="vel-hidden-cover vel-hidden-cover--placeholder" class:vel-hidden-cover--round={entityType === 'artist'}></span>
            {/if}
            {s.name}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
{:else}
  <div class="vel-empty">Nothing to plot yet</div>
{/if}
</div>

<style>
  .zipf-row {
    display: flex;
    justify-content: flex-end;
    padding: 0 0.75rem 0.25rem;
  }

  .zipf-pill {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
    font-size: 0.7rem;
    /* cifras en mono: es el mismo criterio que las etiquetas de valor del chart */
    font-family: var(--font-mono);
    white-space: nowrap;
    cursor: help;
  }

  .vel-loading {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .vel-empty {
    color: var(--text-muted);
    font-size: 0.8rem;
    padding: 1rem 0;
    text-align: center;
  }

  .vel-hidden-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem 0.25rem;
    font-size: 0.75rem;
  }

  .vel-hidden-label {
    color: var(--text-muted);
    margin-right: 0.15rem;
  }

  .vel-hidden-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.15rem 0.5rem 0.15rem 0.3rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    border-left-width: 3px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.75rem;
    font-family: inherit;
    transition: color 0.05s, border-color 0.05s, background 0.05s;
  }

  .vel-hidden-chip:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.03);
  }

  .vel-hidden-cover {
    width: 18px;
    height: 18px;
    border-radius: 2px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .vel-hidden-cover--round {
    border-radius: 50%;
  }

  .vel-hidden-cover--placeholder {
    background: #1e2a2a;
    display: inline-block;
  }
</style>
