import crypto from 'crypto';
import { eq, lt } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { sessions } from '../db/schema.js';

export interface Session {
  spotifyId: string;
  userId: number;
  isAdmin: boolean;
  createdAt: number;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 días

export function createSession(spotifyId: string, userId: number, isAdmin: boolean): string {
  const token = crypto.randomBytes(32).toString('hex');
  const db = getDb();
  db.insert(sessions)
    .values({ token, spotifyId, userId, isAdmin, createdAt: new Date().toISOString() })
    .run();
  return token;
}

export function validateSession(token: string): Session | null {
  const db = getDb();
  const row = db.select().from(sessions).where(eq(sessions.token, token)).get();
  if (!row) return null;

  const createdAt = new Date(row.createdAt).getTime();
  if (Date.now() - createdAt > SESSION_TTL_MS) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
    return null;
  }

  return {
    spotifyId: row.spotifyId,
    userId: row.userId,
    isAdmin: row.isAdmin,
    createdAt,
  };
}

export function deleteSession(token: string): void {
  const db = getDb();
  db.delete(sessions).where(eq(sessions.token, token)).run();
}

export function cleanupExpiredSessions(): void {
  const db = getDb();
  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  const result = db.delete(sessions).where(lt(sessions.createdAt, cutoff)).run();
  if (result.changes > 0) {
    console.log(`[session] limpiadas ${result.changes} sesiones expiradas`);
  }
}
