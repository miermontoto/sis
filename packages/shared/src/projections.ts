import type { EntityType } from './settings.js';

export interface RankProjection {
  range: string;
  currentRank: number;
  projectedRank: number;
  delta: number;
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
}
