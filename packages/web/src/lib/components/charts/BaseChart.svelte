<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';
  import { BarChart, LineChart, HeatmapChart, PieChart, RadarChart } from 'echarts/charts';
  import {
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    CalendarComponent,
    RadarComponent as RadarComp,
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
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    CalendarComponent,
    RadarComp,
  ]);

  interface Props {
    option: EChartsOption;
    height?: string;
  }

  let { option, height = '300px' }: Props = $props();
  let container = $state<HTMLElement | null>(null);
  let chart: echarts.ECharts | null = null;

  // tema oscuro consistente con el CSS
  const darkTheme = {
    backgroundColor: 'transparent',
    textStyle: { color: '#888' },
    title: { textStyle: { color: '#e5e5e5' } },
    legend: { textStyle: { color: '#888' } },
    tooltip: {
      backgroundColor: '#1a1a1a',
      borderColor: '#2a2a2a',
      textStyle: { color: '#e5e5e5' },
    },
  };

  onMount(() => {
    if (!container) return;

    chart = echarts.init(container, darkTheme);
    chart.setOption(option);

    const resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart?.dispose();
      chart = null;
    };
  });

  // actualizar cuando cambia la opción
  $effect(() => {
    if (chart && option) {
      chart.setOption(option, { notMerge: true });
    }
  });
</script>

<div bind:this={container} style="width: 100%; height: {height};"></div>
