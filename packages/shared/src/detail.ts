import type { TopTrackItem, TopAlbumItem } from './top.js';
import type { HistoryItem } from './history.js';
import type { PlaylistPresenceItem } from './records.js';
import type { TrackVersion } from './versions.js';

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

export interface ArtistDetail {
  artist: { id: string; name: string; imageUrl: string | null; genres: string[] };
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  releases: ReleaseEvent[];
  topTracks: TopTrackItem[];
  topAlbums: TopAlbumItem[];
  recentPlays: HistoryItem[];
  mergedFrom: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
  mergedInto: { id: string; ruleId: number; name: string; imageUrl: string | null } | null;
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
  // otras versiones del mismo tema (live, remix, remaster...) que el usuario ha escuchado
  versions: TrackVersion[];
}
