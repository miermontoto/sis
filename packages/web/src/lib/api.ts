const BASE = '/api';

// wrapper genérico para llamadas al API
async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface TrackInfo {
  id: string;
  name: string;
  durationMs: number;
  album: { name: string; imageUrl: string | null } | null;
  artists: { id: string; name: string }[];
}

export interface TopTrackItem {
  trackId: string;
  playCount: number;
  totalMs: number;
  track: TrackInfo | null;
}

export interface TopArtistItem {
  artistId: string;
  playCount: number;
  totalMs: number;
  artist: { name: string; imageUrl: string | null; genres: string[] } | null;
}

export interface TopAlbumItem {
  albumId: string;
  playCount: number;
  totalMs: number;
  album: { name: string; imageUrl: string | null; releaseDate: string | null } | null;
}

export type RankingMetric = 'time' | 'plays';

const RANKING_METRIC_KEY = 'sis:rankingMetric';

export function getRankingMetric(): RankingMetric {
  return (localStorage.getItem(RANKING_METRIC_KEY) as RankingMetric) || 'time';
}

export function setRankingMetric(metric: RankingMetric) {
  localStorage.setItem(RANKING_METRIC_KEY, metric);
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

export const api = {
  nowPlaying: () => apiFetch<NowPlayingResponse>('/now-playing'),

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

  health: () => apiFetch<HealthData>('/health'),

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
