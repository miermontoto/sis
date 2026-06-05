// sesiones de sis sobre el servicio compartido de @platform/auth. el user de la
// sesión (spotifyId/isAdmin) se resuelve desde la tabla users — fuente de verdad —
// en vez de denormalizarse en la fila de sesión como hacía la tabla `sessions` legacy.
import { createSessionService } from '@platform/auth';
import { getDb } from '../db/connection.js';
import { authSessions } from '../db/schema.js';
import { getUserById } from './user-manager.js';

export interface Session {
  spotifyId: string;
  userId: number;
  isAdmin: boolean;
  createdAt: number;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 días

interface SessionUser {
  spotifyId: string;
  isAdmin: boolean;
}

const service = createSessionService<SessionUser>({
  getDb,
  table: authSessions,
  ttlMs: SESSION_TTL_MS,
  resolveUser: (userId) => {
    const user = getUserById(userId);
    return user ? { spotifyId: user.spotifyId, isAdmin: user.isAdmin } : null;
  },
});

export function createSession(userId: number, userAgent?: string): string {
  return service.createSession(userId, userAgent).token;
}

export function validateSession(token: string): Session | null {
  const s = service.validateSession(token);
  return s
    ? { spotifyId: s.user.spotifyId, userId: s.userId, isAdmin: s.user.isAdmin, createdAt: s.createdAt }
    : null;
}

export const deleteSession = service.deleteSession;
export const cleanupExpiredSessions = service.cleanupExpiredSessions;
