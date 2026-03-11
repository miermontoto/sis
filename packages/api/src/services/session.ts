import crypto from 'crypto';

interface Session {
  spotifyId: string;
  createdAt: number;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 días

const sessions = new Map<string, Session>();

export function createSession(spotifyId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { spotifyId, createdAt: Date.now() });
  return token;
}

export function validateSession(token: string): string | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session.spotifyId;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}
