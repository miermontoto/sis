<script lang="ts">
  // dona de distribución de géneros: insights, dashboard y detalle de playlist
  // pintan la misma serie `pie`, así que vive aquí y no tres veces inline
  import BaseChart from './BaseChart.svelte';
  import { PIE_TOOLTIP, PIE_COLORS, PIE_LABEL, PIE_LABEL_LINE, fitPieLabels } from '$lib/utils/chart';
  import { canvasColors } from '$lib/stores/theme.svelte';
  import type { GenreItem } from '$lib/api';
  import type { EChartsOption } from 'echarts';

  interface Props {
    genres: GenreItem[];
    height?: string;
    /** unidad de la cifra en el tooltip ('plays'); vacío = sólo el número */
    unit?: string;
  }

  let { genres, height = '220px', unit = '' }: Props = $props();

  // el radio en % es sobre el lado menor, que en estas cards siempre es el alto:
  // el anillo salía igual de gordo en el rail (400px) que en insights (800px) y
  // echarts recortaba los nombres con puntos suspensivos. Después fue una banda
  // fija de 150px por lado para las etiquetas, que en un móvil dejaba el anillo
  // en 23px de radio aunque los géneros fueran cortos. Ahora se miden las
  // etiquetas y el anillo es el mayor que las deja enteras (ver fitPieLabels)
  // proporción del agujero, la de los radios originales (40% / 70%)
  const INNER_RATIO = 0.57;
  const FALLBACK_RADIUS = ['40%', '70%'];

  let width = $state(0);

  let slices = $derived(genres.map((g) => ({ name: g.genre, value: g.play_count })));
  // antes del primer layout no hay ancho que repartir
  let fit = $derived(width ? fitPieLabels(slices, width, parseFloat(height)) : null);

  let option = $derived<EChartsOption>({
    tooltip: { ...PIE_TOOLTIP, formatter: `{b}: {c}${unit ? ` ${unit}` : ''} ({d}%)` },
    series: [{
      type: 'pie',
      radius: fit ? [fit.outer * INNER_RATIO, fit.outer] : FALLBACK_RADIUS,
      center: [fit?.cx ?? '50%', '50%'],
      avoidLabelOverlap: true,
      // el borde entre porciones es del color del fondo de la card, no una línea
      itemStyle: { borderRadius: 2, borderColor: canvasColors().card, borderWidth: 2 },
      label: { ...PIE_LABEL, ...(fit ? { fontSize: fit.fontSize } : {}) },
      labelLine: PIE_LABEL_LINE,
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
      data: slices.map((s, i) => ({ ...s, itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] } })),
    }],
  });
</script>

<div bind:clientWidth={width}>
  <BaseChart {option} {height} />
</div>
