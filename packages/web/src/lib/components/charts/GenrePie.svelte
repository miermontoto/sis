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
  }

  let { genres, height = '220px', unit = '' }: Props = $props();

  // el borde entre porciones es del color del fondo de la card, no una línea
  const CARD_BG = '#0f1214';
  // el radio en % es sobre el lado menor, que en estas cards siempre es el alto:
  // el anillo salía igual de gordo en el rail (400px) que en insights (800px) y
  // echarts recortaba los nombres con puntos suspensivos. se mide el ancho y el
  // anillo cede lo que haga falta, así que la banda de etiquetas no se estrecha
  const HEIGHT_FRACTION = 0.35;
  const WIDTH_FRACTION = 0.13;
  // proporción del agujero, la de los radios originales (40% / 70%)
  const INNER_RATIO = 0.57;
  const FALLBACK_RADIUS = ['40%', '70%'];
  // por debajo de este ancho un género largo ("alternative metal", 17 caracteres)
  // no cabe a 11px y echarts lo recorta con puntos suspensivos; a 10px entra
  const NARROW_WIDTH = 520;
  const NARROW_LABEL_SIZE = 10;

  let width = $state(0);

  let radius = $derived.by(() => {
    if (!width) return FALLBACK_RADIUS; // antes del primer layout
    const outer = Math.min(parseFloat(height) * HEIGHT_FRACTION, width * WIDTH_FRACTION);
    return [outer * INNER_RATIO, outer];
  });

  let option = $derived<EChartsOption>({
    tooltip: { ...PIE_TOOLTIP, formatter: `{b}: {c}${unit ? ` ${unit}` : ''} ({d}%)` },
    series: [{
      type: 'pie',
      radius,
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 2, borderColor: CARD_BG, borderWidth: 2 },
      label: { ...AXIS_LABEL, ...(width && width < NARROW_WIDTH ? { fontSize: NARROW_LABEL_SIZE } : {}) },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
      data: genres.map((g, i) => ({
        name: g.genre,
        value: g.play_count,
        itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] },
      })),
    }],
  });
</script>

<div bind:clientWidth={width}>
  <BaseChart {option} {height} />
</div>
