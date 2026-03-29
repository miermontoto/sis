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
export type WeekStartOption = 'monday' | 'sunday' | 'friday';

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

export interface MeResponse {
  authenticated: boolean;
  userId?: number;
  spotifyId?: string;
  isAdmin?: boolean;
  scopes?: string[];
}

// --- playlist types ---

export type PlaylistStrategy = 'top_range' | 'top_artist' | 'top_genre' | 'deep_cuts' | 'time_vibes' | 'rediscovery';

export interface GeneratedPlaylist {
  id: number;
  spotifyPlaylistId: string | null;
  spotifyUrl?: string;
  name: string;
  strategy: PlaylistStrategy;
  params: Record<string, unknown>;
  trackCount: number;
  tracks?: { position: number; track: TrackInfo | null }[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistListResponse {
  items: GeneratedPlaylist[];
  total: number;
}

export interface PlaylistPreviewResponse {
  tracks: { position: number; track: TrackInfo | null }[];
}

export interface UserRecord {
  id: number;
  spotifyId: string;
  displayName: string | null;
  imageUrl: string | null;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  recentPlays: HistoryItem[];
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

// --- records types ---

export interface RecordEntry {
  entityId: string;
  name: string;
  imageUrl: string | null;
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

// --- accolades types ---

export interface Accolade {
  type: string;
  rank: number;
  value: number;
  week: string | null;
}

export interface AccoladesResponse {
  metric: 'plays' | 'time';
  accolades: Accolade[];
}

// --- charts types ---

export interface ChartEntry {
  rank: number;
  entityId: string;
  name: string;
  imageUrl: string | null;
  artistName: string | null;
  plays: number;
  totalMs: number;
  previousRank: number | null;
  rankChange: number | null;
  isNew: boolean;
  isReentry: boolean;
  peakRank: number;
  peakPeriod: string;
  peakPeriods: string[];
  timesAtPeak: number;
  weeksOnChart: number;
  consecutiveWeeks: number;
}

export interface DropoutEntry {
  entityId: string;
  name: string;
  imageUrl: string | null;
  artistName: string | null;
  previousRank: number;
  peakRank: number;
  peakPeriod: string;
  weeksOnChart: number;
}

export interface ChartResponse {
  period: string;
  entries: ChartEntry[];
  dropouts: DropoutEntry[];
}

// --- chart history types ---

export interface RankingHistoryPoint {
  period: string;
  rank: number;
}

export interface ChartHistoryResponse {
  currentRank: number | null;
  currentPeriod: string;
  peakRank: number;
  peakPeriod: string;
  peakPeriods: string[];
  timesAtPeak: number;
  weeksOnChart: number;
  history: { period: string; rank: number | null }[];
}

export interface DateRangeParams {
  startDate: string;
  endDate: string;
}

function rangeParams(range: string, dates?: DateRangeParams): Record<string, string> {
  if (dates) return { startDate: dates.startDate, endDate: dates.endDate };
  return { range };
}

export const api = {
  nowPlaying: () => apiFetch<NowPlayingResponse>('/now-playing'),
  nowPlayingLive: () => apiFetch<NowPlayingResponse>('/now-playing/live'),

  topTracks: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams) =>
    apiFetch<TopTrackItem[]>('/stats/top-tracks', { ...rangeParams(range, dates), limit: String(limit), sort }),

  topArtists: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams) =>
    apiFetch<TopArtistItem[]>('/stats/top-artists', { ...rangeParams(range, dates), limit: String(limit), sort }),

  topAlbums: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams) =>
    apiFetch<TopAlbumItem[]>('/stats/top-albums', { ...rangeParams(range, dates), limit: String(limit), sort }),

  topGenres: (range = 'month', limit = 20, dates?: DateRangeParams) =>
    apiFetch<GenreItem[]>('/stats/top-genres', { ...rangeParams(range, dates), limit: String(limit) }),

  history: (page = 1, limit = 50) =>
    apiFetch<HistoryResponse>('/stats/history', { page: String(page), limit: String(limit) }),

  listeningTime: (range = 'month', granularity = 'day', dates?: DateRangeParams) =>
    apiFetch<ListeningTimeItem[]>('/stats/listening-time', { ...rangeParams(range, dates), granularity }),

  heatmap: (range = 'month', dates?: DateRangeParams) =>
    apiFetch<HeatmapItem[]>('/stats/heatmap', { ...rangeParams(range, dates) }),

  streaks: () => apiFetch<StreaksData>('/stats/streaks'),

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

  chartPeriods: (granularity: string, weekStart: string) =>
    apiFetch<{ periods: string[] }>('/stats/charts/periods', { granularity, weekStart }),

  chart: (type: string, granularity: string, period: string, weekStart: string, sort: RankingMetric = 'time', limit = 25) =>
    apiFetch<ChartResponse>('/stats/charts', { type, granularity, period, weekStart, sort, limit: String(limit) }),

  records: (weekStart = 'monday', sort: RankingMetric = 'time', type?: 'tracks' | 'albums' | 'artists') =>
    apiFetch<Partial<RecordsResponse>>('/stats/records', { weekStart, sort, ...(type && { type }) }),

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
