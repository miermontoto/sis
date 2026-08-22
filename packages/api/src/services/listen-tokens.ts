// tokens de scrobbling del endpoint compatible listenbrainz: uno por usuario,
// regenerable desde ajustes. el token es el único secreto que ven los clientes
// push (pano scrobbler, web scrobbler, navidrome…), nunca la sesión web.
import { randomBytes } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { listenTokens } from '../db/schema.js';
import { LISTEN_TOKEN_BYTES } from '../constants.js';

export interface ListenTokenInfo {
  token: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function getListenToken(userId: number): ListenTokenInfo | null {
  const db = getDb();
  const row = db.select().from(listenTokens).where(eq(listenTokens.userId, userId)).get();
  return row ? { token: row.token, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt } : null;
}

// genera (o reemplaza) el token del usuario: regenerar invalida el anterior
export function regenerateListenToken(userId: number): ListenTokenInfo {
  const db = getDb();
  const token = randomBytes(LISTEN_TOKEN_BYTES).toString('base64url');
  const now = new Date().toISOString();
  db.insert(listenTokens)
    .values({ userId, token, createdAt: now, lastUsedAt: null })
    .onConflictDoUpdate({
      target: listenTokens.userId,
      set: { token, createdAt: now, lastUsedAt: null },
    })
    .run();
  return { token, createdAt: now, lastUsedAt: null };
}

export function revokeListenToken(userId: number): void {
  const db = getDb();
  db.delete(listenTokens).where(eq(listenTokens.userId, userId)).run();
}

export interface ResolvedListenToken {
  userId: number;
  userName: string;
}

// resuelve un token entrante a su usuario (solo cuentas activas). `touch`
// actualiza last_used_at (los submits lo marcan; validate-token no cuenta como uso)
export function resolveListenToken(token: string, touch = false): ResolvedListenToken | null {
  if (!token) return null;
  const db = getDb();
  const row = db.get(sql`
    SELECT lt.user_id AS userId, COALESCE(u.display_name, u.spotify_id) AS userName
    FROM listen_tokens lt
    JOIN users u ON u.id = lt.user_id AND u.is_active = 1
    WHERE lt.token = ${token}
  `) as ResolvedListenToken | undefined;
  if (!row) return null;
  if (touch) {
    db.update(listenTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(listenTokens.token, token))
      .run();
  }
  return row;
}
