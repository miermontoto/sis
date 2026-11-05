import type { Accolade, RankingMetric } from '$lib/api';
import { formatDuration, formatNumber } from './format';

// cómo se nombra y se cifra un record: lo comparten el popover del hero y la comparación
// de artistas, que tienen que llamar igual a lo mismo

const LABELS: Record<string, string> = {
  peakWeek: 'Peak week',
  dominance: 'Dominance',
  biggestDebut: 'Biggest debut',
  weeksAtNo1: 'Weeks at #1',
  bubblingUnder: 'Bubbling under',
  weeksInChart: 'Weeks in charts',
  longestRun: 'Longest chart run',
  avgYearFinish: 'Avg year-end finish',
  mostNo1Tracks: '#1 tracks',
  mostNo1Albums: '#1 albums',
  inMostPlaylists: 'In most playlists',
  longestGap: 'Longest gap',
  goldenOldies: 'Golden oldie',
  latestDiscoveries: 'Latest discovery',
  mostDistinctTracks: 'Distinct tracks',
  oneHitWonders: 'One-hit wonder',
  mostAccolades: 'Most records',
  mostConcerts: 'Seen live',
  mostHeardLive: 'Heard live',
};

const YEAR_END = 'yearEnd';

/** identidad de un record dentro de una entidad: cada año de year-end es uno distinto */
export const accoladeKey = (a: Accolade) => (a.type === YEAR_END ? `${YEAR_END}:${a.year}` : a.type);

export function accoladeLabel(a: Accolade): string {
  if (a.type === YEAR_END && a.year != null) return `${a.year} year-end`;
  return LABELS[a.type] ?? a.type;
}

export function accoladeMedal(rank: number): string {
  if (rank === 1) return '\u{1F947}';
  if (rank === 2) return '\u{1F948}';
  if (rank === 3) return '\u{1F949}';
  return `#${rank}`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n !== 1 ? 's' : ''}`;

export function formatAccoladeValue(a: Accolade, metric: RankingMetric): string {
  if (a.type === 'inMostPlaylists') return plural(a.value, 'playlist');
  if (a.type === 'weeksAtNo1' || a.type === 'weeksInChart' || a.type === 'longestRun') return plural(a.value, 'wk');
  if (a.type === 'mostNo1Tracks' || a.type === 'mostNo1Albums' || a.type === 'mostAccolades') return String(a.value);
  if (a.type === 'longestGap') return `${formatNumber(a.value)} day${a.value !== 1 ? 's' : ''}`;
  if (a.type === 'dominance') return `${a.value.toFixed(1)}%`;
  if (a.type === 'avgYearFinish') return `avg #${a.value.toFixed(1)}`;
  if (a.type === 'mostDistinctTracks') return plural(a.value, 'track');
  if (a.type === 'mostConcerts' || a.type === 'mostHeardLive') return plural(a.value, 'show');
  if (a.type === 'goldenOldies' || a.type === 'latestDiscoveries' || a.type === 'oneHitWonders') {
    return `${formatNumber(a.value)} plays`;
  }
  if (metric === 'plays') return `${formatNumber(a.value)} plays`;
  return formatDuration(a.value);
}

/** puesto + cifra de una celda de la comparación. Un year-end no tiene más cifra que su puesto */
export const accoladeValue = (a: Accolade, metric: RankingMetric) =>
  a.type === YEAR_END ? accoladeMedal(a.rank) : `${accoladeMedal(a.rank)} ${formatAccoladeValue(a, metric)}`;
