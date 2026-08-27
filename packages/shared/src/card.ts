import type { EntityType } from './settings.js';

// Punto de la sparkline de la tarjeta: un día con actividad. La serie viaja
// dispersa (sólo días con plays) y la UI rellena los huecos a cero — una entidad
// escuchada 5 días de los últimos 90 manda 5 filas, no 90.
export interface EntityCardPoint {
  day: string;
  playCount: number;
  totalMs: number;
}

// Tarjeta compacta de una entidad: lo que se enseña al pasar el ratón por
// cualquier enlace de track/álbum/artista. Sólo lleva lo que se puede resolver
// con queries indexadas por entidad; el rank es un scan del historial y se pide
// aparte a /stats/rankings/:type/:id.
export interface EntityCard {
  type: EntityType;
  id: string;
  name: string;
  imageUrl: string | null;
  // créditos: artistas del track o del álbum. Vacío para un artista.
  artists: string[];
  // géneros del artista. Vacío para track y álbum.
  genres: string[];
  // contexto propio del tipo: álbum al que pertenece el track, duración del
  // track, año y nº de temas del álbum. Null en los tipos que no aplican.
  albumName: string | null;
  durationMs: number | null;
  releaseDate: string | null;
  totalTracks: number | null;
  playCount: number;
  totalMs: number;
  firstPlayed: string | null;
  lastPlayed: string | null;
  series: EntityCardPoint[];
  // ventana (días) que cubre la serie, para que la UI sepa cuántos huecos rellenar
  seriesDays: number;
}
