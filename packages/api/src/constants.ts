// versión snapshot (formato minecraft: YYwWWx)
export const VERSION = '26w31i';

// scheme del deep link de la app android (oauth móvil): debe coincidir con el
// intent-filter de AndroidManifest.xml y con el listener del cliente web
export const MOBILE_SCHEME = 'info.mier.sis';

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

// --- last.fm ---

// URLs de la API y del flujo de autorización web de last.fm
export const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_AUTH_URL = 'https://www.last.fm/api/auth/';

// intervalo del sync de scrobbles (mismo ritmo que recently-played)
export const LASTFM_POLL_INTERVAL_MS = 5 * 60_000;

// máximo de scrobbles por página de user.getRecentTracks
export const LASTFM_PAGE_LIMIT = 200;

// espaciado mínimo entre requests (~4 req/s, bajo el límite de last.fm)
export const LASTFM_REQUEST_SPACING_MS = 260;

// tope de páginas por tick del sync incremental (el backfill no lo usa)
export const LASTFM_SYNC_MAX_PAGES = 10;

// periodo de gracia antes de ingerir un scrobble (usuarios con spotify): el
// scrobble lleva timestamp de inicio y menos info (sin duración ni IDs), así
// que se espera a que el pipeline de spotify registre el play primero (fin de
// track + poll de 5 min) y el scrobble solo entra si sigue faltando
export const LASTFM_SYNC_GRACE_MS = 20 * 60_000;

// prefijo del spotify_id sintético de usuarios que solo tienen last.fm
export const LASTFM_ID_PREFIX = 'lastfm:';

// nº máximo de top-tags de last.fm que se guardan como géneros de un artista
export const LASTFM_ENRICH_MAX_TAGS = 5;

// paginación por defecto
export const DEFAULT_PAGE_LIMIT = 50;

// nº máximo de scrobbles manuales aceptados en una sola petición (POST /stats/history)
export const MANUAL_SCROBBLE_MAX = 500;

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

// --- auto-regeneración de playlists generadas ---

// cada cuánto el scheduler comprueba qué playlists tocan regenerar (1h). la
// cadencia real por playlist la fija regenerate_interval_ms (ver presets abajo)
export const AUTO_REGENERATE_CHECK_INTERVAL_MS = 60 * 60_000;

// presets de cadencia ofrecidos al usuario (daily / weekly / monthly)
export const REGENERATE_INTERVAL_DAILY_MS = 24 * 60 * 60_000;
export const REGENERATE_INTERVAL_WEEKLY_MS = 7 * 24 * 60 * 60_000;
export const REGENERATE_INTERVAL_MONTHLY_MS = 30 * 24 * 60 * 60_000;

// mapa preset -> ms (única fuente de verdad para validar el body de /schedule)
export const REGENERATE_INTERVALS_MS: Record<'daily' | 'weekly' | 'monthly', number> = {
  daily: REGENERATE_INTERVAL_DAILY_MS,
  weekly: REGENERATE_INTERVAL_WEEKLY_MS,
  monthly: REGENERATE_INTERVAL_MONTHLY_MS,
};

// --- social / share links ---

// dimensiones de la tarjeta OG (estándar open graph)
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

// TTL del caché en memoria de imágenes OG generadas (10 min)
export const OG_IMAGE_CACHE_MS = 10 * 60_000;

// umbral de staleness para now-playing en superficies sociales (2 min)
export const SOCIAL_NOW_PLAYING_STALE_MS = 2 * 60_000;

// umbral de staleness del now-playing propio (spotify: refresca con el poll
// dinámico de currently-playing, así que 2 min basta)
export const NOW_PLAYING_STALE_MS = 2 * 60_000;

// staleness del now-playing de usuarios solo-last.fm: su estado solo se refresca
// cada LASTFM_POLL_INTERVAL_MS, así que la ventana debe cubrir ese intervalo +
// margen para que la tarjeta no parpadee entre ticks
export const LASTFM_NOW_PLAYING_STALE_MS = LASTFM_POLL_INTERVAL_MS + 60_000;

// --- notificaciones push ---

// máximo de notificaciones por usuario y día (throttle de 'record' y 'number_one')
export const NOTIFICATION_MAX_PER_DAY = 15;

// categorías de records cuyo top-10 se vigila para disparar un 'record'
export const RECORD_NOTIFY_CATEGORIES = ['peakWeekPlays', 'mostWeeksAtNo1', 'longestChartRun'] as const;

// número de entradas del top incluidas en el recap de 'chart_closing'
export const NOTIFY_CHART_TOP_N = 3;
