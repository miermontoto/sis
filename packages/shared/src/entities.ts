export interface TrackInfo {
  id: string;
  name: string;
  durationMs: number;
  album: { id: string; name: string; imageUrl: string | null } | null;
  artists: { id: string; name: string }[];
}

export interface FormattedArtist {
  name: string;
  imageUrl: string | null;
  genres: string[];
}

export interface FormattedAlbum {
  name: string;
  imageUrl: string | null;
  releaseDate: string | null;
}
