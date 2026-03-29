import crypto from 'crypto';

export interface Session {
  spotifyId: string;
  userId: number;
  isAdmin: boolean;
  createdAt: number;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 días

const sessions = new Map<string, Session>();

export function createSession(spotifyId: string, userId: number, isAdmin: boolean): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { spotifyId, userId, isAdmin, createdAt: Date.now() });
  return token;
}

export function validateSession(token: string): Session | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}
