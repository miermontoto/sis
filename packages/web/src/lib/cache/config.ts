// configuración de TTL por familia de endpoints.
// ttl: durante este tiempo la respuesta se considera fresca (no revalida).
// maxStale: dentro de este tiempo se sirve de cache + revalidación en background.
// más allá de maxStale el cache se trata como miss y bloquea hasta la respuesta.

export interface EndpointConfig {
  ttl: number;
  maxStale: number;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const DEFAULT_CONFIG: EndpointConfig = { ttl: 10 * MIN, maxStale: 24 * HOUR };

// endpoints que nunca se cachean — siempre red.
// `/settings` es el bootstrap de preferencias: debe ser autoritativo en cada
// arranque, no servirse de un snapshot viejo de IndexedDB (que en el apk
// sobrevive a los cold starts). Cachearlo revertía cambios de ajustes y, con el
// marcador de charts cerrados, impedía respetar un descarte hecho en otro
// dispositivo. Offline: loadSettings cae a localStorage vía su try/catch.
const NO_CACHE_PATHS = new Set<string>([
  '/now-playing',
  '/now-playing/live',
  '/lastfm',
  // estado de vinculación mier.info: la vinculación ocurre server-side vía
  // redirect oauth (sin apiMutate que invalide), así que un snapshot cacheado
  // seguiría mostrando "Connect" tras volver del callback
  '/mierid',
  // token de scrobbling: secreto y regenerable, nunca a IndexedDB
  '/listen-token',
  '/now-playing/devices',
  '/health',
  '/settings',
]);

// matcher prefijo → config (orden importa: primer match gana).
const RULES: Array<[string, EndpointConfig]> = [
  ['/now-playing/friends',          { ttl: 1 * MIN,  maxStale: 10 * MIN }],
  ['/now-playing/like/',            { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/now-playing/playlists/',       { ttl: 5 * MIN,  maxStale: 1 * HOUR }],

  ['/stats/projected-rankings',     { ttl: 30 * SEC, maxStale: 5 * MIN }],
  ['/stats/recent-rank-changes',    { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/stats/charts/periods',         { ttl: 30 * MIN, maxStale: 7 * DAY }],
  ['/stats/charts/peaks',           { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/stats/charts',                 { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/stats/chart-history/',         { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/stats/records',                { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/stats/accolades/',             { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/stats/rankings-batch',         { ttl: 30 * MIN, maxStale: 24 * HOUR }],
  ['/stats/rankings/',              { ttl: 30 * MIN, maxStale: 24 * HOUR }],
  ['/stats/ranking-history/',       { ttl: 30 * MIN, maxStale: 24 * HOUR }],
  ['/stats/artist/',                { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/stats/album/',                 { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/stats/track/',                 { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/stats/history',                { ttl: 2 * MIN,  maxStale: 1 * HOUR }],
  ['/stats/search',                 { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/stats/top-',                   { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/stats/listening-time',         { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/stats/heatmap',                { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/stats/monthly-distribution',   { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/stats/discovery',              { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/stats/streaks',                { ttl: 10 * MIN, maxStale: 24 * HOUR }],

  ['/settings',                     { ttl: 24 * HOUR, maxStale: 30 * DAY }],
  ['/me',                           { ttl: 1 * HOUR, maxStale: 7 * DAY }],
  ['/version',                      { ttl: 1 * HOUR, maxStale: 7 * DAY }],

  ['/playlists/library/',           { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/playlists/library',            { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/playlists/',                   { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/playlists',                    { ttl: 10 * MIN, maxStale: 24 * HOUR }],

  ['/social/users',                 { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/social/profile/',              { ttl: 10 * MIN, maxStale: 24 * HOUR }],
  ['/social/compare/',              { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/social/follows',               { ttl: 1 * MIN,  maxStale: 10 * MIN }],
  ['/social/feed',                  { ttl: 1 * MIN,  maxStale: 10 * MIN }],
  ['/social/share-links',           { ttl: 5 * MIN,  maxStale: 1 * HOUR }],

  ['/admin/merge-suggestions',      { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/admin/album-merge-preview',    { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/admin/album-remerge-preview',  { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/admin/merges',                 { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/admin/artist-relations',       { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
  ['/admin/users',                  { ttl: 5 * MIN,  maxStale: 1 * HOUR }],
];

export function isNoCache(path: string): boolean {
  return NO_CACHE_PATHS.has(path);
}

export function getConfig(path: string): EndpointConfig {
  for (const [prefix, cfg] of RULES) {
    if (path === prefix || path.startsWith(prefix)) return cfg;
  }
  return DEFAULT_CONFIG;
}

// versión del schema del cache. Incrementar para invalidar todo en boot.
export const SCHEMA_VERSION = 1;

// cap blando del cache persistente (bytes aproximados).
export const STORAGE_SOFT_CAP = 50 * 1024 * 1024;
