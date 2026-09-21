import type { TrackInfo } from './entities.js';

export interface HistoryItem {
  id: number;
  playedAt: string;
  contextType: string | null;
  track: TrackInfo | null;
  // marca de presentación para los plays que el servidor da por pendientes
  // (PendingPlay): la fila todavía no existe, así que no tiene id ni se puede
  // editar ni borrar. `/stats/history` no la manda nunca — la pone el cliente
  // al convertir un pendiente en fila pintable
  pending?: boolean;
}

export interface HistoryResponse {
  items: HistoryItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
