// entidades base
export type { TrackInfo, FormattedArtist, FormattedAlbum } from './entities.js';

// top-* items
export type { TopTrackItem, TopArtistItem, TopAlbumItem } from './top.js';

// estadísticas
export type { ListeningTimeItem, HeatmapItem, StreaksData, GenreItem } from './stats.js';

// historial
export type { HistoryItem, HistoryResponse } from './history.js';

// now playing
export type { NowPlayingResponse } from './now-playing.js';

// configuración
export type { RankingMetric, WeekStartOption, DateRangeParams } from './settings.js';

// detalle de entidades
export type { Rankings, ArtistDetail, AlbumDetail, TrackDetail } from './detail.js';

// charts
export type { ChartEntry, DropoutEntry, ChartResponse, RankingHistoryPoint, ChartHistoryResponse } from './charts.js';

// records
export type { RecordEntry, ArtistRecordEntry, EntityRecords, ArtistRecordsData, RecordsResponse, PlaylistPresenceItem } from './records.js';

// accolades
export type { Accolade, AccoladesResponse } from './accolades.js';

// búsqueda
export type { SearchResults } from './search.js';

// playlists
export type { PlaylistStrategy, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse, LibraryPlaylist, LibraryPlaylistListResponse, LibraryPlaylistTrack, LibraryPlaylistDetail } from './playlists.js';

// merge
export type { MergeRule, MergeSuggestionAlbum } from './merge.js';

// usuarios
export type { MeResponse, UserRecord, ImportResult, HealthData } from './users.js';
