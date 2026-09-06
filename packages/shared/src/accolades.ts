import type { TrackRecords, ArtistRecordsData } from './records.js';

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

// tipo de accolade → lista de RecordsResponse en la que aparece. La API recorre
// esta tabla para construir los accolades de una entidad y el cliente enlaza cada
// uno con su sección de /records (el id de la sección es la clave), así que ancla
// y payload no pueden desalinearse. Los year-end van aparte: no tienen sección
type RecordListKey = Exclude<keyof TrackRecords | keyof ArtistRecordsData, 'yearEndFinishes' | 'mostUniquePerMonth'>;
export const ACCOLADE_RECORD_KEYS = {
  peakWeek: 'peakWeekPlays',
  dominance: 'dominance',
  biggestDebut: 'biggestDebuts',
  weeksAtNo1: 'mostWeeksAtNo1',
  bubblingUnder: 'bubblingUnder',
  weeksInChart: 'mostWeeksInTop5',
  longestRun: 'longestChartRun',
  inMostPlaylists: 'inMostPlaylists',
  longestGap: 'longestGap',
  goldenOldies: 'goldenOldies',
  latestDiscoveries: 'latestDiscoveries',
  mostAccolades: 'mostAccolades',
  mostNo1Tracks: 'mostNo1Tracks',
  mostNo1Albums: 'mostNo1Albums',
  mostDistinctTracks: 'mostDistinctTracks',
  oneHitWonders: 'oneHitWonders',
  mostConcerts: 'mostConcerts',
  mostHeardLive: 'mostHeardLive',
} as const satisfies Record<string, RecordListKey>;

// records cuyo valor se midió dentro de la semana que traen en `week`: son los
// que tienen un "cuándo" que enseñar. bubblingUnder también trae semana, pero
// es la del pico y su valor es el total all-time
export const WEEK_SCOPED_ACCOLADES: ReadonlySet<string> = new Set(['peakWeek', 'dominance', 'biggestDebut']);
