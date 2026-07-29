import type {
  RankingMetric, DateRangeParams,
  TopTrackItem, TopArtistItem, TopAlbumItem,
  GenreItem, DiscoveryItem, HistoryResponse, ListeningTimeItem, HeatmapItem, StreaksData, MonthlyDistributionItem,
  NowPlayingResponse, DevicesResponse, PlayContextRequest, PlayContextResponse, FriendsActivityResponse,
  ArtistDetail, AlbumDetail, TrackDetail,
  SearchResults, ChartHistoryResponse, ChartResponse, RecordsResponse,
  AccoladesResponse, Rankings, RankingHistoryPointWithCrossovers, HealthData, EntityType,
  MergeRule, MergeSuggestion, AlbumMergePreview, AlbumMergeResult, RemergePreview, BulkRemergePreview, MergeImpact, MakeCanonicalResult, BatchMergeResult, MeResponse, UserRecord, ImportResult, LastfmStatus,
  PlaylistStrategy, RegenerateInterval, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylistListResponse, LibraryPlaylistDetail,
  ProfileResponse, CompareResponse, DirectoryResponse, FollowListResponse, FeedResponse,
  ShareLink, ShareLinkListResponse, CreateShareLinkRequest, TimeRange,
} from '@sis/shared';
import { apiFetch, apiMutate, publicFetch, rangeParams, applyMutationInvalidation, API_BASE } from './client.js';

export const api = {
  nowPlaying: () => apiFetch<NowPlayingResponse>('/now-playing'),
  nowPlayingLive: () => apiFetch<NowPlayingResponse>('/now-playing/live'),
  friendsActivity: () => apiFetch<FriendsActivityResponse>('/now-playing/friends'),

  topTracks: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, lookback?: string, signal?: AbortSignal) =>
    apiFetch<TopTrackItem[]>('/stats/top-tracks', { ...rangeParams(range, dates), limit: String(limit), sort, ...(lookback && lookback !== 'disabled' ? { lookback } : {}) }, signal),

  topArtists: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, lookback?: string, signal?: AbortSignal) =>
    apiFetch<TopArtistItem[]>('/stats/top-artists', { ...rangeParams(range, dates), limit: String(limit), sort, ...(lookback && lookback !== 'disabled' ? { lookback } : {}) }, signal),

  topAlbums: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, lookback?: string, signal?: AbortSignal) =>
    apiFetch<TopAlbumItem[]>('/stats/top-albums', { ...rangeParams(range, dates), limit: String(limit), sort, ...(lookback && lookback !== 'disabled' ? { lookback } : {}) }, signal),

  topGenres: (range = 'month', limit = 20, dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<GenreItem[]>('/stats/top-genres', { ...rangeParams(range, dates), limit: String(limit) }, signal),

  history: (page = 1, limit = 50, filters?: { date?: string; album?: string; track?: string; artist?: string }, signal?: AbortSignal) => {
    const f = filters ?? {};
    // minutos al este de UTC (inverso del valor de getTimezoneOffset)
    const tz = -new Date().getTimezoneOffset();
    return apiFetch<HistoryResponse>('/stats/history', {
      page: String(page), limit: String(limit),
      tz: String(tz),
      ...(f.date ? { date: f.date } : {}),
      ...(f.album ? { album: f.album } : {}),
      ...(f.track ? { track: f.track } : {}),
      ...(f.artist ? { artist: f.artist } : {}),
    }, signal);
  },

  deleteHistory: (ids: number[]) =>
    apiMutate<{ deleted: number }>('DELETE', '/stats/history', { ids }),

  // scrobbles manuales: un track o un álbum entero (varios en un solo request)
  addScrobbles: (scrobbles: { trackId: string; playedAt: string; durationPlayedMs?: number }[]) =>
    apiMutate<{ inserted: number; total: number; duplicates: number }>('POST', '/stats/history', { scrobbles }),

  listeningTime: (range = 'month', granularity = 'day', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<ListeningTimeItem[]>('/stats/listening-time', { ...rangeParams(range, dates), granularity }, signal),

  discovery: (range = 'month', granularity = 'month', type = 'track', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<DiscoveryItem[]>('/stats/discovery', { ...rangeParams(range, dates), granularity, type }, signal),

  heatmap: (range = 'month', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<HeatmapItem[]>('/stats/heatmap', { ...rangeParams(range, dates) }, signal),

  monthlyDistribution: (range = 'month', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<MonthlyDistributionItem[]>('/stats/monthly-distribution', { ...rangeParams(range, dates) }, signal),

  streaks: (signal?: AbortSignal) => apiFetch<StreaksData>('/stats/streaks', undefined, signal),

  artistDetail: (id: string, range = 'all', opts?: { sort?: string; trackLimit?: number; albumLimit?: number; signal?: AbortSignal }) =>
    apiFetch<ArtistDetail>(`/stats/artist/${encodeURIComponent(id)}`, {
      range,
      ...(opts?.sort && { sort: opts.sort }),
      ...(opts?.trackLimit && { trackLimit: String(opts.trackLimit) }),
      ...(opts?.albumLimit && { albumLimit: String(opts.albumLimit) }),
    }, opts?.signal),

  albumDetail: (id: string, range = 'all', sort?: string, signal?: AbortSignal) =>
    apiFetch<AlbumDetail>(`/stats/album/${encodeURIComponent(id)}`, { range, ...(sort && { sort }) }, signal),

  trackDetail: (id: string, range = 'all', signal?: AbortSignal) =>
    apiFetch<TrackDetail>(`/stats/track/${encodeURIComponent(id)}`, { range }, signal),

  search: (q: string, limit = 5) =>
    apiFetch<SearchResults>('/stats/search', { q, limit: String(limit) }),

  chartHistory: (type: string, id: string, weekStart: string, sort: RankingMetric = 'time', signal?: AbortSignal) =>
    apiFetch<ChartHistoryResponse>(`/stats/chart-history/${type}/${encodeURIComponent(id)}`, { weekStart, sort }, signal),

  chartPeriods: (granularity: string, weekStart: string, signal?: AbortSignal) =>
    apiFetch<{ periods: string[] }>('/stats/charts/periods', { granularity, weekStart }, signal),

  chart: (type: string, granularity: string, period: string, weekStart: string, sort: RankingMetric = 'time', limit = 25, signal?: AbortSignal) =>
    apiFetch<ChartResponse>('/stats/charts', { type, granularity, period, weekStart, sort, limit: String(limit) }, signal),

  chartPeaks: (type: string, granularity: string, period: string, weekStart: string, sort: RankingMetric = 'time', ids: string[], signal?: AbortSignal) =>
    apiFetch<Record<string, { peakRank: number; peakPeriod: string; peakPeriods: string[]; timesAtPeak: number; weeksOnChart: number; consecutiveWeeks: number; isReentry: boolean }>>('/stats/charts/peaks', { type, granularity, period, weekStart, sort, ids: ids.join(',') }, signal),

  records: (weekStart = 'monday', sort: RankingMetric = 'time', type?: 'tracks' | 'albums' | 'artists', unique = true, signal?: AbortSignal) =>
    apiFetch<Partial<RecordsResponse>>('/stats/records', { weekStart, sort, unique: String(unique), ...(type && { type }) }, signal),

  playbackPlay: () => apiMutate<{ success: boolean }>('PUT', '/now-playing/play'),
  playbackPause: () => apiMutate<{ success: boolean }>('PUT', '/now-playing/pause'),
  playbackNext: () => apiMutate<{ success: boolean }>('POST', '/now-playing/next'),
  playbackPrevious: () => apiMutate<{ success: boolean }>('POST', '/now-playing/previous'),
  playbackPlayContext: (body: PlayContextRequest) =>
    apiMutate<PlayContextResponse>('PUT', '/now-playing/play-context', body),
  playbackDevices: () =>
    apiFetch<DevicesResponse>('/now-playing/devices'),
  playbackTransfer: (deviceId: string, play?: boolean) =>
    apiMutate<{ success: boolean }>('PUT', '/now-playing/device', { device_id: deviceId, play }),
  playbackSeek: (positionMs: number) =>
    apiMutate<{ success: boolean; position_ms: number }>('PUT', '/now-playing/seek', { position_ms: positionMs }),
  playbackVolume: (volumePercent: number) =>
    apiMutate<{ success: boolean; volume_percent: number }>('PUT', '/now-playing/volume', { volume_percent: volumePercent }),
  queueTrack: (trackId: string) =>
    apiMutate<{ success: boolean }>('POST', '/now-playing/queue', { uri: `spotify:track:${trackId}` }),

  trackPlaylists: (trackId: string) =>
    apiFetch<{ playlists: Array<{ id: number; spotifyId: string; name: string; imageUrl: string | null }> }>(`/now-playing/playlists/${encodeURIComponent(trackId)}`),
  checkTrackLiked: (trackId: string) =>
    apiFetch<{ isLiked: boolean }>(`/now-playing/like/${encodeURIComponent(trackId)}`),
  likeTrack: (trackId: string) =>
    apiMutate<{ success: boolean }>('PUT', `/now-playing/like/${encodeURIComponent(trackId)}`),
  unlikeTrack: (trackId: string) =>
    apiMutate<{ success: boolean }>('DELETE', `/now-playing/like/${encodeURIComponent(trackId)}`),

  accolades: (type: 'artist' | 'track' | 'album', id: string, signal?: AbortSignal) =>
    apiFetch<AccoladesResponse>(`/stats/accolades/${type}/${encodeURIComponent(id)}`, undefined, signal),

  rankings: (type: 'artist' | 'track' | 'album', id: string, sort: RankingMetric = 'time', signal?: AbortSignal) =>
    apiFetch<Rankings>(`/stats/rankings/${type}/${encodeURIComponent(id)}`, { sort }, signal),

  rankingHistory: (type: 'artist' | 'track' | 'album', id: string, sort: RankingMetric = 'time', signal?: AbortSignal) =>
    apiFetch<RankingHistoryPointWithCrossovers[]>(`/stats/ranking-history/${type}/${encodeURIComponent(id)}`, { sort, crossovers: 'true' }, signal),

  health: () => apiFetch<HealthData>('/health'),
  version: () => apiFetch<{ version: string }>('/version'),

  // merge API (genérico para albums/artists/tracks)
  createMerge: (entityType: string, sourceId: string, targetId: string) =>
    apiMutate<MergeRule>('POST', '/admin/merge', { entityType, sourceId, targetId }),

  deleteMerge: (id: number) =>
    apiMutate<{ success: boolean }>('DELETE', `/admin/merge/${id}`),

  // invierte la dirección: promueve la entidad a canónica de su grupo
  makeCanonical: (entityType: EntityType, entityId: string) =>
    apiMutate<MakeCanonicalResult>('POST', '/admin/merge-canonical', { entityType, entityId }),

  // impacto en el ranking all-time de unos merges aún no creados. Es POST porque el cuerpo
  // es la lista de pares, pero no muta nada: se usa rawMutate para saltarse la invalidación
  mergeImpact: (entityType: EntityType, pairs: { sourceId: string; targetId: string }[], metric: RankingMetric) =>
    apiMutate<MergeImpact>('POST', '/admin/merge-impact', { entityType, pairs, metric }, { invalidate: false }),

  listMerges: () => apiFetch<MergeRule[]>('/admin/merges'),

  // opts.parent — artistId (requerido para album/track, ignorado para artist)
  // opts.exclude — id a excluir (normalmente el propio target)
  albumMergePreview: (sourceId: string, targetId: string) =>
    apiFetch<AlbumMergePreview>('/admin/album-merge-preview', { source: sourceId, target: targetId }),

  mergeAlbum: (sourceAlbumId: string, targetAlbumId: string, trackPairs: Array<{ sourceTrackId: string; targetTrackId: string }>) =>
    apiMutate<AlbumMergeResult>('POST', '/admin/merge-album', { sourceAlbumId, targetAlbumId, trackPairs }),

  mergeSuggestions: (entityType: 'album' | 'artist' | 'track', opts: { parent?: string; exclude?: string } = {}) => {
    const params: Record<string, string> = { entityType };
    if (opts.parent) params.parent = opts.parent;
    if (opts.exclude) params.exclude = opts.exclude;
    return apiFetch<MergeSuggestion[]>('/admin/merge-suggestions', params);
  },

  albumRemergePreview: (albumId: string) =>
    apiFetch<RemergePreview>('/admin/album-remerge-preview', { album: albumId }),

  bulkRemergePreview: (scope: string) =>
    apiFetch<BulkRemergePreview>('/admin/bulk-remerge-preview', { scope }),

  batchMergeTracks: (trackPairs: Array<{ sourceTrackId: string; targetTrackId: string }>) =>
    apiMutate<BatchMergeResult>('POST', '/admin/batch-merge-tracks', { trackPairs }),

  // last.fm
  lastfmStatus: () => apiFetch<LastfmStatus>('/lastfm'),
  lastfmSync: () => apiMutate<{ ok: boolean; imported: number }>('POST', '/lastfm/sync'),
  lastfmBackfill: () => apiMutate<{ ok: boolean }>('POST', '/lastfm/backfill'),
  lastfmDisconnect: () => apiMutate<{ ok: boolean }>('DELETE', '/lastfm'),

  // user management (admin)
  me: () => apiFetch<MeResponse>('/me'),
  listUsers: () => apiFetch<UserRecord[]>('/admin/users'),
  addUser: (id: string, kind: 'spotify' | 'lastfm' = 'spotify') =>
    apiMutate<UserRecord>('POST', '/admin/users', kind === 'lastfm' ? { lastfmUsername: id } : { spotifyId: id }),
  updateUser: (id: number, fields: { isAdmin?: boolean; isActive?: boolean }) =>
    apiMutate<UserRecord>('PUT', `/admin/users/${id}`, fields),
  deleteUser: (id: number) => apiMutate<{ success: boolean }>('DELETE', `/admin/users/${id}`),
  updateTrackDuration: (trackId: string, durationMs: number) =>
    apiMutate<{ success: boolean; durationMs: number }>('PATCH', `/admin/track/${encodeURIComponent(trackId)}`, { durationMs }),
  refreshTrackDuration: (trackId: string) =>
    apiMutate<{ success: boolean; durationMs: number; changed: boolean }>('POST', `/admin/track/${encodeURIComponent(trackId)}/refresh-duration`),

  // playlist API
  generatePlaylist: (body: { strategy: PlaylistStrategy; params: Record<string, unknown>; name?: string; preview?: boolean }) =>
    apiMutate<GeneratedPlaylist | PlaylistPreviewResponse>('POST', '/playlists/generate', body),

  listPlaylists: (limit = 20, offset = 0) =>
    apiFetch<PlaylistListResponse>('/playlists', { limit: String(limit), offset: String(offset) }),

  getPlaylist: (id: number) =>
    apiFetch<GeneratedPlaylist>(`/playlists/${id}`),

  deletePlaylist: (id: number, removeFromSpotify = false) =>
    apiMutate<{ success: boolean }>('DELETE', `/playlists/${id}${removeFromSpotify ? '?spotify=true' : ''}`),

  regeneratePlaylist: (id: number) =>
    apiMutate<GeneratedPlaylist>('POST', `/playlists/${id}/regenerate`),

  // configurar auto-regeneración (activar/desactivar + cadencia)
  setPlaylistSchedule: (id: number, autoRegenerate: boolean, interval?: RegenerateInterval) =>
    apiMutate<{ id: number; autoRegenerate: boolean; regenerateIntervalMs: number | null; lastRegeneratedAt: string | null }>(
      'POST', `/playlists/${id}/schedule`, { autoRegenerate, interval },
    ),

  // library playlists (V2)
  libraryPlaylists: (limit = 50, offset = 0) =>
    apiFetch<LibraryPlaylistListResponse>('/playlists/library', { limit: String(limit), offset: String(offset) }),

  libraryPlaylistDetail: (id: number, sort: RankingMetric = 'time') =>
    apiFetch<LibraryPlaylistDetail>(`/playlists/library/${id}`, { sort }),

  syncLibrary: () =>
    apiMutate<{ success: boolean }>('POST', '/playlists/library/sync'),

  addTrackToPlaylist: (playlistId: number, trackId: string) =>
    apiMutate<{ success: boolean }>('POST', `/playlists/library/${playlistId}/tracks`, { trackId }),

  removeTrackFromPlaylist: (playlistId: number, trackId: string) =>
    apiMutate<{ success: boolean }>('DELETE', `/playlists/library/${playlistId}/tracks`, { trackId }),

  importHistory: async (files: FileList): Promise<ImportResult> => {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    const res = await fetch(`${API_BASE}/import`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    applyMutationInvalidation('POST', '/import');
    return res.json();
  },

  // --- social ---
  socialUsers: () => apiFetch<DirectoryResponse>('/social/users'),

  socialProfile: (spotifyId: string, range: TimeRange = 'month', signal?: AbortSignal) =>
    apiFetch<ProfileResponse>(`/social/profile/${encodeURIComponent(spotifyId)}`, { range }, signal),

  socialCompare: (spotifyId: string, range: TimeRange = 'all', signal?: AbortSignal) =>
    apiFetch<CompareResponse>(`/social/compare/${encodeURIComponent(spotifyId)}`, { range }, signal),

  socialFollows: () => apiFetch<FollowListResponse>('/social/follows'),

  follow: (spotifyId: string) =>
    apiMutate<{ success: boolean; following: boolean }>('POST', `/social/follows/${encodeURIComponent(spotifyId)}`),

  unfollow: (spotifyId: string) =>
    apiMutate<{ success: boolean; following: boolean }>('DELETE', `/social/follows/${encodeURIComponent(spotifyId)}`),

  socialFeed: () => apiFetch<FeedResponse>('/social/feed'),

  listShareLinks: () => apiFetch<ShareLinkListResponse>('/social/share-links'),

  createShareLink: (body: CreateShareLinkRequest = {}) =>
    apiMutate<ShareLink>('POST', '/social/share-links', body),

  revokeShareLink: (token: string) =>
    apiMutate<{ success: boolean }>('DELETE', `/social/share-links/${encodeURIComponent(token)}`),

  // --- público (sin sesión, vía publicFetch) ---
  publicShareProfile: (token: string, range?: TimeRange) =>
    publicFetch<ProfileResponse>(`/share/${encodeURIComponent(token)}`, range ? { range } : undefined),

  setAlbumCover: (albumId: string, imageUrl: string) =>
    apiMutate<{ ok: boolean }>('PUT', `/covers/album/${encodeURIComponent(albumId)}`, { imageUrl }),

  uploadAlbumCover: async (albumId: string, file: File): Promise<{ imageUrl: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/covers/${encodeURIComponent(albumId)}`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    applyMutationInvalidation('POST', `/covers/${albumId}`);
    return res.json();
  },
};

// sesiones de login activas (shape SessionInfo de @platform/auth)
export interface SessionInfo {
  hash: string;
  createdAt: number;
  expiresAt: number;
  userAgent: string | null;
  current: boolean;
}
export const listLoginSessions = () => apiFetch<{ sessions: SessionInfo[] }>('/settings/sessions');
export const logoutOtherSessions = () => apiMutate<{ ok: true; deleted: number }>('POST', '/settings/sessions/logout-others');

// changelog "novedades" (shape de @platform/changelog: estado por usuario)
export interface ChangelogChangeDTO {
  type: 'feature' | 'improvement' | 'fix' | 'breaking';
  es: string;
  en: string;
}
export interface ChangelogEntryDTO {
  version: string;
  publishedAt: number;
  title: string | null;
  changes: ChangelogChangeDTO[];
}
export interface ChangelogStateDTO {
  entries: ChangelogEntryDTO[];
  unseen: number;
  lastSeenAt: number | null;
}
export const getChangelog = () => apiFetch<ChangelogStateDTO>('/changelog');
export const markChangelogSeen = () => apiMutate<void>('POST', '/changelog/seen');
