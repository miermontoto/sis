export interface RecordEntry {
  entityId: string;
  name: string;
  imageUrl: string | null;
  artistId: string | null;
  artistName: string | null;
  value: number;
  week: string | null;
}

export interface ArtistRecordEntry {
  artistId: string;
  name: string;
  imageUrl: string | null;
  count: number;
}

export interface EntityRecords {
  peakWeekPlays: RecordEntry[];
  biggestDebuts: RecordEntry[];
  mostWeeksAtNo1: RecordEntry[];
  mostWeeksInTop5: RecordEntry[];
  longestChartRun: RecordEntry[];
  inMostPlaylists: RecordEntry[];
}

export interface ArtistRecordsData extends EntityRecords {
  mostNo1Tracks: ArtistRecordEntry[];
  mostNo1Albums: ArtistRecordEntry[];
}

export interface RecordsResponse {
  tracks: EntityRecords;
  albums: EntityRecords;
  artists: ArtistRecordsData;
}

export interface PlaylistPresenceItem {
  id: number;
  spotifyId: string;
  name: string;
  imageUrl: string | null;
}
