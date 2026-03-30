// tipos de respuesta de la API de spotify

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyArtistSimple {
  id: string;
  name: string;
  external_urls: { spotify: string };
}

export interface SpotifyArtistFull extends SpotifyArtistSimple {
  genres: string[];
  images: SpotifyImage[];
  popularity: number;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: SpotifyImage[];
  artists: SpotifyArtistSimple[];
  release_date: string;
  total_tracks: number;
  album_type: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  album: SpotifyAlbum;
  artists: SpotifyArtistSimple[];
  duration_ms: number;
  track_number: number;
  explicit: boolean;
  popularity: number;
  is_local?: boolean;
}

export interface SpotifyPlayHistoryItem {
  track: SpotifyTrack;
  played_at: string;
  context: {
    type: string;
    uri: string;
  } | null;
}

export interface SpotifyRecentlyPlayedResponse {
  items: SpotifyPlayHistoryItem[];
  next: string | null;
  cursors: {
    after: string;
    before: string;
  } | null;
}

export interface SpotifyCurrentlyPlayingResponse {
  is_playing: boolean;
  item: SpotifyTrack | null;
  progress_ms: number | null;
  currently_playing_type: string;
  timestamp: number;
}

export interface SpotifyArtistsBatchResponse {
  artists: SpotifyArtistFull[];
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

export interface SpotifyPlaylistsResponse {
  items: {
    id: string;
    name: string;
    description: string | null;
    images: SpotifyImage[];
    owner: { id: string; display_name: string };
    snapshot_id: string;
    tracks: { total: number };
    collaborative: boolean;
    public: boolean;
  }[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}

export interface SpotifyPlaylistTracksResponse {
  items: {
    added_at: string;
    track: SpotifyTrack | null;
    is_local: boolean;
  }[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}
