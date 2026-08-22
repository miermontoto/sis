// cliente oidc de id.mier.info (sso propio de la plataforma) + cuentas
// vinculadas. authorization code + pkce con cliente confidencial; la identidad
// se lee del userinfo endpoint, lo que evita verificar la firma es256 del
// id_token: los tokens llegan directos del issuer por tls.
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { mieridAccounts } from '../db/schema.js';
import { MIERID_AUTH_URL, MIERID_TOKEN_URL, MIERID_USERINFO_URL, MIERID_SCOPES } from '../constants.js';
import { createLogger } from './logger.js';

const log = createLogger('mierid');

export function isMieridConfigured(): boolean {
  return !!(process.env.MIERID_CLIENT_ID && process.env.MIERID_CLIENT_SECRET);
}

export interface MieridIdentity {
  sub: string;
  username: string | null;
  name: string | null;
  picture: string | null;
}

// pkce: verifier aleatorio + challenge s256, ambos en base64url
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(redirectUri: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.MIERID_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: MIERID_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${MIERID_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<string> {
  const clientId = process.env.MIERID_CLIENT_ID!;
  const clientSecret = process.env.MIERID_CLIENT_SECRET!;
  const res = await fetch(MIERID_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    log.error(`error al intercambiar code: ${res.status} ${await res.text()}`);
    throw new Error('mierid token exchange failed');
  }
  const data: { access_token: string } = await res.json();
  return data.access_token;
}

export async function fetchIdentity(accessToken: string): Promise<MieridIdentity> {
  const res = await fetch(MIERID_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    log.error(`error en userinfo: ${res.status} ${await res.text()}`);
    throw new Error('mierid userinfo failed');
  }
  const claims: { sub: string; preferred_username?: string; name?: string; picture?: string } = await res.json();
  return {
    sub: claims.sub,
    username: claims.preferred_username ?? null,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}

// --- cuentas vinculadas ---

export function getMieridAccount(userId: number) {
  const db = getDb();
  return db.select().from(mieridAccounts).where(eq(mieridAccounts.userId, userId)).get() ?? null;
}

export function findMieridAccountBySub(sub: string) {
  const db = getDb();
  return db.select().from(mieridAccounts).where(eq(mieridAccounts.sub, sub)).get() ?? null;
}

export function upsertMieridAccount(userId: number, sub: string, username: string | null): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(mieridAccounts)
    .values({ userId, sub, username, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: mieridAccounts.userId, set: { sub, username, updatedAt: now } })
    .run();
}

export function deleteMieridAccount(userId: number): void {
  const db = getDb();
  db.delete(mieridAccounts).where(eq(mieridAccounts.userId, userId)).run();
}
