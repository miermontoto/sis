// --- DTOs re-exportados desde @sis/shared (single source of truth) ---

export type {
  TrackInfo, FormattedArtist, FormattedAlbum,
  TopTrackItem, TopArtistItem, TopAlbumItem,
  RankingMetric, WeekStartOption, DateRangeParams,
  HistoryItem, HistoryResponse,
  NowPlayingResponse,
  ListeningTimeItem, HeatmapItem, StreaksData, GenreItem,
  HealthData, MeResponse, UserRecord, ImportResult,
  PlaylistStrategy, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylist, LibraryPlaylistListResponse, LibraryPlaylistTrack, LibraryPlaylistDetail,
  SearchResults,
  ArtistDetail, AlbumDetail, AlbumCover, TrackDetail, Rankings,
  ChartEntry, DropoutEntry, ChartResponse, ChartHistoryResponse, RankingHistoryPoint,
  RecordEntry, ArtistRecordEntry, EntityRecords, ArtistRecordsData, RecordsResponse, PlaylistPresenceItem,
  Accolade, AccoladesResponse,
  MergeRule, MergeSuggestionAlbum,
} from '@sis/shared';

import type {
  RankingMetric, WeekStartOption, DateRangeParams,
  TopTrackItem, TopArtistItem, TopAlbumItem,
  GenreItem, HistoryResponse, ListeningTimeItem, HeatmapItem, StreaksData,
  NowPlayingResponse, ArtistDetail, AlbumDetail, AlbumCover, TrackDetail,
  SearchResults, ChartHistoryResponse, ChartResponse, RecordsResponse,
  AccoladesResponse, Rankings, RankingHistoryPoint, HealthData,
  MergeRule, MergeSuggestionAlbum, MeResponse, UserRecord, ImportResult,
  PlaylistStrategy, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylistListResponse, LibraryPlaylistDetail,
} from '@sis/shared';

const BASE = '/api';

// cache de respuestas con TTL corto para evitar refetches en navegación back/forward
const responseCache = new Map<string, { data: unknown; ts: number }>();
const inflightRequests = new Map<string, Promise<unknown>>();
const CACHE_TTL = 30_000; // 30s

// wrapper genérico para llamadas al API con deduplicación y cache
async function apiFetch<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const cacheKey = url.toString();

  // endpoints que siempre necesitan data fresca
  const noCache = path === '/now-playing' || path === '/now-playing/live' || path === '/health';

  // servir desde cache si es reciente
  if (!noCache) {
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data as T;
    }
  }

  // deduplicar requests idénticos en vuelo (solo si no hay signal propio)
  if (!signal) {
    const inflight = inflightRequests.get(cacheKey);
    if (inflight) return inflight as Promise<T>;
  }

  const promise = (async () => {
    const res = await fetch(url.toString(), signal ? { signal } : undefined);
    if (res.status === 401) {
      window.location.href = '/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search);
      throw new Error('No autorizado');
    }
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    responseCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  })();

  if (!signal) {
    inflightRequests.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  }
  return promise;
}

// crea un AbortController vinculado a un entity ID; aborta el anterior al cambiar
export function createFetchController() {
  let controller: AbortController | null = null;
  return {
    get signal() {
      return controller?.signal;
    },
    reset() {
      controller?.abort();
      controller = new AbortController();
      return controller.signal;
    },
    abort() {
      controller?.abort();
      controller = null;
    },
  };
}

// --- user settings (synced to server, localStorage as fallback) ---

interface SettingsData {
  rankingMetric: RankingMetric;
  weekStart: WeekStartOption;
}

const SETTINGS_DEFAULTS: SettingsData = {
  rankingMetric: 'time',
  weekStart: 'friday',
};

let settingsCache: SettingsData = { ...SETTINGS_DEFAULTS };
let settingsLoaded = false;

export async function loadSettings(): Promise<void> {
  try {
    const data = await apiFetch<Record<string, string>>('/settings');
    settingsCache = {
      rankingMetric: (data.rankingMetric as RankingMetric) || 'time',
      weekStart: (data.weekStart as WeekStartOption) || 'friday',
    };
    // sync to localStorage as fallback
    localStorage.setItem('sis:rankingMetric', settingsCache.rankingMetric);
    localStorage.setItem('sis:weekStart', settingsCache.weekStart);
  } catch {
    // fallback: read from localStorage
    settingsCache = {
      rankingMetric: (localStorage.getItem('sis:rankingMetric') as RankingMetric) || 'time',
      weekStart: (localStorage.getItem('sis:weekStart') as WeekStartOption) || 'friday',
    };
  }
  settingsLoaded = true;
}

function updateSetting(patch: Partial<Record<string, string>>) {
  fetch(new URL('/api/settings', window.location.origin), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

export function getRankingMetric(): RankingMetric {
  if (settingsLoaded) return settingsCache.rankingMetric;
  return (localStorage.getItem('sis:rankingMetric') as RankingMetric) || 'time';
}

export function setRankingMetric(metric: RankingMetric) {
  settingsCache.rankingMetric = metric;
  localStorage.setItem('sis:rankingMetric', metric);
  updateSetting({ rankingMetric: metric });
}

export function getWeekStart(): WeekStartOption {
  if (settingsLoaded) return settingsCache.weekStart;
  return (localStorage.getItem('sis:weekStart') as WeekStartOption) || 'friday';
}

export function setWeekStart(ws: WeekStartOption) {
  settingsCache.weekStart = ws;
  localStorage.setItem('sis:weekStart', ws);
  updateSetting({ weekStart: ws });
}

// invalidar cache (tras mutaciones o cuando se necesite data fresca)
export function invalidateCache(pathPrefix?: string) {
  if (!pathPrefix) {
    responseCache.clear();
    return;
  }
  const prefix = new URL(`${BASE}${pathPrefix}`, window.location.origin).toString();
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}

// POST/DELETE helper para mutaciones
async function apiMutate<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search);
    throw new Error('No autorizado');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  // invalidar cache tras mutaciones
  responseCache.clear();
  return res.json();
}

function rangeParams(range: string, dates?: DateRangeParams): Record<string, string> {
  if (dates) return { startDate: dates.startDate, endDate: dates.endDate };
  return { range };
}

export const api = {
  nowPlaying: () => apiFetch<NowPlayingResponse>('/now-playing'),
  nowPlayingLive: () => apiFetch<NowPlayingResponse>('/now-playing/live'),

  topTracks: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<TopTrackItem[]>('/stats/top-tracks', { ...rangeParams(range, dates), limit: String(limit), sort }, signal),

  topArtists: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<TopArtistItem[]>('/stats/top-artists', { ...rangeParams(range, dates), limit: String(limit), sort }, signal),

  topAlbums: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<TopAlbumItem[]>('/stats/top-albums', { ...rangeParams(range, dates), limit: String(limit), sort }, signal),

  topGenres: (range = 'month', limit = 20, dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<GenreItem[]>('/stats/top-genres', { ...rangeParams(range, dates), limit: String(limit) }, signal),

  history: (page = 1, limit = 50, filters?: { date?: string; album?: string; track?: string; artist?: string }, signal?: AbortSignal) => {
    const f = filters ?? {};
    return apiFetch<HistoryResponse>('/stats/history', {
      page: String(page), limit: String(limit),
      ...(f.date ? { date: f.date } : {}),
      ...(f.album ? { album: f.album } : {}),
      ...(f.track ? { track: f.track } : {}),
      ...(f.artist ? { artist: f.artist } : {}),
    }, signal);
  },

  deleteHistory: (ids: number[]) =>
    apiMutate<{ deleted: number }>('DELETE', '/stats/history', { ids }),

  listeningTime: (range = 'month', granularity = 'day', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<ListeningTimeItem[]>('/stats/listening-time', { ...rangeParams(range, dates), granularity }, signal),

  heatmap: (range = 'month', dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<HeatmapItem[]>('/stats/heatmap', { ...rangeParams(range, dates) }, signal),

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

  records: (weekStart = 'monday', sort: RankingMetric = 'time', type?: 'tracks' | 'albums' | 'artists', signal?: AbortSignal) =>
    apiFetch<Partial<RecordsResponse>>('/stats/records', { weekStart, sort, ...(type && { type }) }, signal),

  playbackPlay: () => apiMutate<{ success: boolean }>('PUT', '/now-playing/play'),
  playbackPause: () => apiMutate<{ success: boolean }>('PUT', '/now-playing/pause'),
  playbackNext: () => apiMutate<{ success: boolean }>('POST', '/now-playing/next'),
  playbackPrevious: () => apiMutate<{ success: boolean }>('POST', '/now-playing/previous'),

  accolades: (type: 'artist' | 'track' | 'album', id: string, signal?: AbortSignal) =>
    apiFetch<AccoladesResponse>(`/stats/accolades/${type}/${encodeURIComponent(id)}`, undefined, signal),

  rankings: (type: 'artist' | 'track' | 'album', id: string, sort: RankingMetric = 'time', signal?: AbortSignal) =>
    apiFetch<Rankings>(`/stats/rankings/${type}/${encodeURIComponent(id)}`, { sort }, signal),

  rankingHistory: (type: 'artist' | 'track' | 'album', id: string, sort: RankingMetric = 'time', signal?: AbortSignal) =>
    apiFetch<RankingHistoryPoint[]>(`/stats/ranking-history/${type}/${encodeURIComponent(id)}`, { sort }, signal),

  health: () => apiFetch<HealthData>('/health'),

  // merge API
  createMerge: (entityType: string, sourceId: string, targetId: string) =>
    apiMutate<MergeRule>('POST', '/admin/merge', { entityType, sourceId, targetId }),

  deleteMerge: (id: number) =>
    apiMutate<{ success: boolean }>('DELETE', `/admin/merge/${id}`),

  listMerges: () => apiFetch<MergeRule[]>('/admin/merges'),

  mergeSuggestions: (artistId: string) =>
    apiFetch<MergeSuggestionAlbum[]>(`/admin/merge-suggestions/${encodeURIComponent(artistId)}`),

  // user management (admin)
  me: () => apiFetch<MeResponse>('/me'),
  listUsers: () => apiFetch<UserRecord[]>('/admin/users'),
  addUser: (spotifyId: string) => apiMutate<UserRecord>('POST', '/admin/users', { spotifyId }),
  updateUser: (id: number, fields: { isAdmin?: boolean; isActive?: boolean }) =>
    apiMutate<UserRecord>('PUT', `/admin/users/${id}`, fields),
  deleteUser: (id: number) => apiMutate<{ success: boolean }>('DELETE', `/admin/users/${id}`),

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

  // library playlists (V2)
  libraryPlaylists: (limit = 50, offset = 0) =>
    apiFetch<LibraryPlaylistListResponse>('/playlists/library', { limit: String(limit), offset: String(offset) }),

  libraryPlaylistDetail: (id: number) =>
    apiFetch<LibraryPlaylistDetail>(`/playlists/library/${id}`),

  syncLibrary: () =>
    apiMutate<{ success: boolean }>('POST', '/playlists/library/sync'),

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

  albumCovers: (albumId: string, signal?: AbortSignal) =>
    apiFetch<{ covers: AlbumCover[] }>(`/covers/album/${encodeURIComponent(albumId)}`, {}, signal),

  setAlbumCover: (albumId: string, imageUrl: string) =>
    apiMutate<{ ok: boolean }>('PUT', `/covers/album/${encodeURIComponent(albumId)}`, { imageUrl }),

  uploadAlbumCover: async (albumId: string, file: File): Promise<{ imageUrl: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/covers/${encodeURIComponent(albumId)}`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    return res.json();
  },
};
