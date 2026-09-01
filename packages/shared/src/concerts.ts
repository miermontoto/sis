import type { TrackInfo } from './entities.js';

// registro de conciertos a los que el usuario ha asistido: una anotación por
// usuario sobre un artista (misma familia que album_ratings) con setlist opcional
// importado de setlist.fm y sus canciones resueltas contra la librería.

// canción de un setlist. trackId es la resolución best-effort contra el catálogo
// del usuario: null = no la tiene (nunca la escuchó, o el nombre no casa). NUNCA
// se acuñan tracks sintéticos desde aquí — un setlist prueba que la banda tocó
// algo, no que el usuario lo haya escuchado.
export interface ConcertSong {
  position: number;
  name: string;
  trackId: string | null;
  // anotación de setlist.fm ("con X a la guitarra", "acústico", tease…)
  info: string | null;
  isEncore: boolean;
  // versión de otro artista: el nombre del original
  coverArtist: string | null;
  // escuchas del usuario ANTES de la fecha del concierto; sólo si trackId resolvió
  playsBefore?: number;
  // metadatos del track resuelto, para pintar la fila igual que en el resto de
  // listas (carátula, artistas). null = la canción no está en la librería
  track?: TrackInfo | null;
}

export interface Concert {
  id: number;
  artistId: string;
  artistName: string;
  artistImageUrl: string | null;
  // YYYY-MM-DD (fecha local del bolo, sin hora: setlist.fm tampoco la da)
  date: string;
  venue: string | null;
  city: string | null;
  country: string | null;
  tour: string | null;
  notes: string | null;
  // procedencia del setlist: null = alta manual
  setlistfmId: string | null;
  setlistfmUrl: string | null;
  songs: ConcertSong[];
  // resumen del matching, precalculado para no recorrer songs en el cliente
  songsMatched: number;
  songsTotal: number;
}

// referencia mínima a un concierto asistido, para las superficies que sólo
// necesitan decir "estuviste aquí" (el badge de directo en artista y track) sin
// arrastrar el setlist entero
export interface ConcertRef {
  id: number;
  artistId: string;
  artistName: string;
  date: string;
  venue: string | null;
  city: string | null;
}

// totales de la página global. byYear va completo (sin huecos) para la barra.
export interface ConcertStats {
  total: number;
  artists: number;
  venues: number;
  cities: number;
  countries: number;
  firstDate: string | null;
  lastDate: string | null;
  byYear: { year: string; count: number }[];
  topArtists: { artistId: string; name: string; imageUrl: string | null; count: number }[];
}

export interface ConcertListResponse {
  concerts: Concert[];
  stats: ConcertStats;
}

// --- setlist.fm ---

// un bolo tal y como lo devuelve setlist.fm, ya normalizado (su eventDate viene
// en dd-MM-yyyy y las canciones repartidas en sets anidados)
export interface SetlistfmShow {
  id: string;
  url: string;
  date: string;
  artistName: string;
  venue: string | null;
  city: string | null;
  country: string | null;
  tour: string | null;
  songs: { name: string; info: string | null; isEncore: boolean; coverArtist: string | null }[];
}

// `configured` distingue "sin credenciales" de "sin resultados": la UI ofrece el
// alta manual en el primer caso en vez de un vacío sin explicación
export interface SetlistfmSearchResponse {
  configured: boolean;
  shows: SetlistfmShow[];
  page: number;
  totalPages: number;
  // ya registrados por el usuario, para marcarlos en la lista de candidatos
  importedIds: string[];
}

// payload de alta/edición manual (los campos de texto se recortan en la ruta)
export interface ConcertInput {
  artistId: string;
  date: string;
  venue?: string | null;
  city?: string | null;
  country?: string | null;
  tour?: string | null;
  notes?: string | null;
}
