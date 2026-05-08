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
