export interface Accolade {
  type: string;
  rank: number;
  value: number;
  week: string | null;
}

export interface AccoladesResponse {
  metric: 'plays' | 'time';
  accolades: Accolade[];
}
