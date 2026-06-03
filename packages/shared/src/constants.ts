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

// tamaño del chart (cuántas posiciones tiene el billboard)
export const CHART_SIZE = 25;

// posiciones que cuentan como "record" (lo que muestra la página /records)
// también es el tope para otorgar accolades en vistas de detalle
export const RECORDS_LIMIT = 10;

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
