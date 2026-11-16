import type { TopTrackItem } from './top.js';

// tal día como hoy en un año anterior con plays
export interface MemoryYear {
  year: number;
  yearsAgo: number;
  plays: number;
  totalMs: number;
  // el tema más escuchado ese día (null si no se pudo formatear); sin los campos de
  // cambio de puesto, que en un día suelto no significan nada
  topTrack: Omit<TopTrackItem, 'rankChange' | 'previousRank' | 'isNew'> | null;
}

// aniversario del día: primera escucha de un artista o publicación de un álbum
export interface MemoryAnniversary {
  type: 'artist' | 'album';
  id: string;
  name: string;
  imageUrl: string | null;
  // el artista principal del álbum (null en los de artista)
  artistId: string | null;
  artistName: string | null;
  // fecha original: la primera play (instante ISO) o el release_date
  date: string;
  years: number;
  plays: number;
}

// recuerdos de una fecha local (widgets "On this day" y "Anniversaries" del dashboard)
export interface MemoriesResponse {
  date: string;
  onThisDay: MemoryYear[];
  firstListens: MemoryAnniversary[];
  releases: MemoryAnniversary[];
}
