export interface RecordEntry {
  entityId: string;
  name: string;
  imageUrl: string | null;
  artistId: string | null;
  artistName: string | null;
  value: number;
  week: string | null;
  // campos opcionales para records extendidos
  date?: string | null;             // ISO date/datetime (first_play or last_play)
  endDate?: string | null;          // fecha final de un gap
  ongoing?: boolean | null;         // gap/streak en curso
  month?: string | null;            // YYYY-MM para records mensuales
  secondaryLabel?: string | null;   // etiqueta secundaria (ej. nombre del track dominante)
}

export interface ArtistRecordEntry {
  artistId: string;
  name: string;
  imageUrl: string | null;
  count: number;
}

// record a nivel de mes (no asociado a una entidad concreta)
export interface MonthCountEntry {
  month: string;  // YYYY-MM
  count: number;
  // top covers (albums + artistas) del mes, para mostrar un collage como fondo
  covers: string[];
}

// posición de una entidad en el top-10 de un año completo (para accolades)
export interface YearEndFinish {
  year: number;
  entityId: string;
  rank: number;
  value: number;
}

export interface EntityRecords {
  peakWeekPlays: RecordEntry[];
  biggestDebuts: RecordEntry[];
  mostWeeksAtNo1: RecordEntry[];
  mostWeeksInTop5: RecordEntry[];
  longestChartRun: RecordEntry[];
  inMostPlaylists: RecordEntry[];
  // --- longevidad ---
  longestGap: RecordEntry[];
  goldenOldies: RecordEntry[];
  // --- descubrimiento ---
  latestDiscoveries: RecordEntry[];
  // --- mensuales ---
  mostUniquePerMonth: MonthCountEntry[];
  // --- year-end finishes (top-10 por año completo) ---
  yearEndFinishes: YearEndFinish[];
  // --- meta: entidades con más records/accolades ---
  mostAccolades: RecordEntry[];
}

export type TrackRecords = EntityRecords;

export type AlbumRecords = EntityRecords;

export interface ArtistRecordsData extends EntityRecords {
  mostNo1Tracks: ArtistRecordEntry[];
  mostNo1Albums: ArtistRecordEntry[];
  mostDistinctTracks: RecordEntry[];
  oneHitWonders: RecordEntry[];
}

export interface RecordsResponse {
  tracks: TrackRecords;
  albums: AlbumRecords;
  artists: ArtistRecordsData;
}

export interface PlaylistPresenceItem {
  id: number;
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  isOwned: boolean;
}
