import type { TopTrackItem, TopAlbumItem } from './top.js';
import type { HistoryItem } from './history.js';
import type { PlaylistPresenceItem } from './records.js';
import type { TrackVersion } from './versions.js';
import type { RelatedArtist } from './relations.js';
import type { Concert, ConcertRef } from './concerts.js';

export interface Rankings {
  week: number | null;
  month: number | null;
  thisYear: number | null;
  all: number | null;
}

// lanzamiento conocido de un artista (solo álbumes/singles que el usuario ha escuchado)
export interface ReleaseEvent {
  id: string;
  name: string;
  date: string;
  albumType: string | null;
  imageUrl: string | null;
}

// foto de artista observada (o subida a mano): mismo modelo que AlbumCover, pero el
// historial lo alimenta el barrido periódico de /v1/artists, no la ingesta de plays
export interface ArtistImage {
  id: number;
  imageUrl: string;
  source: 'spotify' | 'upload';
  observedAt: string;
}

export interface ArtistDetail {
  artist: { id: string; name: string; imageUrl: string | null; backgroundUrl: string | null; genres: string[] };
  images?: ArtistImage[];
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  releases: ReleaseEvent[];
  topTracks: TopTrackItem[];
  topAlbums: TopAlbumItem[];
  recentPlays: HistoryItem[];
  mergedFrom: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
  mergedInto: { id: string; ruleId: number; name: string; imageUrl: string | null } | null;
  // vínculos declarados que no alteran el tracking (ver relations.ts)
  relatedArtists: RelatedArtist[];
  // conciertos del usuario para este artista (resueltos sobre el grupo de merge);
  // doblan como marcadores de las gráficas junto a los releases
  concerts?: Concert[];
}

// single de adelanto ligado a un álbum: es un ReleaseEvent (sirve de marcador en las gráficas)
// enriquecido con las escuchas del usuario para poder rankearlo en la sección "Singles"
export interface AlbumSingle extends ReleaseEvent {
  playCount: number;
  totalMs: number;
}

export interface AlbumCover {
  id: number;
  imageUrl: string;
  source: 'spotify' | 'musicbrainz' | 'upload';
  observedAt: string;
}

// valoración del usuario para un álbum: estrellas enteras + texto opcional
export interface AlbumRating {
  rating: number;
  review: string | null;
  updatedAt: string;
}

export interface AlbumDetail {
  album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null; totalTracks: number | null; albumType: string | null };
  artists: { id: string; name: string; imageUrl: string | null }[];
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  tracks: TopTrackItem[];
  recentPlays: HistoryItem[];
  // singles del mismo artista ligados al álbum (adelantos): marcadores de las gráficas + sección propia
  relatedSingles: AlbumSingle[];
  mergedFrom: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
  mergedInto: { id: string; ruleId: number; name: string; imageUrl: string | null } | null;
  covers?: AlbumCover[];
  // valoración del usuario (null = sin valorar); se resuelve sobre el grupo de merge entero
  rating?: AlbumRating | null;
}

export interface TrackDetail {
  track: {
    id: string; name: string; durationMs: number; trackNumber: number | null; explicit: boolean;
    album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null; albumType: string | null } | null;
    artists: { id: string; name: string; imageUrl: string | null }[];
  };
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  dailySeries: { day: string; play_count: number; total_ms: number }[];
  albumBreakdown: { albumId: string; playCount: number; totalMs: number; album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null; albumType?: string | null } }[];
  recentPlays: HistoryItem[];
  mergedFrom: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
  mergedInto: { id: string; ruleId: number; name: string; imageUrl: string | null } | null;
  playlists: PlaylistPresenceItem[];
  // conciertos asistidos en cuyo setlist figura este tema: "lo escuchaste en
  // directo". Vacío no es lo mismo que no haber ido — puede que el setlist no
  // esté importado
  liveConcerts?: ConcertRef[];
  // otras versiones del mismo tema (live, remix, remaster...) que el usuario ha escuchado
  versions: TrackVersion[];
}
