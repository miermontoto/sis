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

  let option = $derived<EChartsOption>({
    polar: { radius: ['18%', '80%'] },
    radiusAxis: { axisLabel: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#1e2a2a' } } },
    angleAxis: {
      type: 'category',
      data: labels,
      // la primera categoría centrada arriba, como las 12 de un reloj
      startAngle: TOP_ANGLE + HALF_TURN / labels.length,
      axisLabel: { ...AXIS_LABEL, fontSize: 10, interval: (idx: number) => idx % labelEvery === 0 },
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

<BaseChart {option} {height} />
