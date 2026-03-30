import type { TrackInfo } from './entities.js';

export interface NowPlayingResponse {
  playing: boolean;
  isPlaying: boolean;
  track?: TrackInfo;
  updatedAt?: string;
}
