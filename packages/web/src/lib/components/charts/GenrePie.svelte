<script lang="ts">
  // dona de distribución de géneros: insights, dashboard y detalle de playlist
  // pintan la misma serie `pie`, así que vive aquí y no tres veces inline
  import BaseChart from './BaseChart.svelte';
  import { PIE_TOOLTIP, PIE_COLORS, AXIS_LABEL } from '$lib/utils/chart';
  import type { GenreItem } from '$lib/api';
  import type { EChartsOption } from 'echarts';

  interface Props {
    genres: GenreItem[];
    height?: string;
    /** unidad de la cifra en el tooltip ('plays'); vacío = sólo el número */
    unit?: string;
    /** en el rail no caben las etiquetas fuera de la dona: los nombres a la leyenda */
    compact?: boolean;
  }

  let { genres, height = '220px', unit = '', compact = false }: Props = $props();

  // el borde entre porciones es del color del fondo de la card, no una línea
  const CARD_BG = '#0f1214';
  const RADIUS = ['40%', '70%'];
  // en compacto la dona sube para dejarle la banda de abajo a la leyenda
  const COMPACT_CENTER = ['50%', '36%'];
  const COMPACT_RADIUS = ['42%', '70%'];
  const LEGEND_ICON_SIZE = 8;

  let option = $derived<EChartsOption>({
    tooltip: { ...PIE_TOOLTIP, formatter: `{b}: {c}${unit ? ` ${unit}` : ''} ({d}%)` },
    ...(compact
      ? {
          legend: {
            bottom: 0,
            left: 'center',
            icon: 'circle',
            itemWidth: LEGEND_ICON_SIZE,
            itemHeight: LEGEND_ICON_SIZE,
            itemGap: LEGEND_ICON_SIZE,
            textStyle: { ...AXIS_LABEL, fontSize: 10 },
          },
        }
      : {}),
    series: [{
      type: 'pie',
      // en compacto la dona sube y engorda: sin etiquetas fuera sobra sitio
      radius: compact ? COMPACT_RADIUS : RADIUS,
      ...(compact ? { center: COMPACT_CENTER, label: { show: false }, labelLine: { show: false } } : { label: { ...AXIS_LABEL } }),
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 2, borderColor: CARD_BG, borderWidth: 2 },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
      data: genres.map((g, i) => ({
        name: g.genre,
        value: g.play_count,
        itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] },
      })),
    }],
  });
</script>

<BaseChart {option} {height} />
