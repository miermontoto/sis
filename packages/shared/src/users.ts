export interface MeResponse {
  authenticated: boolean;
  userId?: number;
  spotifyId?: string;
  displayName?: string | null;
  imageUrl?: string | null;
  isAdmin?: boolean;
  scopes?: string[];
  lastfmUsername?: string | null;
}

export interface LastfmBackfillProgress {
  running: boolean;
  phase: 'fetching' | 'importing' | 'done' | 'error';
  page: number;
  totalPages: number;
  imported: number;
  error?: string;
}

export interface LastfmStatus {
  configured: boolean;
  account: {
    username: string;
    lastScrobbleUts: number | null;
    backfillDone: boolean;
    backfill: LastfmBackfillProgress | null;
  } | null;
}

export interface MieridStatus {
  configured: boolean;
  account: {
    sub: string;
    username: string | null;
  } | null;
}

// token del endpoint de scrobbling compatible listenbrainz (null = sin generar)
export interface ListenTokenStatus {
  token: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export interface UserRecord {
  id: number;
  spotifyId: string;
  displayName: string | null;
  imageUrl: string | null;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
}

export interface HealthData {
  status: string;
  version: string;
  database: string;
  authenticated: boolean;
  totalPlays: number;
  timestamp: string;
}
