// entidades base
export type { TrackInfo, FormattedArtist, FormattedAlbum } from './entities.js';

// top-* items
export type { TopTrackItem, TopArtistItem, TopAlbumItem } from './top.js';

// estadísticas
export type { ListeningTimeItem, HeatmapItem, StreaksData, GenreItem, DiscoveryItem, MonthlyDistributionItem } from './stats.js';

// historial
export type { HistoryItem, HistoryResponse } from './history.js';

// now playing
export type { NowPlayingResponse, SpotifyDevice, DevicesResponse, PlayContextRequest, PlayContextResponse, FriendActivity, FriendsActivityResponse } from './now-playing.js';

// configuración
export type { RankingMetric, WeekStartOption, Granularity, EntityType, DateRangeParams, LocaleSetting, RankChangeLookback, AlbumTrackDisplay, SessionTrackingDisplay, SessionRankDisplay, NowPlayingDisplay, SocialVisibility } from './settings.js';
export { LOCALE_OPTIONS } from './settings.js';

// constantes compartidas
export { MIN_PLAY_MS, TIME_RANGES, CHART_SIZE, RECORDS_LIMIT } from './constants.js';
export type { TimeRange } from './constants.js';

// detalle de entidades
export type { Rankings, ArtistDetail, AlbumDetail, AlbumCover, TrackDetail, ReleaseEvent } from './detail.js';

export type { TrackVersion } from './versions.js';

// notificaciones push
export type { NotificationType, DevicePlatform, PushPayload, DeviceTokenRecord, NotificationPreferences } from './notifications.js';

// charts
export type { ChartEntry, DropoutEntry, ChartResponse, RankingHistoryPoint, RankingHistoryPointWithCrossovers, CrossoverEntity, RankingCrossovers, ChartHistoryResponse } from './charts.js';

// records
export type { RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData, RecordsResponse, PlaylistPresenceItem, MonthCountEntry, YearEndFinish } from './records.js';

// accolades
export type { Accolade, AccoladesResponse } from './accolades.js';

// búsqueda
export type { SearchResults } from './search.js';

// playlists
export type { PlaylistStrategy, RegenerateInterval, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse, LibraryPlaylist, LibraryPlaylistListResponse, LibraryPlaylistTrack, LibraryPlaylistDetail } from './playlists.js';

// merge
export type { MergeRule, MergeSuggestion, AlbumMergePreview, AlbumMergeResult, AlbumMergeTrack, AlbumMergeMatch, RemergePreview, RemergePreviewPair, BatchMergeResult } from './merge.js';

// proyecciones de ranking
export type { RankProjection, ProjectionResult, ProjectedRankingsResponse } from './projections.js';

// usuarios
export type { MeResponse, UserRecord, ImportResult, HealthData, LastfmStatus, LastfmBackfillProgress } from './users.js';

// social: perfiles, follows, feed, share links, compare
export type { ProfileSummary, SocialNowPlaying, ProfileResponse, SharedRankedItem, StreaksSummary, CompareResponse, DirectoryUser, DirectoryResponse, FollowUser, FollowListResponse, FeedItem, FeedPlayItem, FeedResponse, ShareLink, ShareLinkListResponse, CreateShareLinkRequest } from './social.js';
export { SHARE_TOKEN_BYTES, COMPARE_TOP_LIMIT, PROFILE_TOP_LIMIT, FEED_RECENT_DAYS, FEED_PLAYS_LIMIT, SOCIAL_OVERLAP_WEIGHT_DECAY, OVERLAP_TYPE_WEIGHTS } from './constants.js';
