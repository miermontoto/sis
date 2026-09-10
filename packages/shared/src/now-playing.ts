import type { TrackInfo } from './entities.js';

export interface NowPlayingResponse {
  playing: boolean;
  isPlaying: boolean;
  // false para usuarios solo-last.fm: sin token de spotify no hay controles de
  // reproducción (la tarjeta se muestra read-only). ausente/true = controlable
  controllable?: boolean;
  // progreso del track en el momento de updatedAt; el cliente extrapola
  progressMs?: number | null;
  volumePercent?: number | null;
  track?: TrackInfo;
  updatedAt?: string;
  // marca de agua del historial: el played_at más reciente del usuario en
  // listening_history. avanza SOLO cuando el servidor ya ha volcado un play
  // (el volcado va en escalera de 8/25/75s tras el corte, ver
  // scheduleHistoryFlush), así que el cliente la usa para saber cuándo sus
  // agregados son releíbles. null = el usuario no tiene historial todavía
  historyWatermark?: string | null;
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
