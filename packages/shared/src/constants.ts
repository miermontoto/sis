// umbral mínimo (ms) para que un play se cuente como reproducción válida.
// Aplicado consistente en API (insert) y UI (filtros).
export const MIN_PLAY_MS = 30_000;

// rangos de tiempo para stats — usados por la UI para construir selectores
// y por el backend para resolver `getRangeStart()`.
// Sentinels: 0 = all time, -1 = thisYear (Jan 1 del año actual UTC).
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

// rango asumido cuando la query no trae `range` (o trae uno no reconocido)
export const DEFAULT_TIME_RANGE: TimeRange = 'month';

// `custom` no está en TIME_RANGES: no es un rango relativo sino la señal de que
// la ventana viene en startDate/endDate. Un `range` que no sea una clave de
// TIME_RANGES no puede pasar a getRangeStart(), que haría aritmética con
// undefined y devolvería una fecha inválida.
export function isTimeRange(range: string): range is TimeRange {
  return Object.prototype.hasOwnProperty.call(TIME_RANGES, range);
}

// tamaño del chart (cuántas posiciones tiene el billboard)
export const CHART_SIZE = 25;

// ítems que pide la página /top y nº de géneros de /insights. Viven aquí para
// que el prewarmer del cache use las MISMAS claves que las vistas: la clave
// incluye `limit`, así que un valor distinto calienta entradas que nadie lee.
export const TOP_PAGE_LIMIT = 200;
export const INSIGHTS_GENRES_LIMIT = 10;

// posiciones que cuentan como "record" (lo que muestra la página /records)
// también es el tope para otorgar accolades en vistas de detalle
export const RECORDS_LIMIT = 10;

// --- valoraciones ---

// escala de las valoraciones de álbum: estrellas enteras, sin medias
export const ALBUM_RATING_MIN = 0;
export const ALBUM_RATING_MAX = 5;

// tope de caracteres del texto opcional de una valoración
export const ALBUM_REVIEW_MAX_CHARS = 2000;

// --- conciertos ---

// topes de los campos de texto libre del registro de un concierto
export const CONCERT_TEXT_MAX_CHARS = 200;
export const CONCERT_NOTES_MAX_CHARS = 2000;

// años que ofrece el desplegable de la búsqueda de setlist.fm, hacia atrás desde
// el actual. No se derivan de los datos a propósito: sacar el año del bolo más
// antiguo obligaría a pedir la última página de la búsqueda sin filtrar, otra
// llamada a una API que ya va throttleada, para afinar un desplegable
export const CONCERT_YEAR_OPTIONS = 60;

// páginas de setlist.fm que se encadenan solas al buscar. La lista se lee de una
// sola vez en vez de a saltos: paginar a mano hacía que el listado pareciera
// acabarse en el último bolo de la página 1. 3 páginas = 60 bolos, que cubre un
// año entero incluso de un artista de gira larga (Bad Bunny 2026: 48)
export const SETLISTFM_AUTO_PAGES = 3;

// --- social ---

// bytes aleatorios del token de share link (48 chars hex)
export const SHARE_TOKEN_BYTES = 24;

// top-N por usuario usado para calcular el solapamiento en compare
export const COMPARE_TOP_LIMIT = 50;

// ítems por lista (artists/tracks/albums) en la vista de perfil
export const PROFILE_TOP_LIMIT = 10;

// ventana de actividad reciente del feed (días)
export const FEED_RECENT_DAYS = 7;

// nº de plays en el stream cronológico del feed
export const FEED_PLAYS_LIMIT = 50;

// decaimiento de peso por rank en el cálculo de overlap:
// el ítem en rank r pesa DECAY^(r-1), premiando compartir favoritos altos
export const SOCIAL_OVERLAP_WEIGHT_DECAY = 0.9;

// pesos por tipo de entidad en el overlap combinado de compare
// (artistas = gusto general, tracks/albums = coincidencias más puntuales)
export const OVERLAP_TYPE_WEIGHTS = { artists: 0.5, tracks: 0.3, albums: 0.2 } as const;
