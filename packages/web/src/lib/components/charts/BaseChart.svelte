<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts/core';
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
  ]);

  interface Props {
    option: EChartsOption;
    height?: string;
    onclick?: (params: any) => void;
    onmouseover?: (params: any) => void;
    onmouseout?: (params: any) => void;
    instance?: echarts.ECharts | null;
    replaceMerge?: string[];
  }

  let { option, height = '300px', onclick, onmouseover, onmouseout, instance = $bindable(null), replaceMerge }: Props = $props();
  let container = $state<HTMLElement | null>(null);
  let chart: echarts.ECharts | null = null;

  // tema oscuro consistente con el CSS
  const MONO_STACK = 'ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace';
  const darkTheme = {
    backgroundColor: 'transparent',
    textStyle: { color: '#6a7a7a', fontFamily: MONO_STACK },
    title: { textStyle: { color: '#e0e8e8' } },
    legend: { textStyle: { color: '#6a7a7a', fontFamily: MONO_STACK } },
    tooltip: {
      backgroundColor: '#0f1214',
      borderColor: '#1e2a2a',
      textStyle: { color: '#e0e8e8', fontFamily: MONO_STACK },
    },
  };

  onMount(() => {
    if (!container) return;

    chart = echarts.init(container, darkTheme);
    instance = chart;
    chart.setOption(option);
    if (onclick) chart.on('click', onclick);
    if (onmouseover) chart.on('mouseover', onmouseover);
    if (onmouseout) chart.on('mouseout', onmouseout);

    requestAnimationFrame(() => chart?.resize());

    const resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart?.dispose();
      chart = null;
      instance = null;
    };
  });

  // actualizar cuando cambia la opción
  $effect(() => {
    if (chart && option) {
      chart.setOption(option, replaceMerge ? { replaceMerge } : undefined);
    }
  });
</script>

<div bind:this={container} style="width: 100%; height: {height};"></div>
