export interface Accolade {
  type: string;
  rank: number;
  value: number;
  week: string | null;
}

import type { RankingMetric } from './settings.js';

export interface AccoladesResponse {
  metric: RankingMetric;
  accolades: Accolade[];
}
