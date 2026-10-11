<script module lang="ts">
  import * as echarts from 'echarts/core';

  // zrender da a cada línea de texto la altura del ANCHO de '国', suponiendo que
  // un glifo cjk mide 1em. Sin fuentes cjk (el escritorio de desarrollo, muchos
  // linux) el navegador pinta el glifo de reserva de la monospace, de 0.6em, y
  // todas las líneas de todos los charts salían al 60% de su alto: etiquetas
  // pisándose, líneas partidas una encima de otra y `hideOverlap` escondiendo
  // etiquetas de la dona. Esa sonda se responde con el tamaño de la fuente, lo
  // que mide en cualquier sistema con cjk; el resto sigue midiéndolo el canvas.
  // Va en el módulo porque zrender cachea cada medida: tiene que estar antes del
  // primer chart
  const LINE_HEIGHT_PROBE = '国';
  // el mismo patrón con el que zrender saca el tamaño de un shorthand de fuente
  const FONT_SIZE_PX = /((?:\d+)?\.?\d*)px/;
  const DEFAULT_FONT = '12px sans-serif';
  let measureCtx: CanvasRenderingContext2D | null = null;
  // el canvas normaliza `font` al asignarlo: se compara contra lo último pedido
  let measureFont = '';

  echarts.setPlatformAPI({
    measureText(text: string, font = DEFAULT_FONT) {
      if (text === LINE_HEIGHT_PROBE) return { width: Number(FONT_SIZE_PX.exec(font)?.[1]) || parseFloat(DEFAULT_FONT) };
      measureCtx ??= document.createElement('canvas').getContext('2d')!;
      if (measureFont !== font) measureCtx.font = measureFont = font;
      return measureCtx.measureText(text);
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import type { ChartClickEvent } from '$lib/utils/chart';
  import { canvasColors, type CanvasPalette } from '$lib/stores/theme.svelte';
  import { CanvasRenderer } from 'echarts/renderers';
  import { BarChart, LineChart, HeatmapChart, PieChart, RadarChart, GraphChart } from 'echarts/charts';
  import {
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    CalendarComponent,
    RadarComponent as RadarComp,
    PolarComponent,
    DataZoomComponent,
    MarkLineComponent,
  } from 'echarts/components';
  import type { EChartsOption } from 'echarts';

  // registrar módulos (tree-shaking)
  echarts.use([
    CanvasRenderer,
    BarChart,
    LineChart,
    HeatmapChart,
    PieChart,
    RadarChart,
    GraphChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    CalendarComponent,
    RadarComp,
    PolarComponent,
    DataZoomComponent,
    MarkLineComponent,
  ]);

  interface Props {
    option: EChartsOption;
    height?: string;
    onclick?: (params: ChartClickEvent) => void;
    onmouseover?: (params: ChartClickEvent) => void;
    onmouseout?: (params: ChartClickEvent) => void;
    instance?: echarts.ECharts | null;
    replaceMerge?: string[];
    // dato que late (el periodo en curso): se alterna con highlight/downplay, así que su
    // aspecto atenuado va en el `emphasis` de ESE dato, en la opción del consumidor
    pulseIndex?: number;
    pulseSeries?: number;
  }

  let { option, height = '300px', onclick, onmouseover, onmouseout, instance = $bindable(null), replaceMerge, pulseIndex, pulseSeries = 0 }: Props = $props();

  const PULSE_INTERVAL_MS = 1500;
  let container = $state<HTMLElement | null>(null);
  let chart: echarts.ECharts | null = null;
  // última opción ya aplicada: el efecto de actualización corre también justo después
  // del init con la MISMA opción, y eso era un segundo render completo en cada montaje
  let applied: EChartsOption | null = null;

  // tema de echarts consistente con el CSS, sacado de la paleta del tema activo
  const MONO_STACK = 'ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace';
  const echartsTheme = ({ text, muted, card, border }: CanvasPalette) => ({
    backgroundColor: 'transparent',
    textStyle: { color: muted, fontFamily: MONO_STACK },
    title: { textStyle: { color: text } },
    legend: { textStyle: { color: muted, fontFamily: MONO_STACK } },
    tooltip: {
      backgroundColor: card,
      borderColor: border,
      textStyle: { color: text, fontFamily: MONO_STACK },
    },
  });

  // init fija el tema para toda la vida de la instancia, así que el efecto se
  // suscribe a la paleta y un cambio de tema rehace el chart. la opción se relee
  // entera: los estilos compartidos de chart.ts son getters y dan ya el color nuevo
  $effect(() => {
    if (!container) return;
    const el = container;
    const palette = canvasColors();

    untrack(() => {
      chart = echarts.init(el, echartsTheme(palette));
      instance = chart;
      chart.setOption(option);
      applied = option;
      if (onclick) chart.on('click', onclick);
      if (onmouseover) chart.on('mouseover', onmouseover);
      if (onmouseout) chart.on('mouseout', onmouseout);
    });

    // sólo con un cambio de tamaño real: el observer dispara también al observar, con el
    // tamaño de siempre, y cada resize es un render completo
    const resizeObserver = new ResizeObserver(() => {
      if (chart && (el.clientWidth !== chart.getWidth() || el.clientHeight !== chart.getHeight())) chart.resize();
    });
    resizeObserver.observe(el);

    // el pulso cambia el estado de UN dato sin tocar la opción (1-2ms); rehacer la opción
    // entera para cambiarle la opacidad eran 8 renders completos cada 1.5s en /insights.
    // Lee los props en cada tic, así que cambiar de dato no rehace el chart
    let pulsed: { seriesIndex: number; dataIndex: number } | null = null;
    const pulseTimer = setInterval(() => {
      if (!chart || document.hidden) return;
      if (pulsed) {
        chart.dispatchAction({ type: 'downplay', ...pulsed });
        pulsed = null;
      } else if (pulseIndex !== undefined && pulseIndex >= 0) {
        pulsed = { seriesIndex: pulseSeries, dataIndex: pulseIndex };
        chart.dispatchAction({ type: 'highlight', ...pulsed });
      }
    }, PULSE_INTERVAL_MS);

    return () => {
      clearInterval(pulseTimer);
      resizeObserver.disconnect();
      chart?.dispose();
      chart = null;
      applied = null;
      instance = null;
    };
  });

  // actualizar cuando cambia la opción
  $effect(() => {
    if (chart && option && option !== applied) {
      // con replaceMerge la nueva opción puede ELIMINAR series (p.ej. ocultar
      // una línea al clicarla). Si el puntero está sobre el gráfico, echarts
      // reprograma el tooltip tras el render con el `_lastDataByCoordSys`
      // cacheado —índices de series de la opción anterior— y en TooltipView
      // hace `ecModel.getSeriesByIndex(i).getDataParams(...)` sin comprobar
      // el undefined: TypeError en código minificado y sin frames nuestros.
      // `hideTip` limpia ese cache (_lastX/_lastY/_lastDataByCoordSys) y el
      // render posterior ya no intenta restaurar el tooltip.
      if (replaceMerge) chart.dispatchAction({ type: 'hideTip' });
      chart.setOption(option, replaceMerge ? { replaceMerge } : undefined);
      applied = option;
    }
  });
</script>

<div bind:this={container} style="width: 100%; height: {height};"></div>
