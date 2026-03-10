// intervalos de polling en ms
export const CURRENTLY_PLAYING_INTERVAL_MS = 30_000;
export const RECENTLY_PLAYED_INTERVAL_MS = 5 * 60_000;

// límites de la API de spotify
export const RECENTLY_PLAYED_LIMIT = 50;

// tiempo antes de expiración para refrescar token
export const TOKEN_REFRESH_BUFFER_MS = 60_000;

// scopes requeridos para la API de spotify
export const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'user-read-currently-playing',
  'user-top-read',
  'user-library-read',
  'user-read-playback-state',
].join(' ');

// URLs de la API de spotify
export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

// rangos de tiempo para stats
export const TIME_RANGES = {
  week: 7,
  month: 30,
  '3months': 90,
  '6months': 180,
  year: 365,
  thisYear: -1,
  all: 0,
} as const;

export type TimeRange = keyof typeof TIME_RANGES;

// paginación por defecto
export const DEFAULT_PAGE_LIMIT = 50;

// intervalo de refresco de metadata de entidades (24h)
export const METADATA_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
