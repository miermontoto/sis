export interface ChartEntry {
  rank: number;
  entityId: string;
  name: string;
  imageUrl: string | null;
  artistName: string | null;
  artistId: string | null;
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
