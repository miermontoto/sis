const BASE = '/api';

// wrapper genérico para llamadas al API
async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString());
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('No autorizado');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface TrackInfo {
  id: string;
  name: string;
  durationMs: number;
  album: { id: string; name: string; imageUrl: string | null } | null;
  artists: { id: string; name: string }[];
}

export interface TopTrackItem {
  trackId: string;
  playCount: number;
  totalMs: number;
  rankChange: number | null;
  previousRank: number | null;
  isNew: boolean;
  track: TrackInfo | null;
}

export interface TopArtistItem {
  artistId: string;
  playCount: number;
  totalMs: number;
  rankChange: number | null;
  previousRank: number | null;
  isNew: boolean;
  artist: { name: string; imageUrl: string | null; genres: string[] } | null;
}

export interface TopAlbumItem {
  albumId: string;
  playCount: number;
  totalMs: number;
  rankChange: number | null;
  previousRank: number | null;
  isNew: boolean;
  album: { name: string; imageUrl: string | null; releaseDate: string | null } | null;
}

export type RankingMetric = 'time' | 'plays';

const RANKING_METRIC_KEY = 'sis:rankingMetric';
const SHOW_RANK_CHANGES_KEY = 'sis:showRankChanges';

export function getRankingMetric(): RankingMetric {
  return (localStorage.getItem(RANKING_METRIC_KEY) as RankingMetric) || 'time';
}

export function setRankingMetric(metric: RankingMetric) {
  localStorage.setItem(RANKING_METRIC_KEY, metric);
}

export function getShowRankChanges(): boolean {
  const val = localStorage.getItem(SHOW_RANK_CHANGES_KEY);
  return val === null ? true : val === 'true';
}

export function setShowRankChanges(show: boolean) {
  localStorage.setItem(SHOW_RANK_CHANGES_KEY, String(show));
}

export interface HistoryItem {
  id: number;
  playedAt: string;
  contextType: string | null;
  track: TrackInfo | null;
}

export interface HistoryResponse {
  items: HistoryItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface NowPlayingResponse {
  playing: boolean;
  isPlaying: boolean;
  track?: TrackInfo;
  updatedAt?: string;
}

export interface ListeningTimeItem {
  period: string;
  play_count: number;
  total_ms: number;
}

export interface HeatmapItem {
  day_of_week: number;
  hour: number;
  play_count: number;
}

export interface StreaksData {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
}

export interface GenreItem {
  genre: string;
  play_count: number;
}

export interface HealthData {
  status: string;
  database: string;
  authenticated: boolean;
  totalPlays: number;
  timestamp: string;
}

export interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
}

// --- search types ---

export interface SearchResults {
  artists: { id: string; name: string; imageUrl: string | null; playCount: number }[];
  albums: { id: string; name: string; imageUrl: string | null; artistName: string | null; playCount: number }[];
  tracks: { id: string; name: string; albumImageUrl: string | null; artistName: string | null; playCount: number }[];
}

// --- detail types ---

export interface Rankings {
  week: number | null;
  month: number | null;
  thisYear: number | null;
  all: number | null;
}

export interface ArtistDetail {
  artist: { id: string; name: string; imageUrl: string | null; genres: string[] };
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  topTracks: TopTrackItem[];
  topAlbums: TopAlbumItem[];
  recentPlays: HistoryItem[];
}

export interface AlbumDetail {
  album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null; totalTracks: number | null; albumType: string | null };
  artists: { id: string; name: string; imageUrl: string | null }[];
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  tracks: TopTrackItem[];
  recentPlays: HistoryItem[];
  mergedFrom: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
  mergedInto: { id: string; ruleId: number; name: string; imageUrl: string | null } | null;
}

export interface TrackDetail {
  track: {
    id: string; name: string; durationMs: number; trackNumber: number | null; explicit: boolean;
    album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null } | null;
    artists: { id: string; name: string; imageUrl: string | null }[];
  };
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  dailySeries: { day: string; play_count: number; total_ms: number }[];
  albumBreakdown: { albumId: string; playCount: number; totalMs: number; album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null } }[];
}

// POST/DELETE helper para mutaciones
async function apiMutate<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('No autorizado');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

// --- merge types ---

export interface MergeRule {
  id: number;
  entity_type: string;
  source_id: string;
  target_id: string;
  source_name: string;
  source_image: string | null;
  target_name: string;
  target_image: string | null;
  artist_id: string | null;
  artist_name: string | null;
  artist_image: string | null;
  created_at: string;
}

export interface MergeSuggestionAlbum {
  id: string;
  name: string;
  image_url: string | null;
  plays: number;
}

export const api = {
  nowPlaying: () => apiFetch<NowPlayingResponse>('/now-playing'),
  nowPlayingLive: () => apiFetch<NowPlayingResponse>('/now-playing/live'),

  topTracks: (range = 'month', limit = 50, sort: RankingMetric = 'time') =>
    apiFetch<TopTrackItem[]>('/stats/top-tracks', { range, limit: String(limit), sort }),

  topArtists: (range = 'month', limit = 50, sort: RankingMetric = 'time') =>
    apiFetch<TopArtistItem[]>('/stats/top-artists', { range, limit: String(limit), sort }),

  topAlbums: (range = 'month', limit = 50, sort: RankingMetric = 'time') =>
    apiFetch<TopAlbumItem[]>('/stats/top-albums', { range, limit: String(limit), sort }),

  topGenres: (range = 'month', limit = 20) =>
    apiFetch<GenreItem[]>('/stats/top-genres', { range, limit: String(limit) }),

  history: (page = 1, limit = 50) =>
    apiFetch<HistoryResponse>('/stats/history', { page: String(page), limit: String(limit) }),

  listeningTime: (range = 'month', granularity = 'day') =>
    apiFetch<ListeningTimeItem[]>('/stats/listening-time', { range, granularity }),

  heatmap: (range = 'month') =>
    apiFetch<HeatmapItem[]>('/stats/heatmap', { range }),

  streaks: () => apiFetch<StreaksData>('/stats/streaks'),

  artistDetail: (id: string, range = 'all', opts?: { sort?: string; trackLimit?: number; albumLimit?: number }) =>
    apiFetch<ArtistDetail>(`/stats/artist/${encodeURIComponent(id)}`, {
      range,
      ...(opts?.sort && { sort: opts.sort }),
      ...(opts?.trackLimit && { trackLimit: String(opts.trackLimit) }),
      ...(opts?.albumLimit && { albumLimit: String(opts.albumLimit) }),
    }),

  albumDetail: (id: string, range = 'all', sort?: string) =>
    apiFetch<AlbumDetail>(`/stats/album/${encodeURIComponent(id)}`, { range, ...(sort && { sort }) }),

  trackDetail: (id: string, range = 'all') =>
    apiFetch<TrackDetail>(`/stats/track/${encodeURIComponent(id)}`, { range }),

  search: (q: string, limit = 5) =>
    apiFetch<SearchResults>('/stats/search', { q, limit: String(limit) }),

  playbackPlay: () => apiMutate<{ success: boolean }>('PUT', '/now-playing/play'),
  playbackPause: () => apiMutate<{ success: boolean }>('PUT', '/now-playing/pause'),
  playbackNext: () => apiMutate<{ success: boolean }>('POST', '/now-playing/next'),
  playbackPrevious: () => apiMutate<{ success: boolean }>('POST', '/now-playing/previous'),

  rankings: (type: 'artist' | 'track' | 'album', id: string, sort: RankingMetric = 'time') =>
    apiFetch<Rankings>(`/stats/rankings/${type}/${encodeURIComponent(id)}`, { sort }),

  health: () => apiFetch<HealthData>('/health'),

  // merge API
  createMerge: (entityType: string, sourceId: string, targetId: string) =>
    apiMutate<MergeRule>('POST', '/admin/merge', { entityType, sourceId, targetId }),

  deleteMerge: (id: number) =>
    apiMutate<{ success: boolean }>('DELETE', `/admin/merge/${id}`),

  listMerges: () => apiFetch<MergeRule[]>('/admin/merges'),

  mergeSuggestions: (artistId: string) =>
    apiFetch<MergeSuggestionAlbum[]>(`/admin/merge-suggestions/${encodeURIComponent(artistId)}`),

  importHistory: async (files: FileList): Promise<ImportResult> => {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    const res = await fetch(`${BASE}/import`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    return res.json();
  },
};
