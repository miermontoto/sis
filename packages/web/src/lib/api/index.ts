// Barrel re-export del módulo api/, dividido en:
// - types: re-exports de DTOs desde @sis/shared (single source of truth)
// - client: fetch/cache/invalidation (apiFetch, apiMutate, createFetchController, invalidateCache)
// - settings: storage de preferencias de usuario sync con server + localStorage
// - endpoints: el objeto `api` con todos los métodos por endpoint

// --- DTOs re-exportados desde @sis/shared (consumers usan import type { X } from '$lib/api') ---
export type {
  TrackInfo, FormattedArtist, FormattedAlbum,
  TopTrackItem, TopArtistItem, TopAlbumItem,
  RankingMetric, WeekStartOption, Granularity, EntityType, DateRangeParams, LocaleSetting,
  RankChangeLookback, AlbumTrackDisplay, SessionTrackingDisplay, SessionRankDisplay,
  NowPlayingDisplay, SocialVisibility,
  HistoryItem, HistoryResponse,
  NowPlayingResponse, SpotifyDevice, DevicesResponse, PlayContextRequest, PlayContextResponse,
  FriendActivity, FriendsActivityResponse,
  ListeningTimeItem, HeatmapItem, StreaksData, GenreItem, DiscoveryItem, MonthlyDistributionItem,
  HealthData, MeResponse, UserRecord, ImportResult, LastfmStatus,
  PlaylistStrategy, RegenerateInterval, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylist, LibraryPlaylistListResponse, LibraryPlaylistTrack, LibraryPlaylistDetail,
  SearchResults,
  ArtistDetail, AlbumDetail, AlbumCover, TrackDetail, Rankings,
  ChartEntry, DropoutEntry, ChartResponse, ChartHistoryResponse, RankingHistoryPoint, RankingHistoryPointWithCrossovers,
  RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData,
  RecordsResponse, PlaylistPresenceItem, MonthCountEntry,
  Accolade, AccoladesResponse,
  MergeRule, MergeSuggestion, AlbumMergePreview, AlbumMergeMatch, AlbumMergeTrack, AlbumMergeResult, MergeImpact, MergeImpactItem, RemergeConfidence, RemergePreview, RemergePreviewPair, BulkRemergeAlbum, BulkRemergePreview, MakeCanonicalResult, BatchMergeResult,
  RelatedArtist, ArtistRelationRule,
  ProjectedRankingsResponse, ProjectionResult, RankProjection,
  ProfileSummary, SocialNowPlaying, ProfileResponse, SharedRankedItem, StreaksSummary, CompareResponse,
  DirectoryUser, DirectoryResponse, FollowUser, FollowListResponse, FeedItem, FeedPlayItem, FeedResponse,
  ShareLink, ShareLinkListResponse, CreateShareLinkRequest, TimeRange,
} from '@sis/shared';
export { LOCALE_OPTIONS } from '@sis/shared';

// --- client / settings / endpoints ---
export { API_BASE, apiFetch, apiMutate, publicFetch, PublicShareError, rangeParams, createFetchController, invalidateCache } from './client.js';
export {
  loadSettings, getLocale, setLastPeriod,
  getRankingMetric, setRankingMetric,
  getRankChangeLookback, setRankChangeLookback,
  getWeekStart, setWeekStart,
  getRecordsUnique, setRecordsUnique,
  getRawLocale, setLocale,
  getAlbumTrackDisplay, setAlbumTrackDisplay,
  getAlbumShowDuration, setAlbumShowDuration,
  getAlbumShowAccolades, setAlbumShowAccolades,
  getArtistShowAlbumAccolades, setArtistShowAlbumAccolades,
  getArtistShowTrackAccolades, setArtistShowTrackAccolades,
  getSocialVisibility, setSocialVisibility,
  getNotificationsEnabled, setNotificationsEnabled,
  getNotifyRecords, setNotifyRecords,
  getNotifyNumberOne, setNotifyNumberOne,
  getNotifyChartClosings, setNotifyChartClosings,
  getNotifyBiggestDebut, setNotifyBiggestDebut,
  getSessionRankDisplay, setSessionRankDisplay, onSessionRankDisplayChange,
  getSessionRankLimitYear, setSessionRankLimitYear,
  getSessionRankLimitAll, setSessionRankLimitAll,
  getSessionTrackingDisplay, setSessionTrackingDisplay, onSessionTrackingDisplayChange,
  getNowPlayingDisplay, setNowPlayingDisplay, onNowPlayingDisplayChange,
  getSidebarCollapsed, setSidebarCollapsed, onSidebarCollapsedChange,
} from './settings.js';
export { api, listLoginSessions, logoutOtherSessions, type SessionInfo } from './endpoints.js';
