// reports periódicos (semana / mes / año cerrados) estilo last.fm: un único DTO
// con todas las secciones, calculado de una vez por el servidor
import type { Granularity } from './settings.js';
import type { TrackInfo } from './entities.js';
import type { TopTrackItem, TopArtistItem, TopAlbumItem } from './top.js';
import type { ListeningTimeItem } from './stats.js';

export interface ReportPeriod {
  granularity: Granularity;
  period: string;
  /** límites [start, end) en ISO UTC, los mismos que etiquetan el chart del periodo */
  start: string;
  end: string;
  /** periodo cerrado inmediatamente anterior / siguiente (null = no hay o aún abierto) */
  prev: string | null;
  next: string | null;
}

export interface ReportSummary {
  plays: number;
  totalMs: number;
  distinctArtists: number;
  distinctTracks: number;
  distinctAlbums: number;
  /** días (UTC) con al menos un play */
  activeDays: number;
  /** longitud del periodo en días */
  days: number;
}

export interface ReportEntityRef {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface ReportPlayRef {
  playedAt: string;
  track: TrackInfo | null;
}

export interface ReportDayFact {
  /** YYYY-MM-DD (UTC, como los buckets diarios de los charts) */
  date: string;
  plays: number;
  totalMs: number;
}

export interface ReportFacts {
  busiestDay: ReportDayFact | null;
  /** hora local (0-23) con más plays; null sin plays */
  busiestHour: number | null;
  /** racha más larga de días consecutivos con plays dentro del periodo */
  longestStreak: number;
  firstPlay: ReportPlayRef | null;
  lastPlay: ReportPlayRef | null;
  /** % de plays que se llevó el track nº 1 */
  topTrackShare: number;
}

export interface ReportGenre {
  genre: string;
  plays: number;
  /** % de plays del periodo con este género (un play con varios géneros cuenta en todos) */
  pct: number;
  rankChange: number | null;
  isNew: boolean;
}

export interface ReportDecade {
  /** año de inicio de la década (1990, 2000…) */
  decade: number;
  plays: number;
  pct: number;
  topArtist: ReportEntityRef | null;
}

export interface ReportDiscoveryStat {
  /** entidades del periodo cuyo primer play de la historia cae dentro de él */
  newCount: number;
  totalCount: number;
  pct: number;
  /** plays que fueron a entidades nuevas y su % sobre el total del periodo */
  newPlays: number;
  playsPct: number;
}

export interface ReportDiscovery {
  artists: ReportDiscoveryStat;
  albums: ReportDiscoveryStat;
  tracks: ReportDiscoveryStat;
  /** artistas nuevos más escuchados */
  topNewArtists: (ReportEntityRef & { plays: number; totalMs: number })[];
}

export interface ReportMonth {
  /** YYYY-MM */
  month: string;
  plays: number;
  totalMs: number;
  topArtist: ReportEntityRef | null;
  topTrack: TrackInfo | null;
}

export interface ReportMilestone {
  /** play nº N de la historia del usuario (umbral de MILESTONE_THRESHOLDS) */
  n: number;
  playedAt: string;
  track: TrackInfo | null;
}

export interface ReportResponse {
  period: ReportPeriod;
  summary: ReportSummary;
  /** mismo resumen del periodo anterior, para los deltas (null si no existe) */
  previous: ReportSummary | null;
  facts: ReportFacts;
  /** plays por día (semana/mes) o por mes (año), buckets UTC sin rellenar huecos */
  series: ListeningTimeItem[];
  /** plays por hora local, 24 posiciones */
  clock: number[];
  /** plays por día de la semana (UTC), 7 posiciones empezando en domingo como strftime('%w') */
  weekdays: number[];
  top: {
    artists: TopArtistItem[];
    albums: TopAlbumItem[];
    tracks: TopTrackItem[];
  };
  genres: ReportGenre[];
  /** % de plays cuyo artista tiene géneros: la base sobre la que se leen los géneros */
  genreCoveragePct: number;
  decades: ReportDecade[];
  discovery: ReportDiscovery;
  /** solo en el report anual */
  months: ReportMonth[] | null;
  milestones: ReportMilestone[];
}
