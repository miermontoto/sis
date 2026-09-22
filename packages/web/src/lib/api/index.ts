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
  NowPlayingDisplay, SocialVisibility, ArtistBackdrop,
  HistoryItem, HistoryResponse,
  NowPlayingResponse, SpotifyDevice, DevicesResponse, PlayContextRequest, PlayContextResponse, PlaybackQueueItem, PlaybackQueueRef, PlaybackQueueResponse,
  FriendActivity, FriendsActivityResponse,
  ListeningTimeItem, HeatmapItem, StreaksData, GenreItem, DiscoveryItem, MonthlyDistributionItem,
  HealthData, MeResponse, UserRecord, ImportResult, LastfmStatus, MieridStatus, ListenTokenStatus,
  PlaylistStrategy, RegenerateInterval, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylist, LibraryPlaylistListResponse, LibraryPlaylistTrack, LibraryPlaylistDetail,
  SearchResults,
  ArtistDetail, AlbumDetail, AlbumCover, AlbumRating, TrackDetail, Rankings, EntityCard, EntityCardPoint,
  ChartEntry, DropoutEntry, ChartResponse, ChartPeak, ChartPeakStats, ChartHistoryResponse, RankingHistoryPoint, RankingHistoryPointWithCrossovers, CrossoverEntity,
  RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData,
  RecordsResponse, PlaylistPresenceItem, MonthCountEntry,
  Accolade, AccoladesResponse,
  MergeRule, MergeSuggestion, AlbumMergePreview, AlbumMergeMatch, AlbumMergeTrack, AlbumMergeResult, MergeImpact, MergeImpactItem, RemergeConfidence, RemergePreview, RemergePreviewPair, BulkRemergeAlbum, BulkRemergePreview, MakeCanonicalResult, BatchMergeResult,
  RelatedArtist, ArtistRelationRule, EntityRelation, RelationKind,
  ProjectedRankingsResponse, ProjectionResult, RankProjection,
  RecentRankChange, RecentRankChangeItem, RecentRankChangesResponse,
  ProfileSummary, SocialNowPlaying, ProfileResponse, SharedRankedItem, StreaksSummary, CompareResponse,
  DirectoryUser, DirectoryResponse, FollowUser, FollowListResponse, FeedItem, FeedPlayItem, FeedResponse,
  ShareLink, ShareLinkListResponse, CreateShareLinkRequest, TimeRange,
  Concert, ConcertSong, ConcertRef, ConcertStats, ConcertListResponse, ConcertInput, SetlistfmShow, SetlistfmSearchResponse,
  ReportResponse, ReportPeriod, ReportSummary, ReportFacts, ReportDayFact, ReportPlayRef, ReportEntityRef, ReportGenre, ReportDecade, ReportDiscovery, ReportDiscoveryStat, ReportNewPick, ReportMonth, ReportMilestone,
  AlbumCollectionSummary, CollectionDetail, CollectionMember, CollectionMemberType, CollectionRef, CollectionInput, CollectionConflict, CollectionCandidate, CollectionCandidates, CollectionIndexItem,
} from '@sis/shared';
export { LOCALE_OPTIONS, ALBUM_RATING_MIN, ALBUM_RATING_MAX, ALBUM_REVIEW_MAX_CHARS, CONCERT_TEXT_MAX_CHARS, CONCERT_NOTES_MAX_CHARS, CONCERT_YEAR_OPTIONS, SETLISTFM_AUTO_PAGES, ACCOLADE_RECORD_KEYS, WEEK_SCOPED_ACCOLADES, REPORT_TOP_LIMIT, REPORT_INDEX_HISTORY, COLLECTION_ID_PREFIX, collectionKey, isCollectionKey, parseCollectionKey, COLLECTION_NAME_MAX_CHARS, COLLECTION_NOTES_MAX_CHARS, COLLECTION_CANDIDATES_LIMIT } from '@sis/shared';

// --- client / settings / endpoints ---
export { apiBase, apiFetch, apiMutate, publicFetch, PublicShareError, rangeParams, createFetchController, invalidateCache } from './client.js';
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
  getArtistShowGlobalRanks, setArtistShowGlobalRanks,
  getAlbumShowGlobalRanks, setAlbumShowGlobalRanks,
  getShowPlaylistBadges, setShowPlaylistBadges,
  getArtistBackdrop, setArtistBackdrop,
  getSocialVisibility, setSocialVisibility,
  getNotificationsEnabled, setNotificationsEnabled,
  getNotifyRecords, setNotifyRecords,
  getNotifyNumberOne, setNotifyNumberOne,
  getNotifyChartClosings, setNotifyChartClosings,
  getNotifyAnniversaries, setNotifyAnniversaries,
  getNotifyMilestones, setNotifyMilestones,
  getSessionRankDisplay, setSessionRankDisplay, onSessionRankDisplayChange,
  getSessionRankLimitYear, setSessionRankLimitYear,
  getSessionRankLimitAll, setSessionRankLimitAll,
  getSessionTrackingDisplay, setSessionTrackingDisplay, onSessionTrackingDisplayChange,
  getNowPlayingDisplay, setNowPlayingDisplay, onNowPlayingDisplayChange,
  getNowPlayingUpNext, setNowPlayingUpNext, onNowPlayingUpNextChange,
  getSidebarCollapsed, setSidebarCollapsed, onSidebarCollapsedChange,
} from './settings.js';
export { api, listLoginSessions, logoutOtherSessions, type SessionInfo } from './endpoints.js';
