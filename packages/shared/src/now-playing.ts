import type { TrackInfo } from './entities.js';

export interface NowPlayingResponse {
  playing: boolean;
  isPlaying: boolean;
  volumePercent?: number | null;
  track?: TrackInfo;
  updatedAt?: string;
}

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

export interface DevicesResponse {
  devices: SpotifyDevice[];
}

export interface PlayContextRequest {
  context_uri?: string;
  uris?: string[];
  device_id?: string;
}

export interface PlayContextResponse {
  success: boolean;
  error?: string;
}

export interface FriendActivity {
  spotifyId: string;
  displayName: string | null;
  imageUrl: string | null;
  isPlaying: boolean;
  track: { name: string; artists: string; albumImageUrl: string | null } | null;
  updatedAt: string | null;
}

export type FriendsActivityResponse = FriendActivity[];
