import type { TrackInfo } from './entities.js';

export interface HistoryItem {
  id: number;
  playedAt: string;
  contextType: string | null;
  track: TrackInfo | null;
}

export interface HistoryResponse {
  items: HistoryItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
