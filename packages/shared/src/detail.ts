import type { TopTrackItem, TopAlbumItem } from './top.js';
import type { HistoryItem } from './history.js';
import type { PlaylistPresenceItem } from './records.js';
import type { TrackVersion } from './versions.js';
import type { EntityRelation } from './relations.js';
import type { Concert, ConcertRef } from './concerts.js';
import type { AlbumCollectionSummary, CollectionMember, CollectionRef } from './collections.js';

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
  // merges (hard) + vínculos declarados (soft) en una sola lista: los pinta la misma
  // sección, y separarlos hacía que una página renderizara unos y se olvidara de otros.
  // mergedInto/mergedFrom se derivan de aquí por `kind` (ver relations.ts)
  relations: EntityRelation[];
  // conciertos del usuario para este artista (resueltos sobre el grupo de merge);
  // doblan como marcadores de las gráficas junto a los releases
  concerts?: Concert[];
  // álbumes lógicos del artista (ver collections.ts): agrupan discos y temas suyos y
  // los sustituyen en los rankings
  collections?: AlbumCollectionSummary[];
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
  // color: pick manual (#rrggbb) que manda sobre el extraído de la portada; null = sin pick
  album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null; totalTracks: number | null; albumType: string | null; color: string | null };
  artists: { id: string; name: string; imageUrl: string | null }[];
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  tracks: TopTrackItem[];
  recentPlays: HistoryItem[];
  // singles del mismo artista ligados al álbum (adelantos): marcadores de las gráficas + sección propia
  relatedSingles: AlbumSingle[];
  // merges de esta entidad, en la misma lista que las relaciones del artista (ver
  // relations.ts). Un álbum o un tema no tiene relaciones soft: aquí sólo hay hard.
  relations: EntityRelation[];
  covers?: AlbumCover[];
  // valoración del usuario (null = sin valorar); se resuelve sobre el grupo de merge entero
  rating?: AlbumRating | null;
  // colección que se lo ha llevado: mientras exista, es ELLA quien rankea por este
  // álbum, así que la página lo dice y apaga sus badges de ranking
  collection?: CollectionRef | null;
  // ESTE álbum es una colección (`collection:N`): sus miembros y sus notas. La página
  // es la misma que la de cualquier álbum — de ahí que la colección herede portada,
  // color, valoración y secciones — y sólo añade la sección de miembros
  members?: CollectionMember[];
  notes?: string | null;
}

export interface TrackDetail {
  track: {
    id: string; name: string; durationMs: number; trackNumber: number | null; explicit: boolean;
    album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null; albumType: string | null; color?: string | null } | null;
    artists: { id: string; name: string; imageUrl: string | null }[];
  };
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  dailySeries: { day: string; play_count: number; total_ms: number }[];
  albumBreakdown: { albumId: string; playCount: number; totalMs: number; album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null; albumType?: string | null } }[];
  recentPlays: HistoryItem[];
  // merges de esta entidad, en la misma lista que las relaciones del artista (ver
  // relations.ts). Un álbum o un tema no tiene relaciones soft: aquí sólo hay hard.
  relations: EntityRelation[];
  playlists: PlaylistPresenceItem[];
  // conciertos asistidos en cuyo setlist figura este tema: "lo escuchaste en
  // directo". Vacío no es lo mismo que no haber ido — puede que el setlist no
  // esté importado
  liveConcerts?: ConcertRef[];
  // otras versiones del mismo tema (live, remix, remaster...) que el usuario ha escuchado
  versions: TrackVersion[];
  // colección que se lo ha llevado, directamente o a través de su álbum (ver
  // CollectionRef.direct); mientras exista, ella rankea en su lugar en el eje álbum
  collection?: CollectionRef | null;
}
