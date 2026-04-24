export interface Accolade {
  type: string;
  rank: number;
  value: number;
  week: string | null;
  // sólo para year-end finishes: año al que pertenece el ranking
  year?: number | null;
}

import type { RankingMetric } from './settings.js';

export interface AccoladesResponse {
  metric: RankingMetric;
  accolades: Accolade[];
}
