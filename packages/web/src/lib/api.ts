// --- DTOs re-exportados desde @sis/shared (single source of truth) ---

export type {
  TrackInfo, FormattedArtist, FormattedAlbum,
  TopTrackItem, TopArtistItem, TopAlbumItem,
  RankingMetric, WeekStartOption, Granularity, EntityType, DateRangeParams, LocaleSetting, RankChangeLookback, AlbumTrackDisplay, SessionTrackingDisplay, SessionRankDisplay, NowPlayingDisplay, SocialVisibility,
  HistoryItem, HistoryResponse,
  NowPlayingResponse, SpotifyDevice, DevicesResponse, PlayContextRequest, PlayContextResponse, FriendActivity, FriendsActivityResponse,
  ListeningTimeItem, HeatmapItem, StreaksData, GenreItem, DiscoveryItem, MonthlyDistributionItem,
  HealthData, MeResponse, UserRecord, ImportResult,
  PlaylistStrategy, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylist, LibraryPlaylistListResponse, LibraryPlaylistTrack, LibraryPlaylistDetail,
  SearchResults,
  ArtistDetail, AlbumDetail, AlbumCover, TrackDetail, Rankings,
  ChartEntry, DropoutEntry, ChartResponse, ChartHistoryResponse, RankingHistoryPoint, RankingHistoryPointWithCrossovers,
  RecordEntry, ArtistRecordEntry, EntityRecords, TrackRecords, AlbumRecords, ArtistRecordsData, RecordsResponse, PlaylistPresenceItem, MonthCountEntry,
  Accolade, AccoladesResponse,
  MergeRule, MergeSuggestion, AlbumMergePreview, AlbumMergeResult, RemergePreview, RemergePreviewPair, BatchMergeResult,
  ProjectedRankingsResponse, ProjectionResult, RankProjection,
} from '@sis/shared';
export { LOCALE_OPTIONS } from '@sis/shared';

import type {
  RankingMetric, RankChangeLookback, WeekStartOption, LocaleSetting, AlbumTrackDisplay, SessionTrackingDisplay, SessionRankDisplay, NowPlayingDisplay, SocialVisibility, DateRangeParams,
  TopTrackItem, TopArtistItem, TopAlbumItem,
  GenreItem, DiscoveryItem, HistoryResponse, ListeningTimeItem, HeatmapItem, StreaksData, MonthlyDistributionItem,
  NowPlayingResponse, DevicesResponse, PlayContextRequest, PlayContextResponse, FriendsActivityResponse,
  ArtistDetail, AlbumDetail, AlbumCover, TrackDetail,
  SearchResults, ChartHistoryResponse, ChartResponse, RecordsResponse,
  AccoladesResponse, Rankings, RankingHistoryPoint, RankingHistoryPointWithCrossovers, HealthData,
  MergeRule, MergeSuggestion, RemergePreview, BatchMergeResult, MeResponse, UserRecord, ImportResult,
  PlaylistStrategy, GeneratedPlaylist, PlaylistListResponse, PlaylistPreviewResponse,
  LibraryPlaylistListResponse, LibraryPlaylistDetail,
  ProjectedRankingsResponse,
} from '@sis/shared';

// cache layer: L1 (memoria, ms) + L2 (IndexedDB, persistente) con SWR.
// se enchufa vía lookup()/fetchAndStore(); ttls por endpoint en cache/config.ts.
import * as cache from './cache/cache';
import { isNoCache } from './cache/config';

const BASE = '/api';

const responseCache = new Map<string, cache.L1Entry>();
const inflightRequests = new Map<string, Promise<unknown>>();
const cacheDeps: cache.CacheDeps = { l1: responseCache, inflight: inflightRequests };

// construye una cache key canónica (path + query ordenado).
// independiente del origin para que sobreviva entre dominios.
function buildKey(path: string, params?: Record<string, string>): string {
  if (!params) return path;
  const keys = Object.keys(params).sort();
  const qs = keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  return qs ? `${path}?${qs}` : path;
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// fetch crudo (sin cache). Maneja 401 → redirect a login.
async function rawFetch<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (res.status === 401) {
    window.location.href = '/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search);
    throw new Error('No autorizado');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// wrapper genérico para llamadas GET. SWR por defecto.
//
// con signal (AbortController): se omite el cache read (el caller quiere data
// fresca y poder abortarla), pero la respuesta exitosa SÍ pobla el cache para
// que navegaciones posteriores sin signal hagan hit.
async function apiFetch<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = buildUrl(path, params);

  if (isNoCache(path)) {
    return rawFetch<T>(url, signal);
  }

  const cacheKey = buildKey(path, params);
  const fetcher = () => rawFetch<unknown>(url, signal);

  if (signal) {
    // bypass del cache read + dedup (la dedup compartiría signal entre callers).
    const data = await rawFetch<T>(url, signal);
    cache.writeCache(cacheKey, data, cacheDeps);
    return data;
  }

  // 1) intenta servir desde cache (L1 → L2, con SWR).
  const hit = await cache.lookup<T>(path, cacheKey, fetcher, cacheDeps);
  if (hit) return hit.data;

  // 2) miss: fetch bloqueante con dedup + escritura en ambas capas.
  return cache.fetchAndStore<T>(path, cacheKey, fetcher, cacheDeps);
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
  artistShowAlbumAccolades: boolean;
  artistShowTrackAccolades: boolean;
  sessionRankDisplay: SessionRankDisplay;
  sessionRankLimitYear: string;
  sessionRankLimitAll: string;
  sessionTrackingDisplay: SessionTrackingDisplay;
  nowPlayingDisplay: NowPlayingDisplay;
  socialVisibility: SocialVisibility;
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
  artistShowAlbumAccolades: true,
  artistShowTrackAccolades: true,
  sessionRankDisplay: 'all+ytd',
  sessionRankLimitYear: '50',
  sessionRankLimitAll: '200',
  sessionTrackingDisplay: 'all',
  nowPlayingDisplay: 'auto',
  socialVisibility: 'visible',
  lastPeriodWeek: null,
  lastPeriodMonth: null,
  lastPeriodYear: null,
};

let settingsCache: SettingsData = { ...SETTINGS_DEFAULTS };
let settingsLoaded = false;

const lsKey = (key: string) =>
  key.startsWith('lastPeriod') ? `sis:lastPeriod:${key.slice(10).toLowerCase()}` : `sis:${key}`;

export async function loadSettings(): Promise<void> {
  let data: Record<string, string> = {};
  try {
    data = await apiFetch<Record<string, string>>('/settings');
  } catch {
    for (const key of Object.keys(SETTINGS_DEFAULTS)) {
      const v = localStorage.getItem(lsKey(key));
      if (v !== null) data[key] = v;
    }
  }

  settingsCache = { ...SETTINGS_DEFAULTS };
  for (const [key, def] of Object.entries(SETTINGS_DEFAULTS)) {
    const raw = data[key];
    if (typeof def === 'boolean') (settingsCache as any)[key] = raw !== undefined ? raw !== 'false' : def;
    else if (def === null) (settingsCache as any)[key] = raw || null;
    else (settingsCache as any)[key] = raw || def;
  }

  for (const [key, val] of Object.entries(settingsCache)) {
    if (val !== null) localStorage.setItem(lsKey(key), String(val));
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

function stringSetting<T extends string>(key: keyof SettingsData, defaultValue: T) {
  return [
    (): T => settingsLoaded ? settingsCache[key] as T : (localStorage.getItem(`sis:${key}`) as T) || defaultValue,
    (v: T) => { (settingsCache as any)[key] = v; localStorage.setItem(`sis:${key}`, v); updateSetting({ [key]: v }); },
  ] as const;
}

function boolSetting(key: keyof SettingsData) {
  return [
    (): boolean => settingsLoaded ? settingsCache[key] as boolean : localStorage.getItem(`sis:${key}`) !== 'false',
    (v: boolean) => { (settingsCache as any)[key] = v; localStorage.setItem(`sis:${key}`, String(v)); updateSetting({ [key]: String(v) }); },
  ] as const;
}

function withNotify<T>(setter: (v: T) => void) {
  const listeners: ((v: T) => void)[] = [];
  return {
    set(v: T) { setter(v); for (const fn of listeners) fn(v); },
    onChange(fn: (v: T) => void): () => void {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
  };
}

export const [getRankingMetric, setRankingMetric] = stringSetting<RankingMetric>('rankingMetric', 'time');
export const [getRankChangeLookback, setRankChangeLookback] = stringSetting<RankChangeLookback>('rankChangeLookback', 'disabled');
export const [getWeekStart, setWeekStart] = stringSetting<WeekStartOption>('weekStart', 'friday');
export const [getRawLocale, setLocale] = stringSetting<LocaleSetting>('locale', 'auto');
export const [getAlbumTrackDisplay, setAlbumTrackDisplay] = stringSetting<AlbumTrackDisplay>('albumTrackDisplay', 'fill');
export const [getAlbumShowDuration, setAlbumShowDuration] = boolSetting('albumShowDuration');
export const [getAlbumShowAccolades, setAlbumShowAccolades] = boolSetting('albumShowAccolades');
export const [getArtistShowAlbumAccolades, setArtistShowAlbumAccolades] = boolSetting('artistShowAlbumAccolades');
export const [getArtistShowTrackAccolades, setArtistShowTrackAccolades] = boolSetting('artistShowTrackAccolades');
export const [getSocialVisibility, setSocialVisibility] = stringSetting<SocialVisibility>('socialVisibility', 'visible');

export function getLocale(): string {
  const raw = getRawLocale();
  return raw === 'auto' ? navigator.language : raw;
}

const [_getSessionRankDisplay, _setSessionRankDisplay] = stringSetting<SessionRankDisplay>('sessionRankDisplay', 'all+ytd');
const _srd = withNotify<SessionRankDisplay>(_setSessionRankDisplay);
export const getSessionRankDisplay = _getSessionRankDisplay;
export const setSessionRankDisplay = _srd.set;
export const onSessionRankDisplayChange = _srd.onChange;

export const [getSessionRankLimitYear, setSessionRankLimitYear] = stringSetting('sessionRankLimitYear', '50');
export const [getSessionRankLimitAll, setSessionRankLimitAll] = stringSetting('sessionRankLimitAll', '200');

const [_getSessionTrackingDisplay, _setSessionTrackingDisplay] = stringSetting<SessionTrackingDisplay>('sessionTrackingDisplay', 'all');
const _std = withNotify<SessionTrackingDisplay>(_setSessionTrackingDisplay);
export const getSessionTrackingDisplay = _getSessionTrackingDisplay;
export const setSessionTrackingDisplay = _std.set;
export const onSessionTrackingDisplayChange = _std.onChange;

const [_getNowPlayingDisplay, _setNowPlayingDisplay] = stringSetting<NowPlayingDisplay>('nowPlayingDisplay', 'auto');
const _npd = withNotify<NowPlayingDisplay>(_setNowPlayingDisplay);
export const getNowPlayingDisplay = _getNowPlayingDisplay;
export const setNowPlayingDisplay = _npd.set;
export const onNowPlayingDisplayChange = _npd.onChange;

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

// invalidar cache (tras mutaciones o cuando se necesite data fresca).
// limpia L1 + L2 por prefijo de path; sin prefijo → limpia todo L1 y dispara
// purga de L2 a un prefijo amplio.
export function invalidateCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    cache.clearL1(cacheDeps);
    cache.invalidateByPath('/', cacheDeps);
    return;
  }
  cache.invalidateByPath(pathPrefix, cacheDeps);
}

// mapeo de mutaciones → prefijos a invalidar. Match por método+prefijo de path.
// orden importa: el primer match aplica. La lista es deliberadamente concisa;
// `/` (último fallback para POST/PUT/DELETE desconocidos) limpia todo.
const MUTATION_INVALIDATIONS: Array<{ method: string; prefix: string; clear: string[] }> = [
  { method: 'POST',   prefix: '/import',                    clear: ['/stats/', '/now-playing/friends'] },
  { method: 'DELETE', prefix: '/stats/history',             clear: ['/stats/'] },
  { method: 'POST',   prefix: '/admin/merge-album',         clear: ['/stats/', '/playlists/'] },
  { method: 'POST',   prefix: '/admin/batch-merge-tracks',  clear: ['/stats/', '/playlists/'] },
  { method: 'POST',   prefix: '/admin/merge',               clear: ['/stats/', '/playlists/'] },
  { method: 'DELETE', prefix: '/admin/merge/',              clear: ['/stats/', '/playlists/'] },
  { method: 'PATCH',  prefix: '/admin/track/',              clear: ['/stats/'] },
  { method: 'POST',   prefix: '/admin/track/',              clear: ['/stats/'] },
  { method: 'POST',   prefix: '/admin/users',               clear: ['/admin/users'] },
  { method: 'PUT',    prefix: '/admin/users/',              clear: ['/admin/users'] },
  { method: 'DELETE', prefix: '/admin/users/',              clear: ['/admin/users'] },
  { method: 'PUT',    prefix: '/covers/album/',             clear: ['/stats/album/', '/stats/top-albums', '/covers/'] },
  { method: 'POST',   prefix: '/covers/',                   clear: ['/stats/album/', '/stats/top-albums', '/covers/'] },
  { method: 'PUT',    prefix: '/now-playing/like/',         clear: ['/now-playing/like/'] },
  { method: 'DELETE', prefix: '/now-playing/like/',         clear: ['/now-playing/like/'] },
  { method: 'POST',   prefix: '/now-playing/queue',         clear: [] },
  { method: 'PUT',    prefix: '/now-playing/',              clear: [] },
  { method: 'POST',   prefix: '/now-playing/',              clear: [] },
  { method: 'POST',   prefix: '/playlists/library/sync',    clear: ['/playlists/library'] },
  { method: 'POST',   prefix: '/playlists/library/',        clear: ['/playlists/library', '/now-playing/playlists/'] },
  { method: 'DELETE', prefix: '/playlists/library/',        clear: ['/playlists/library', '/now-playing/playlists/'] },
  { method: 'POST',   prefix: '/playlists/generate',        clear: ['/playlists'] },
  { method: 'POST',   prefix: '/playlists/',                clear: ['/playlists'] },
  { method: 'DELETE', prefix: '/playlists/',                clear: ['/playlists'] },
];

function applyMutationInvalidation(method: string, path: string): void {
  for (const rule of MUTATION_INVALIDATIONS) {
    if (rule.method !== method) continue;
    if (path === rule.prefix || path.startsWith(rule.prefix)) {
      for (const p of rule.clear) cache.invalidateByPath(p, cacheDeps);
      return;
    }
  }
  // fallback: si no hay regla, conservador → limpia todo el cache.
  cache.clearL1(cacheDeps);
  cache.invalidateByPath('/', cacheDeps);
}

// POST/PUT/DELETE/PATCH helper para mutaciones.
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
  applyMutationInvalidation(method, path);
  return res.json();
}

function rangeParams(range: string, dates?: DateRangeParams): Record<string, string> {
  if (dates) return { startDate: dates.startDate, endDate: dates.endDate };
  return { range };
}

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

  batchMergeTracks: (trackPairs: Array<{ sourceTrackId: string; targetTrackId: string }>) =>
    apiMutate<BatchMergeResult>('POST', '/admin/batch-merge-tracks', { trackPairs }),

  // user management (admin)
  me: () => apiFetch<MeResponse>('/me'),
  listUsers: () => apiFetch<UserRecord[]>('/admin/users'),
  addUser: (spotifyId: string) => apiMutate<UserRecord>('POST', '/admin/users', { spotifyId }),
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
    const res = await fetch(`${BASE}/import`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    applyMutationInvalidation('POST', '/import');
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
    applyMutationInvalidation('POST', `/covers/${albumId}`);
    return res.json();
  },
};
