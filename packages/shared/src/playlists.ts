import type { TrackInfo } from './entities.js';

export type PlaylistStrategy = 'top_range' | 'top_artist' | 'top_genre' | 'deep_cuts' | 'time_vibes' | 'rediscovery' | 'record' | 'top' | 'chart';

export interface GeneratedPlaylist {
  id: number;
  spotifyPlaylistId: string | null;
  libraryPlaylistId?: number | null;
  spotifyUrl?: string;
  name: string;
  strategy: PlaylistStrategy;
  params: Record<string, unknown>;
  trackCount: number;
  // auto-regeneración programada (opcional; presente en list/detail)
  autoRegenerate?: boolean;
  regenerateIntervalMs?: number | null;
  lastRegeneratedAt?: string | null;
  tracks?: { position: number; track: TrackInfo | null }[];
  createdAt: string;
  updatedAt: string;
}

// cadencias de auto-regeneración ofrecidas al usuario
export type RegenerateInterval = 'daily' | 'weekly' | 'monthly';

export interface PlaylistListResponse {
  items: GeneratedPlaylist[];
  total: number;
}

export interface PlaylistPreviewResponse {
  tracks: { position: number; track: TrackInfo | null }[];
}

export interface LibraryPlaylist {
  id: number;
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  ownerName: string | null;
  isOwned: boolean;
  isAlgorithmic: boolean;
  trackCount: number;
  lastSyncedAt: string | null;
}

export interface LibraryPlaylistListResponse {
  items: LibraryPlaylist[];
  total: number;
}

export interface LibraryPlaylistTrack {
  trackId: string;
  position: number;
  addedAt: string | null;
  playCount: number;
  totalMs: number;
  lastPlayed: string | null;
  track: TrackInfo | null;
}

export interface LibraryPlaylistDetail {
  playlist: {
    id: number;
    spotifyId: string;
    name: string;
    imageUrl: string | null;
    ownerName: string | null;
    isOwned: boolean;
    isAlgorithmic: boolean;
    trackCount: number;
    lastSyncedAt: string | null;
  };
  tracks: LibraryPlaylistTrack[];
  genres: { genre: string; play_count: number }[];
  series: { period: string; play_count: number; total_ms: number }[];
  coverage: { tracksPlayed: number; totalTracks: number; percent: number };
  stats: { totalPlays: number; totalMs: number };
}
