import type { TrackInfo } from './entities.js';

export interface TopTrackItem {
  trackId: string;
  playCount: number;
  totalMs: number;
  rankChange: number | null;
  previousRank: number | null;
  isNew: boolean;
  track: TrackInfo | null;
}

export interface TopArtistItem {
  artistId: string;
  playCount: number;
  totalMs: number;
  rankChange: number | null;
  previousRank: number | null;
  isNew: boolean;
  artist: { name: string; imageUrl: string | null; genres: string[] } | null;
}

export interface TopAlbumItem {
  albumId: string;
  playCount: number;
  totalMs: number;
  rankChange: number | null;
  previousRank: number | null;
  isNew: boolean;
  album: { name: string; imageUrl: string | null; releaseDate: string | null } | null;
}
