// versión snapshot (formato minecraft: YYwWWx)
export const VERSION = '26w36a';

// scheme del deep link de la app android (oauth móvil): debe coincidir con el
// intent-filter de AndroidManifest.xml y con el listener del cliente web
export const MOBILE_SCHEME = 'info.mier.sis';

// re-exportar desde shared (single source of truth)
export { MIN_PLAY_MS, TIME_RANGES, CHART_SIZE, RECORDS_LIMIT, SHARE_TOKEN_BYTES, COMPARE_TOP_LIMIT, PROFILE_TOP_LIMIT, FEED_RECENT_DAYS, FEED_PLAYS_LIMIT, SOCIAL_OVERLAP_WEIGHT_DECAY, OVERLAP_TYPE_WEIGHTS, DEFAULT_TIME_RANGE, isTimeRange } from '@sis/shared';
export type { TimeRange } from '@sis/shared';

// intervalos de polling en ms
export const CURRENTLY_PLAYING_INTERVAL_MS = 30_000; // fallback en error
export const CURRENTLY_PLAYING_MIN_MS = 5_000;
export const CURRENTLY_PLAYING_MAX_MS = 60_000;
export const CURRENTLY_PLAYING_BUFFER_MS = 3_000;
export const CURRENTLY_PLAYING_PAUSED_MS = 60_000;
export const CURRENTLY_PLAYING_IDLE_MS = 90_000;
// re-poll forzado tras una acción de reproducción (next/prev/play/pause/seek):
// spotify es eventualmente consistente, así que se espera un poco antes de leer
export const CURRENTLY_PLAYING_TRIGGER_MS = 800;
export const SESSION_GAP_MS = 10 * 60_000;
export const RECENTLY_PLAYED_INTERVAL_MS = 5 * 60_000;
// escalera de reintentos para volcar a historial un track recién terminado sin
// esperar al tick de 5 min: recently-played tarda unos segundos en reflejarlo
export const HISTORY_FLUSH_DELAYS_MS = [8_000, 25_000, 75_000];

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

// tope de tracks de una playlist con lista explícita (estrategia custom): evita
// que un cliente mande una lista arbitrariamente larga a Spotify
export const PLAYLIST_CUSTOM_MAX_TRACKS = 500;

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

// --- id.mier.info (sso propio, oidc) ---

// endpoints fijos del issuer (ver /.well-known/openid-configuration)
export const MIERID_ISSUER = 'https://id.mier.info';
export const MIERID_AUTH_URL = `${MIERID_ISSUER}/oidc/authorize`;
export const MIERID_TOKEN_URL = `${MIERID_ISSUER}/oidc/token`;
export const MIERID_USERINFO_URL = `${MIERID_ISSUER}/oidc/userinfo`;

// scopes mínimos para identidad (sub + perfil + email)
export const MIERID_SCOPES = 'openid profile email';

// prefijo del spotify_id sintético de usuarios que solo tienen mier.info
export const MIERID_ID_PREFIX = 'mierid:';

// paginación por defecto
export const DEFAULT_PAGE_LIMIT = 50;

// rankings-batch: tope de ids por petición (mismo tope que trackLimit/albumLimit de detail)
export const RANKINGS_BATCH_LIMIT = 200;

// /stats/charts/peaks/stream: trozos de ranking en vuelo a la vez. El escaneo va
// del año más reciente al más antiguo y cada trozo cierra parte de las entidades,
// así que solapar un par adelanta el trabajo sin ocupar el pool de lectura entero
export const PEAKS_SLICE_LOOKAHEAD = 2;

// tarjeta de hover de entidad (/stats/card/:type/:id): ventana que cubre la
// sparkline y granularidad con la que se pide. getEntitySeries deriva el truncado
// del nº de días (<=30 → un bucket por día), así que BUCKET_DAYS es lo que fuerza
// buckets diarios sobre la ventana entera; no es una ventana más corta
export const HOVER_CARD_SERIES_RANGE = '3months' as const;
export const HOVER_CARD_SERIES_BUCKET_DAYS = 30;

// nº máximo de scrobbles manuales aceptados en una sola petición (POST /stats/history)
export const MANUAL_SCROBBLE_MAX = 500;

// intervalo de refresco de metadata de entidades (24h)
export const METADATA_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;

// --- identidad multi-fuente (isrc/mbid) ---

// musicbrainz: base, user-agent y espaciado (~1 req/s que pide su API)
export const MB_API_BASE = 'https://musicbrainz.org/ws/2';
export const MB_USER_AGENT = 'SIS/1.0 (https://sis.mier.info)';
export const MB_DELAY_MS = 1100;
// score mínimo de una búsqueda musicbrainz para dar el match por bueno
export const MB_MIN_SCORE = 80;

// harvest de isrcs vía /tracks de spotify: lotes de 50 (límite del endpoint),
// capado por ciclo para no monopolizar la cuota de la API en el backfill inicial
export const ISRC_HARVEST_BATCH_SIZE = 50;
export const ISRC_HARVEST_MAX_BATCHES = 200;

// tope de consultas musicbrainz de identidad (mbid/isrc de tracks import:) por
// ciclo de enrichment: a 1 req/s el backfill inicial se reparte entre días
export const MB_IDENTITY_MAX_PER_CYCLE = 500;

// --- ingesta de scrobbles (API compatible listenbrainz, /1/*) ---

// bytes de entropía del token de scrobbling (base64url → 32 chars)
export const LISTEN_TOKEN_BYTES = 24;

// tope de listens por petición a /1/submit-listens (mismo límite que listenbrainz)
export const LISTENBRAINZ_MAX_LISTENS = 1000;

// tolerancia de timestamps futuros en listens (relojes desajustados de clientes)
export const LISTENBRAINZ_FUTURE_TOLERANCE_S = 600;

// intervalo de recomputo de records (6h)
export const RECORDS_CACHE_INTERVAL_MS = 6 * 60 * 60_000;

// plays mínimos de una semana para que su reparto cuente como record de dominancia:
// sin suelo, una semana con 3 escuchas regalaría un 100% a la primera entidad
export const DOMINANCE_MIN_WEEK_PLAYS = 50;

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

// --- cambios de posición recientes (/stats/recent-rank-changes) ---

// ventana de comparación por defecto y máxima, en días
export const RECENT_CHANGES_DEFAULT_DAYS = 7;
export const RECENT_CHANGES_MAX_DAYS = 90;

// máximo de entidades devueltas por tipo (artist/album/track)
export const RECENT_CHANGES_LIMIT = 20;

// edad a partir de la cual el resultado cacheado se refresca en background
// (stale-while-revalidate: siempre se sirve lo cacheado al instante)
export const RECENT_CHANGES_CACHE_MS = 10 * 60_000;

// SWR de la "tarjeta de identidad" social (resumen de perfil + rachas, siempre all-time):
// son scans completos del historial que cambian play a play sobre totales enormes,
// así que un valor de <10 min es indistinguible de fresco
export const PROFILE_CARD_CACHE_MS = 10 * 60_000;

// --- notificaciones push ---

// máximo de notificaciones por usuario y día, compartido entre los tipos frecuentes
// (record, aniversarios, milestones — ver THROTTLED_TYPES en notification-events.ts)
export const NOTIFICATION_MAX_PER_DAY = 15;

// categorías de records cuyo top-10 se vigila para disparar un 'record'
export const RECORD_NOTIFY_CATEGORIES = ['peakWeekPlays', 'mostWeeksAtNo1', 'longestChartRun'] as const;

// número de entradas del top incluidas en el recap de 'chart_closing'
export const NOTIFY_CHART_TOP_N = 3;

// mínimo de plays de una entidad para que dispare eventos de aniversario
// (evita notificar aniversarios de cosas escuchadas de pasada)
export const ANNIVERSARY_MIN_PLAYS = 25;

// escalera de umbrales de reproducciones que disparan un 'milestone'; al cruzar
// varios a la vez solo se notifica el más alto
export const MILESTONE_THRESHOLDS = [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000] as const;

// --- auto-match / auto-dedup de tracks al mergear álbumes ---

// similitud mínima de trigramas para emparejar dos tracks por nombre entre álbumes
export const TRACK_NAME_MATCH_THRESHOLD = 0.4;

// tolerancia de duración al deduplicar dos tracks con el mismo título base: si
// ambos declaran duración y difieren más que esto, son grabaciones distintas
// (una versión extendida que comparte base no debe colapsar con la original)
export const TRACK_DEDUP_DURATION_TOLERANCE_MS = 5_000;

// alcance del barrido masivo de candidatos: cuántos álbumes del top all-time se
// escanean. 'all' es un tope alto, no ilimitado, para acotar el peor caso
export const BULK_SCAN_LIMITS: Record<string, number> = {
  top100: 100,
  top200: 200,
  top500: 500,
  all: 100_000,
};

export const DEFAULT_BULK_SCAN_SCOPE = 'top200';

// preview de impacto de merges: umbral de "entra en el top N" y cuántos movimientos
// destacados se resumen antes de aplicar
export const IMPACT_TOP_THRESHOLD = 50;
export const IMPACT_BIGGEST_MOVERS = 3;
