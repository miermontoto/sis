// versión snapshot (formato minecraft: YYwWWx)
export const VERSION = '26w23h';

// re-exportar desde shared (single source of truth)
export { MIN_PLAY_MS, TIME_RANGES, CHART_SIZE, RECORDS_LIMIT, SHARE_TOKEN_BYTES, COMPARE_TOP_LIMIT, PROFILE_TOP_LIMIT, FEED_RECENT_DAYS, FEED_PLAYS_LIMIT, SOCIAL_OVERLAP_WEIGHT_DECAY, OVERLAP_TYPE_WEIGHTS } from '@sis/shared';
export type { TimeRange } from '@sis/shared';

// intervalos de polling en ms
export const CURRENTLY_PLAYING_INTERVAL_MS = 30_000; // fallback en error
export const CURRENTLY_PLAYING_MIN_MS = 5_000;
export const CURRENTLY_PLAYING_MAX_MS = 60_000;
export const CURRENTLY_PLAYING_BUFFER_MS = 3_000;
export const CURRENTLY_PLAYING_PAUSED_MS = 60_000;
export const CURRENTLY_PLAYING_IDLE_MS = 90_000;
export const SESSION_GAP_MS = 10 * 60_000;
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
  'user-library-modify',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-modify-private',
  'playlist-modify-public',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

// scopes necesarios para crear playlists
export const PLAYLIST_SCOPES = ['playlist-modify-private', 'playlist-modify-public', 'playlist-read-private', 'playlist-read-collaborative'];

// URLs de la API de spotify
export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

// paginación por defecto
export const DEFAULT_PAGE_LIMIT = 50;

// intervalo de refresco de metadata de entidades (24h)
export const METADATA_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;

// intervalo de recomputo de records (6h)
export const RECORDS_CACHE_INTERVAL_MS = 6 * 60 * 60_000;

// intervalo de resolución de entidades import: (30 min)
export const RESOLVE_INTERVAL_MS = 30 * 60_000;

// intervalo de verificación de artistas/álbumes de tracks (30 min)
export const ARTIST_FIX_INTERVAL_MS = 30 * 60_000;

// intervalo de sincronización de playlists de spotify (6h)
export const PLAYLIST_SYNC_INTERVAL_MS = 6 * 60 * 60_000;

// --- social / share links ---

// dimensiones de la tarjeta OG (estándar open graph)
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

// TTL del caché en memoria de imágenes OG generadas (10 min)
export const OG_IMAGE_CACHE_MS = 10 * 60_000;

// umbral de staleness para now-playing en superficies sociales (2 min)
export const SOCIAL_NOW_PLAYING_STALE_MS = 2 * 60_000;
