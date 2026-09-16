<script lang="ts">
  // barras polares (reloj de 24h, días de la semana): misma geometría que las de
  // Insights, con la posición punta resaltada y el resto atenuado
  import BaseChart from '$lib/components/charts/BaseChart.svelte';
  import { TOOLTIP_BASE, AXIS_LABEL, AXIS_LINE, GREEN, tooltipPoint, type TooltipParams } from '$lib/utils/chart';
  import type { EChartsOption } from 'echarts';

  let {
    values,
    labels,
    highlight = null,
    labelEvery = 1,
    height = '260px',
  }: {
    values: number[];
    labels: string[];
    /** índice resaltado (hora punta, día punta) */
    highlight?: number | null;
    /** pintar una etiqueta de cada N (24 horas no caben todas) */
    labelEvery?: number;
    height?: string;
  } = $props();

  const DIM_COLOR = 'rgba(29, 185, 84, 0.45)';
  const HALF_TURN = 180;
  const TOP_ANGLE = 90;
  const LABEL_SIZE = 10;
  // el radio en % es sobre el lado menor, que aquí es siempre el alto: en una
  // card estrecha el anillo seguía igual de grande y echarts recortaba las
  // etiquetas de las horas contra el borde ("18:00" salía ":00"). se mide el
  // ancho y el anillo cede lo que ocupen las etiquetas de los lados
  const OUTER_FRACTION = 0.8;
  const INNER_RATIO = 18 / 80; // la proporción del agujero original
  const FALLBACK_RADIUS = ['18%', '80%'];
  // la etiqueta de las 3 y las 9 arranca en el anillo y crece hacia afuera:
  // hay que reservarle su ancho entero (monospace) más el margen del eje
  const LABEL_MARGIN = 10;
  const MONO_CHAR_RATIO = 0.62;

  let width = $state(0);

  let radius = $derived.by(() => {
    if (!width) return FALLBACK_RADIUS; // antes del primer layout
    const labelRoom = LABEL_MARGIN + Math.max(...labels.map(l => l.length)) * LABEL_SIZE * MONO_CHAR_RATIO;
    const outer = Math.min(parseFloat(height) / 2 * OUTER_FRACTION, width / 2 - labelRoom);
    return [outer * INNER_RATIO, outer];
  });

  let option = $derived<EChartsOption>({
    polar: { radius },
    radiusAxis: { axisLabel: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#1e2a2a' } } },
    angleAxis: {
      type: 'category',
      data: labels,
      // la primera categoría centrada arriba, como las 12 de un reloj
      startAngle: TOP_ANGLE + HALF_TURN / labels.length,
      axisLabel: { ...AXIS_LABEL, fontSize: LABEL_SIZE, interval: (idx: number) => idx % labelEvery === 0 },
      axisLine: { ...AXIS_LINE },
    },
    tooltip: { ...TOOLTIP_BASE, trigger: 'item', formatter: (params: TooltipParams) => { const p = tooltipPoint(params); return `${p.name}<br/>Plays: <b>${p.value}</b>`; } },
    series: [{
      type: 'bar',
      coordinateSystem: 'polar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: i === highlight ? GREEN : DIM_COLOR } })),
      itemStyle: { borderRadius: 2 },
    }],
  });
</script>

<div bind:clientWidth={width}>
  <BaseChart {option} {height} />
</div>
