import type { EntityType } from './settings.js';
import type { CrossoverEntity } from './charts.js';

export interface RankProjection {
  range: string;
  currentRank: number;
  projectedRank: number;
  delta: number;
  displaced: CrossoverEntity[];
}

export interface ProjectionResult {
  entityId: string;
  entityType: EntityType;
  entityName: string;
  imageUrl: string | null;
  changes: RankProjection[];
}

export interface ProjectedRankingsResponse {
  nowPlaying: ProjectionResult[];
  session: ProjectionResult[];
  sessionTrackCount: number;
  sessionTotalMs: number;
  sessionStartedAt: string | null;
}

// --- cambios de posición recientes (permanentes, no ligados a la sesión) ---

// un cambio de rank en un rango: comparación del ranking actual contra el ranking
// tal y como estaba hace N días (recomputado desde listening_history, sin snapshots).
// solo subidas (mismo diseño que las proyecciones de sesión): delta > 0 o entrada nueva
export interface RecentRankChange {
  range: string; // 'thisYear' | 'all'
  previousRank: number | null; // null = entrada nueva (sin plays antes del cutoff)
  currentRank: number;
  delta: number | null; // previousRank - currentRank; null si es entrada nueva
  displaced: CrossoverEntity[]; // entidades adelantadas en la ventana
}

export interface RecentRankChangeItem {
  entityId: string;
  entityType: EntityType;
  name: string;
  imageUrl: string | null;
  artistName: string | null;
  changes: RecentRankChange[];
}

export interface RecentRankChangesResponse {
  days: number;
  items: RecentRankChangeItem[];
}
