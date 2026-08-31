export interface ChartEntry {
  rank: number;
  entityId: string;
  name: string;
  imageUrl: string | null;
  artistName: string | null;
  artistId: string | null;
  // todos los artistas del track (el primero es el principal); vacío para charts de artistas
  artists: { id: string; name: string }[];
  plays: number;
  totalMs: number;
  previousRank: number | null;
  rankChange: number | null;
  isNew: boolean;
  isReentry: boolean;
  peakRank: number;
  peakPeriod: string;
  peakPeriods: string[];
  timesAtPeak: number;
  weeksOnChart: number;
  consecutiveWeeks: number;
}

export interface DropoutEntry {
  entityId: string;
  name: string;
  imageUrl: string | null;
  artistName: string | null;
  artistId: string | null;
  artists: { id: string; name: string }[];
  previousRank: number;
  peakRank: number;
  peakPeriod: string;
  weeksOnChart: number;
}

export interface ChartResponse {
  period: string;
  entries: ChartEntry[];
  dropouts: DropoutEntry[];
}

export interface RankingHistoryPoint {
  period: string;
  rank: number;
}

export interface CrossoverEntity {
  id: string;
  name: string;
  imageUrl: string | null;
  artistName: string | null;
}

export interface RankingCrossovers {
  surpassedBy: CrossoverEntity[];
  surpassed: CrossoverEntity[];
}

export interface RankingHistoryPointWithCrossovers {
  period: string;
  rank: number;
  crossovers?: RankingCrossovers;
}

export interface ChartHistoryResponse {
  currentRank: number | null;
  currentPeriod: string;
  peakRank: number;
  peakPeriod: string;
  peakPeriods: string[];
  timesAtPeak: number;
  weeksOnChart: number;
  history: { period: string; rank: number | null }[];
}

/** Stats de trayectoria en chart de una entidad (carga diferida sobre ChartEntry). */
export interface ChartPeakStats {
  peakRank: number;
  peakPeriod: string;
  peakPeriods: string[];
  timesAtPeak: number;
  weeksOnChart: number;
  consecutiveWeeks: number;
  isReentry: boolean;
}

/** Una línea del stream NDJSON de /stats/charts/peaks/stream. */
export interface ChartPeak extends ChartPeakStats {
  entityId: string;
}
