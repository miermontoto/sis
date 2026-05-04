// --- DTOs re-exportados desde @sis/shared (single source of truth) ---

export type {
  TrackInfo, FormattedArtist, FormattedAlbum,
  TopTrackItem, TopArtistItem, TopAlbumItem,
  RankingMetric, WeekStartOption, Granularity, EntityType, DateRangeParams, LocaleSetting, RankChangeLookback, AlbumTrackDisplay, SessionRankDisplay, NowPlayingDisplay,
  HistoryItem, HistoryResponse,
  NowPlayingResponse, SpotifyDevice, DevicesResponse, PlayContextRequest, PlayContextResponse,
  ListeningTimeItem, HeatmapItem, StreaksData, GenreItem, DiscoveryItem, MonthlyDistributionItem,
  HealthData, MeResponse, UserRecord, ImportResult,
  PlaylistStrategy, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylist, LibraryPlaylistListResponse, LibraryPlaylistTrack, LibraryPlaylistDetail,
  SearchResults,
  ArtistDetail, AlbumDetail, AlbumCover, TrackDetail, Rankings,
  ChartEntry, DropoutEntry, ChartResponse, ChartHistoryResponse, RankingHistoryPoint, RankingHistoryPointWithCrossovers,
  RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData, RecordsResponse, PlaylistPresenceItem, MonthCountEntry,
  Accolade, AccoladesResponse,
  MergeRule, MergeSuggestion,
  ProjectedRankingsResponse, ProjectionResult, RankProjection,
} from '@sis/shared';
export { LOCALE_OPTIONS } from '@sis/shared';

import type {
  RankingMetric, WeekStartOption, LocaleSetting, AlbumTrackDisplay, NowPlayingDisplay, DateRangeParams,
  TopTrackItem, TopArtistItem, TopAlbumItem,
  GenreItem, DiscoveryItem, HistoryResponse, ListeningTimeItem, HeatmapItem, StreaksData, MonthlyDistributionItem,
  NowPlayingResponse, DevicesResponse, PlayContextRequest, PlayContextResponse,
  ArtistDetail, AlbumDetail, AlbumCover, TrackDetail,
  SearchResults, ChartHistoryResponse, ChartResponse, RecordsResponse,
  AccoladesResponse, Rankings, RankingHistoryPoint, RankingHistoryPointWithCrossovers, HealthData,
  MergeRule, MergeSuggestion, MeResponse, UserRecord, ImportResult,
  PlaylistStrategy, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylistListResponse, LibraryPlaylistDetail,
  ProjectedRankingsResponse,
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
  const noCache = path === '/now-playing' || path === '/now-playing/live' || path === '/now-playing/devices' || path === '/health';

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
  rankChangeLookback: RankChangeLookback;
  weekStart: WeekStartOption;
  locale: LocaleSetting;
  albumTrackDisplay: AlbumTrackDisplay;
  albumShowDuration: boolean;
  albumShowAccolades: boolean;
  sessionRankDisplay: SessionRankDisplay;
  nowPlayingDisplay: NowPlayingDisplay;
  lastPeriodWeek: string | null;
  lastPeriodMonth: string | null;
  lastPeriodYear: string | null;
}

const SETTINGS_DEFAULTS: SettingsData = {
  rankingMetric: 'time',
  rankChangeLookback: 'disabled',
  weekStart: 'friday',
  locale: 'auto',
  albumTrackDisplay: 'fill',
  albumShowDuration: true,
  albumShowAccolades: true,
  sessionRankDisplay: 'all+ytd',
  nowPlayingDisplay: 'auto',
  lastPeriodWeek: null,
  lastPeriodMonth: null,
  lastPeriodYear: null,
};

let settingsCache: SettingsData = { ...SETTINGS_DEFAULTS };
let settingsLoaded = false;

export async function loadSettings(): Promise<void> {
  try {
    const data = await apiFetch<Record<string, string>>('/settings');
    settingsCache = {
      rankingMetric: (data.rankingMetric as RankingMetric) || 'time',
      rankChangeLookback: (data.rankChangeLookback as RankChangeLookback) || 'disabled',
      weekStart: (data.weekStart as WeekStartOption) || 'friday',
      locale: (data.locale as LocaleSetting) || 'auto',
      albumTrackDisplay: (data.albumTrackDisplay as AlbumTrackDisplay) || 'fill',
      albumShowDuration: data.albumShowDuration !== 'false',
      albumShowAccolades: data.albumShowAccolades !== 'false',
      sessionRankDisplay: (data.sessionRankDisplay as SessionRankDisplay) || 'all+ytd',
      nowPlayingDisplay: (data.nowPlayingDisplay as NowPlayingDisplay) || 'auto',
      lastPeriodWeek: data.lastPeriodWeek || null,
      lastPeriodMonth: data.lastPeriodMonth || null,
      lastPeriodYear: data.lastPeriodYear || null,
    };
    // sync to localStorage as fallback
    localStorage.setItem('sis:rankingMetric', settingsCache.rankingMetric);
    localStorage.setItem('sis:rankChangeLookback', settingsCache.rankChangeLookback);
    localStorage.setItem('sis:weekStart', settingsCache.weekStart);
    localStorage.setItem('sis:locale', settingsCache.locale);
    localStorage.setItem('sis:albumTrackDisplay', settingsCache.albumTrackDisplay);
    localStorage.setItem('sis:albumShowDuration', String(settingsCache.albumShowDuration));
    localStorage.setItem('sis:albumShowAccolades', String(settingsCache.albumShowAccolades));
    localStorage.setItem('sis:sessionRankDisplay', settingsCache.sessionRankDisplay);
    localStorage.setItem('sis:nowPlayingDisplay', settingsCache.nowPlayingDisplay);
    if (settingsCache.lastPeriodWeek) localStorage.setItem('sis:lastPeriod:week', settingsCache.lastPeriodWeek);
    if (settingsCache.lastPeriodMonth) localStorage.setItem('sis:lastPeriod:month', settingsCache.lastPeriodMonth);
    if (settingsCache.lastPeriodYear) localStorage.setItem('sis:lastPeriod:year', settingsCache.lastPeriodYear);
  } catch {
    // fallback: read from localStorage
    settingsCache = {
      rankingMetric: (localStorage.getItem('sis:rankingMetric') as RankingMetric) || 'time',
      rankChangeLookback: (localStorage.getItem('sis:rankChangeLookback') as RankChangeLookback) || 'disabled',
      weekStart: (localStorage.getItem('sis:weekStart') as WeekStartOption) || 'friday',
      locale: (localStorage.getItem('sis:locale') as LocaleSetting) || 'auto',
      albumTrackDisplay: (localStorage.getItem('sis:albumTrackDisplay') as AlbumTrackDisplay) || 'fill',
      albumShowDuration: localStorage.getItem('sis:albumShowDuration') !== 'false',
      albumShowAccolades: localStorage.getItem('sis:albumShowAccolades') !== 'false',
      sessionRankDisplay: (localStorage.getItem('sis:sessionRankDisplay') as SessionRankDisplay) || 'all+ytd',
      nowPlayingDisplay: (localStorage.getItem('sis:nowPlayingDisplay') as NowPlayingDisplay) || 'auto',
      lastPeriodWeek: localStorage.getItem('sis:lastPeriod:week'),
      lastPeriodMonth: localStorage.getItem('sis:lastPeriod:month'),
      lastPeriodYear: localStorage.getItem('sis:lastPeriod:year'),
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

export function getRankChangeLookback(): RankChangeLookback {
  if (settingsLoaded) return settingsCache.rankChangeLookback;
  return (localStorage.getItem('sis:rankChangeLookback') as RankChangeLookback) || 'disabled';
}

export function setRankChangeLookback(lookback: RankChangeLookback) {
  settingsCache.rankChangeLookback = lookback;
  localStorage.setItem('sis:rankChangeLookback', lookback);
  updateSetting({ rankChangeLookback: lookback });
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

/** Resolved locale: if 'auto', returns navigator.language; otherwise the stored BCP 47 tag */
export function getLocale(): string {
  const raw = getRawLocale();
  return raw === 'auto' ? navigator.language : raw;
}

/** Raw stored value ('auto' or specific tag) — for the settings UI */
export function getRawLocale(): LocaleSetting {
  if (settingsLoaded) return settingsCache.locale;
  return (localStorage.getItem('sis:locale') as LocaleSetting) || 'auto';
}

export function setLocale(locale: LocaleSetting) {
  settingsCache.locale = locale;
  localStorage.setItem('sis:locale', locale);
  updateSetting({ locale });
}

export function getAlbumTrackDisplay(): AlbumTrackDisplay {
  if (settingsLoaded) return settingsCache.albumTrackDisplay;
  return (localStorage.getItem('sis:albumTrackDisplay') as AlbumTrackDisplay) || 'fill';
}

export function setAlbumTrackDisplay(display: AlbumTrackDisplay) {
  settingsCache.albumTrackDisplay = display;
  localStorage.setItem('sis:albumTrackDisplay', display);
  updateSetting({ albumTrackDisplay: display });
}

export function getAlbumShowDuration(): boolean {
  if (settingsLoaded) return settingsCache.albumShowDuration;
  return localStorage.getItem('sis:albumShowDuration') !== 'false';
}

export function setAlbumShowDuration(v: boolean) {
  settingsCache.albumShowDuration = v;
  localStorage.setItem('sis:albumShowDuration', String(v));
  updateSetting({ albumShowDuration: String(v) });
}

export function getAlbumShowAccolades(): boolean {
  if (settingsLoaded) return settingsCache.albumShowAccolades;
  return localStorage.getItem('sis:albumShowAccolades') !== 'false';
}

export function setAlbumShowAccolades(v: boolean) {
  settingsCache.albumShowAccolades = v;
  localStorage.setItem('sis:albumShowAccolades', String(v));
  updateSetting({ albumShowAccolades: String(v) });
}

export function getSessionRankDisplay(): SessionRankDisplay {
  if (settingsLoaded) return settingsCache.sessionRankDisplay;
  return (localStorage.getItem('sis:sessionRankDisplay') as SessionRankDisplay) || 'all+ytd';
}

const sessionRankDisplayListeners: (() => void)[] = [];
export function onSessionRankDisplayChange(fn: () => void): () => void {
  sessionRankDisplayListeners.push(fn);
  return () => { const i = sessionRankDisplayListeners.indexOf(fn); if (i >= 0) sessionRankDisplayListeners.splice(i, 1); };
}

export function setSessionRankDisplay(v: SessionRankDisplay) {
  settingsCache.sessionRankDisplay = v;
  localStorage.setItem('sis:sessionRankDisplay', v);
  updateSetting({ sessionRankDisplay: v });
  for (const fn of sessionRankDisplayListeners) fn();
}

export function getNowPlayingDisplay(): NowPlayingDisplay {
  if (settingsLoaded) return settingsCache.nowPlayingDisplay;
  return (localStorage.getItem('sis:nowPlayingDisplay') as NowPlayingDisplay) || 'auto';
}

const nowPlayingDisplayListeners: ((v: NowPlayingDisplay) => void)[] = [];
export function onNowPlayingDisplayChange(fn: (v: NowPlayingDisplay) => void): () => void {
  nowPlayingDisplayListeners.push(fn);
  return () => { const i = nowPlayingDisplayListeners.indexOf(fn); if (i >= 0) nowPlayingDisplayListeners.splice(i, 1); };
}

export function setNowPlayingDisplay(v: NowPlayingDisplay) {
  settingsCache.nowPlayingDisplay = v;
  localStorage.setItem('sis:nowPlayingDisplay', v);
  updateSetting({ nowPlayingDisplay: v });
  for (const fn of nowPlayingDisplayListeners) fn(v);
}

const LAST_PERIOD_SETTING_KEY: Record<string, string> = {
  week: 'lastPeriodWeek',
  month: 'lastPeriodMonth',
  year: 'lastPeriodYear',
};

export function setLastPeriod(gran: string, value: string) {
  const settingKey = LAST_PERIOD_SETTING_KEY[gran] as keyof SettingsData;
  (settingsCache as any)[settingKey] = value;
  localStorage.setItem(`sis:lastPeriod:${gran}`, value);
  updateSetting({ [settingKey]: value });
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

  topTracks: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, lookback?: string, signal?: AbortSignal) =>
    apiFetch<TopTrackItem[]>('/stats/top-tracks', { ...rangeParams(range, dates), limit: String(limit), sort, ...(lookback && lookback !== 'disabled' ? { lookback } : {}) }, signal),

  topArtists: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, lookback?: string, signal?: AbortSignal) =>
    apiFetch<TopArtistItem[]>('/stats/top-artists', { ...rangeParams(range, dates), limit: String(limit), sort, ...(lookback && lookback !== 'disabled' ? { lookback } : {}) }, signal),

  topAlbums: (range = 'month', limit = 50, sort: RankingMetric = 'time', dates?: DateRangeParams, lookback?: string, signal?: AbortSignal) =>
    apiFetch<TopAlbumItem[]>('/stats/top-albums', { ...rangeParams(range, dates), limit: String(limit), sort, ...(lookback && lookback !== 'disabled' ? { lookback } : {}) }, signal),

  topGenres: (range = 'month', limit = 20, dates?: DateRangeParams, signal?: AbortSignal) =>
    apiFetch<GenreItem[]>('/stats/top-genres', { ...rangeParams(range, dates), limit: String(limit) }, signal),

  projectedRankings: (sort: RankingMetric = 'time', signal?: AbortSignal) =>
    apiFetch<ProjectedRankingsResponse>('/stats/projected-rankings', { sort }, signal),

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

  records: (weekStart = 'monday', sort: RankingMetric = 'time', type?: 'tracks' | 'albums' | 'artists', signal?: AbortSignal) =>
    apiFetch<Partial<RecordsResponse>>('/stats/records', { weekStart, sort, ...(type && { type }) }, signal),

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
  queueTrack: (trackId: string) =>
    apiMutate<{ success: boolean }>('POST', '/now-playing/queue', { uri: `spotify:track:${trackId}` }),

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

  listMerges: () => apiFetch<MergeRule[]>('/admin/merges'),

  // opts.parent — artistId (requerido para album/track, ignorado para artist)
  // opts.exclude — id a excluir (normalmente el propio target)
  mergeSuggestions: (entityType: 'album' | 'artist' | 'track', opts: { parent?: string; exclude?: string } = {}) => {
    const params: Record<string, string> = { entityType };
    if (opts.parent) params.parent = opts.parent;
    if (opts.exclude) params.exclude = opts.exclude;
    return apiFetch<MergeSuggestion[]>('/admin/merge-suggestions', params);
  },

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

  libraryPlaylistDetail: (id: number, sort: RankingMetric = 'time') =>
    apiFetch<LibraryPlaylistDetail>(`/playlists/library/${id}`, { sort }),

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
