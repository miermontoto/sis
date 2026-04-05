import type { TopTrackItem, TopAlbumItem } from './top.js';
import type { HistoryItem } from './history.js';

export interface Rankings {
  week: number | null;
  month: number | null;
  thisYear: number | null;
  all: number | null;
}

export interface ArtistDetail {
  artist: { id: string; name: string; imageUrl: string | null; genres: string[] };
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  topTracks: TopTrackItem[];
  topAlbums: TopAlbumItem[];
  recentPlays: HistoryItem[];
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
  mergedFrom: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
  mergedInto: { id: string; ruleId: number; name: string; imageUrl: string | null } | null;
  covers?: AlbumCover[];
}

export interface TrackDetail {
  track: {
    id: string; name: string; durationMs: number; trackNumber: number | null; explicit: boolean;
    album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null } | null;
    artists: { id: string; name: string; imageUrl: string | null }[];
  };
  stats: { play_count: number; total_ms: number; first_played: string | null; last_played: string | null };
  series: { period: string; play_count: number; total_ms: number }[];
  dailySeries: { day: string; play_count: number; total_ms: number }[];
  albumBreakdown: { albumId: string; playCount: number; totalMs: number; album: { id: string; name: string; imageUrl: string | null; releaseDate: string | null } }[];
  recentPlays: HistoryItem[];
}
