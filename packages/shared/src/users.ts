export interface MeResponse {
  authenticated: boolean;
  userId?: number;
  spotifyId?: string;
  isAdmin?: boolean;
  scopes?: string[];
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
  database: string;
  authenticated: boolean;
  totalPlays: number;
  timestamp: string;
}
