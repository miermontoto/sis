// entidades base
export type { TrackInfo, FormattedArtist, FormattedAlbum } from './entities.js';

// top-* items
export type { TopTrackItem, TopArtistItem, TopAlbumItem } from './top.js';

// estadísticas
export type { ListeningTimeItem, HeatmapItem, StreaksData, GenreItem, DiscoveryItem, MonthlyDistributionItem } from './stats.js';

// historial
export type { HistoryItem, HistoryResponse } from './history.js';

// now playing
export type { NowPlayingResponse, SpotifyDevice, DevicesResponse, PlayContextRequest, PlayContextResponse } from './now-playing.js';

// configuración
export type { RankingMetric, WeekStartOption, Granularity, EntityType, DateRangeParams, LocaleSetting, RankChangeLookback, AlbumTrackDisplay, SessionRankDisplay, NowPlayingDisplay } from './settings.js';
export { LOCALE_OPTIONS } from './settings.js';

// detalle de entidades
export type { Rankings, ArtistDetail, AlbumDetail, AlbumCover, TrackDetail } from './detail.js';

// charts
export type { ChartEntry, DropoutEntry, ChartResponse, RankingHistoryPoint, RankingHistoryPointWithCrossovers, CrossoverEntity, RankingCrossovers, ChartHistoryResponse } from './charts.js';

// records
export type { RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData, RecordsResponse, PlaylistPresenceItem, MonthCountEntry, YearEndFinish } from './records.js';

// accolades
export type { Accolade, AccoladesResponse } from './accolades.js';

// búsqueda
export type { SearchResults } from './search.js';

// playlists
export type { PlaylistStrategy, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse, LibraryPlaylist, LibraryPlaylistListResponse, LibraryPlaylistTrack, LibraryPlaylistDetail } from './playlists.js';

// merge
export type { MergeRule, MergeSuggestion } from './merge.js';

// proyecciones de ranking
export type { RankProjection, ProjectionResult, ProjectedRankingsResponse } from './projections.js';

// usuarios
export type { MeResponse, UserRecord, ImportResult, HealthData } from './users.js';
