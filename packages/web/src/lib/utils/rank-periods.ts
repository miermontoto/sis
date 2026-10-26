import type { Rankings } from '$lib/api';

// los cuatro periodos de /stats/rankings, en el orden y con las etiquetas que
// pintan todas las vistas: de la ventana más corta a la más larga. week y month
// son ventanas rodantes de 7 y 30 días, no la semana ni el mes naturales, de ahí
// 7D/30D. Lo comparten los badges del detalle y la tarjeta de hover, que tenía su
// propia lista y la pintaba al revés
export interface RankPeriod {
  key: keyof Rankings;
  label: string;
}

export const RANK_PERIODS: readonly RankPeriod[] = [
  { key: 'week', label: '7D' },
  { key: 'month', label: '30D' },
  { key: 'thisYear', label: 'YTD' },
  { key: 'all', label: 'All' },
];
