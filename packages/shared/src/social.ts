import type { TopTrackItem, TopArtistItem, TopAlbumItem } from './top.js';
import type { TimeRange } from './constants.js';

// resumen agregado de la librería de un usuario (para perfil / share)
export interface ProfileSummary {
  spotifyId: string;
  displayName: string | null;
  imageUrl: string | null;
  totalPlays: number;
  totalMs: number;
  distinctArtists: number;
  distinctTracks: number;
  distinctAlbums: number;
  firstPlayedAt: string | null;
  // conciertos asistidos (all-time, como el resto de la tarjeta de identidad)
  concertsAttended: number;
  artistsSeenLive: number;
}

// now-playing reducido para superficies sociales (mismo shape que FriendActivity.track)
export interface SocialNowPlaying {
  name: string;
  artists: string;
  albumImageUrl: string | null;
}

export interface ProfileResponse {
  summary: ProfileSummary;
  range: TimeRange;
  topArtists: TopArtistItem[];
  topTracks: TopTrackItem[];
  topAlbums: TopAlbumItem[];
  nowPlaying: SocialNowPlaying | null;
  isFollowing?: boolean; // sólo presente en contexto autenticado
  rangeLocked?: boolean; // share links con rango congelado
}

// ítem compartido entre dos usuarios con su rank en cada lista
export interface SharedRankedItem {
  id: string;
  name: string;
  imageUrl: string | null;
  myRank: number;
  theirRank: number;
}

// racha de escucha (días consecutivos)
export interface StreaksSummary {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
}

export interface CompareResponse {
  me: ProfileSummary;
  them: ProfileSummary;
  range: TimeRange;
  overlapPercent: number; // 0..100, solapamiento ponderado por rank (combinado)
  overlapByType: { artists: number; tracks: number; albums: number };
  sharedArtists: SharedRankedItem[];
  sharedTracks: SharedRankedItem[];
  sharedAlbums: SharedRankedItem[];
  myTopArtists: TopArtistItem[];
  theirTopArtists: TopArtistItem[];
  myTopTracks: TopTrackItem[];
  theirTopTracks: TopTrackItem[];
  myTopAlbums: TopAlbumItem[];
  theirTopAlbums: TopAlbumItem[];
  myStreaks: StreaksSummary;
  theirStreaks: StreaksSummary;
}

// usuario del directorio de la instancia, con un vistazo de su actividad
export interface DirectoryUser {
  spotifyId: string;
  displayName: string | null;
  imageUrl: string | null;
  isFollowing: boolean;
  followsYou: boolean;
  totalPlays: number; // all-time
  nowPlaying: SocialNowPlaying | null;
  topArtist: { id: string; name: string; imageUrl: string | null } | null; // último mes
}

export type DirectoryResponse = DirectoryUser[];

export interface FollowUser {
  spotifyId: string;
  displayName: string | null;
  imageUrl: string | null;
  followedAt: string;
}

export interface FollowListResponse {
  following: FollowUser[];
  followers: FollowUser[];
}

// actividad reciente de un usuario seguido (feed)
export interface FeedItem {
  user: { spotifyId: string; displayName: string | null; imageUrl: string | null };
  recentPlays: number; // plays en los últimos FEED_RECENT_DAYS días
  recentMs: number;
  topArtist: { id: string; name: string; imageUrl: string | null } | null;
  topTrack: { id: string; name: string; albumImageUrl: string | null } | null;
  nowPlaying: SocialNowPlaying | null;
}

// un play individual en el stream cronológico del feed
export interface FeedPlayItem {
  user: { spotifyId: string; displayName: string | null; imageUrl: string | null };
  track: { id: string; name: string; artists: string; albumImageUrl: string | null };
  playedAt: string;
}

export interface FeedResponse {
  users: FeedItem[];
  recentPlays: FeedPlayItem[];
}

export interface ShareLink {
  token: string;
  kind: 'profile';
  range: TimeRange | null;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  url: string; // URL pública completa (/s/{token})
}

export type ShareLinkListResponse = ShareLink[];

export interface CreateShareLinkRequest {
  range?: TimeRange | null;
  label?: string | null;
}
