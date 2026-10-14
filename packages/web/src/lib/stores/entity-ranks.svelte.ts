import { api, createFetchController, getWeekStart, type ChartHistoryResponse, type EntityType, type Rankings, type RankingHistoryPointWithCrossovers, type RankingMetric } from '$lib/api';
import { attributionVersion } from './attribution';

const CHART_TYPE = { artist: 'artists', album: 'albums', track: 'tracks' } as const;

export interface EntityRanksSource {
  type: EntityType;
  id: string;
  metric: RankingMetric;
  // qué hay que pedir. false en un alias o un miembro de colección (sus posiciones son
  // las de otro), antes de tener el detalle, o si ninguna sección que lo pinta está visible
  ranks: boolean;
  chart: boolean;
}

// posiciones (7D/30D/YTD/All), historial mensual de ranking y trayectoria semanal en
// charts de UNA entidad. Lo leen tres secciones del detalle (ranking badges, chart stats
// y la timeline) y ninguna puede ser la dueña del fetch: cualquiera se oculta desde el
// editor de layout, y si la dueña era la oculta, la timeline se quedaba sin su línea.
// Se instancia en la inicialización de la página: los efectos viven con ella
export class EntityRanks {
  rankings = $state<Rankings | null>(null);
  history = $state<RankingHistoryPointWithCrossovers[]>([]);
  rankingsLoading = $state(true);
  chart = $state<ChartHistoryResponse | null>(null);
  chartLoading = $state(true);

  constructor(source: () => EntityRanksSource) {
    const rankCtrl = createFetchController();
    const chartCtrl = createFetchController();
    // entidad pintada: releer la MISMA (un merge o una colección mueven sus posiciones)
    // deja lo que hay hasta que llega la respuesta, en vez de volver al skeleton
    let rankShown = '';
    let chartShown = '';

    $effect(() => {
      const { type, id, metric, ranks } = source();
      void attributionVersion();
      if (!ranks) {
        rankCtrl.abort();
        rankShown = '';
        this.rankings = null;
        this.history = [];
        this.rankingsLoading = false;
        return;
      }
      const signal = rankCtrl.reset();
      if (id !== rankShown) {
        rankShown = id;
        this.rankings = null;
        this.history = [];
        this.rankingsLoading = true;
      }
      // una sola petición: posiciones e historial salen del mismo escaneo en el servidor
      api.rankingsWithHistory(type, id, metric, signal)
        .then(r => { if (!signal.aborted) { this.rankings = r.rankings; this.history = r.history; this.rankingsLoading = false; } })
        .catch(() => { if (!signal.aborted) { this.rankings = null; this.history = []; this.rankingsLoading = false; } });
      return () => rankCtrl.abort();
    });

    $effect(() => {
      const { type, id, metric, chart } = source();
      void attributionVersion();
      if (!chart) {
        chartCtrl.abort();
        chartShown = '';
        this.chart = null;
        this.chartLoading = false;
        return;
      }
      const signal = chartCtrl.reset();
      if (id !== chartShown) {
        chartShown = id;
        this.chart = null;
        this.chartLoading = true;
      }
      api.chartHistory(CHART_TYPE[type], id, getWeekStart(), metric, signal)
        .then(r => { if (!signal.aborted) { this.chart = r; this.chartLoading = false; } })
        .catch(() => { if (!signal.aborted) { this.chart = null; this.chartLoading = false; } });
      return () => chartCtrl.abort();
    });
  }
}
