import type { TrackInfo } from './entities.js';

// procedencias de un play (`listening_history.source`), tal y como las filtra /history.
// NULL (filas anteriores a la columna) cuenta como spotify
export const HISTORY_SOURCES = ['spotify', 'lastfm', 'listenbrainz', 'import', 'manual'] as const;
export type HistorySource = typeof HISTORY_SOURCES[number];

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
