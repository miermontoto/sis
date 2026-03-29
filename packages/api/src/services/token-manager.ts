import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { authTokens } from '../db/schema.js';
import { SPOTIFY_TOKEN_URL, TOKEN_REFRESH_BUFFER_MS } from '../constants.js';
import type { SpotifyTokenResponse } from '../types/spotify.js';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export function getStoredTokens(userId?: number): TokenData | null {
  const db = getDb();
  const row = userId != null
    ? db.select().from(authTokens).where(eq(authTokens.userId, userId)).get()
    : db.select().from(authTokens).get(); // fallback para health check sin user
  if (!row) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
  };
}

export function storeTokens(userId: number, data: { accessToken: string; refreshToken: string; expiresIn: number; scope?: string }) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + data.expiresIn * 1000).toISOString();
  const now = new Date().toISOString();

  db.insert(authTokens)
    .values({
      userId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt,
      scope: data.scope,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: authTokens.userId,
      set: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt,
        scope: data.scope,
        updatedAt: now,
      },
    })
    .run();

  console.log(`[token] almacenado para usuario ${userId}, expira en ${data.expiresIn}s`);
}

export function isTokenExpiringSoon(userId: number): boolean {
  const tokens = getStoredTokens(userId);
  if (!tokens) return true;
  return Date.now() >= new Date(tokens.expiresAt).getTime() - TOKEN_REFRESH_BUFFER_MS;
}

export async function refreshAccessToken(userId: number): Promise<string> {
  const tokens = getStoredTokens(userId);
  if (!tokens) throw new Error(`no hay tokens almacenados para usuario ${userId}, se requiere login`);

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`error al refrescar token para usuario ${userId}: ${res.status} ${text}`);
  }

  const data: SpotifyTokenResponse = await res.json();

  storeTokens(userId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresIn: data.expires_in,
    scope: data.scope,
  });

  return data.access_token;
}

export function getStoredScopes(userId: number): string[] {
  const db = getDb();
  const row = db.select().from(authTokens).where(eq(authTokens.userId, userId)).get();
  if (!row?.scope) return [];
  return row.scope.split(' ');
}

export function hasRequiredScopes(userId: number, required: string[]): boolean {
  const granted = new Set(getStoredScopes(userId));
  return required.every(s => granted.has(s));
}

export async function getValidAccessToken(userId: number): Promise<string> {
  if (isTokenExpiringSoon(userId)) {
    return refreshAccessToken(userId);
  }
  const tokens = getStoredTokens(userId);
  if (!tokens) throw new Error(`no hay tokens almacenados para usuario ${userId}`);
  return tokens.accessToken;
}
