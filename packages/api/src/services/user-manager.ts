import { eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { users, listeningHistory, authTokens, pollingState, mergeRules } from '../db/schema.js';

export interface User {
  id: number;
  spotifyId: string;
  displayName: string | null;
  imageUrl: string | null;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function findUserBySpotifyId(spotifyId: string): User | null {
  const db = getDb();
  const row = db.select().from(users).where(eq(users.spotifyId, spotifyId)).get();
  return row ? mapUser(row) : null;
}

export function getUserById(id: number): User | null {
  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, id)).get();
  return row ? mapUser(row) : null;
}

/** Crea o recupera un usuario. El primero en registrarse es admin. */
export function findOrCreateUser(spotifyId: string, displayName: string | null, imageUrl: string | null): User {
  const existing = findUserBySpotifyId(spotifyId);
  if (existing) {
    // actualizar datos de perfil si cambiaron
    const db = getDb();
    db.update(users)
      .set({ displayName, imageUrl, updatedAt: new Date().toISOString() })
      .where(eq(users.id, existing.id))
      .run();
    return { ...existing, displayName, imageUrl };
  }

  const db = getDb();
  const count = db.select().from(users).all().length;
  const isFirstUser = count === 0;
  const now = new Date().toISOString();

  const result = db.insert(users).values({
    spotifyId,
    displayName,
    imageUrl,
    isAdmin: isFirstUser,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }).returning().get();

  console.log(`[users] usuario creado: ${displayName} (${spotifyId})${isFirstUser ? ' [ADMIN]' : ''}`);
  return mapUser(result);
}

/** Todos los usuarios activos con tokens (para polling). */
export function getAllActiveUsersWithTokens(): { userId: number; spotifyId: string }[] {
  const db = getDb();
  const rows = db.select({
    userId: users.id,
    spotifyId: users.spotifyId,
  })
    .from(users)
    .innerJoin(authTokens, eq(users.id, authTokens.userId))
    .where(eq(users.isActive, true))
    .all();
  return rows;
}

export function getAllUsers(): User[] {
  const db = getDb();
  return db.select().from(users).all().map(mapUser);
}

export function updateUser(id: number, fields: { isAdmin?: boolean; isActive?: boolean; displayName?: string; imageUrl?: string }): User | null {
  const db = getDb();
  db.update(users)
    .set({ ...fields, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id))
    .run();
  return getUserById(id);
}

/** Asigna todos los datos huérfanos (user_id NULL) al usuario indicado. */
export function migrateExistingData(userId: number): void {
  const db = getDb();

  const lhCount = db.update(listeningHistory)
    .set({ userId })
    .where(isNull(listeningHistory.userId))
    .run().changes;

  // auth_tokens y polling_state tienen UNIQUE en user_id —
  // si ya hay una fila para este usuario (creada por storeTokens), eliminar las huérfanas
  const existingToken = db.select().from(authTokens).where(eq(authTokens.userId, userId)).get();
  let atCount = 0;
  if (existingToken) {
    atCount = db.delete(authTokens).where(isNull(authTokens.userId)).run().changes;
  } else {
    atCount = db.update(authTokens).set({ userId }).where(isNull(authTokens.userId)).run().changes;
  }

  const existingPoll = db.select().from(pollingState).where(eq(pollingState.userId, userId)).get();
  let psCount = 0;
  if (existingPoll) {
    psCount = db.delete(pollingState).where(isNull(pollingState.userId)).run().changes;
  } else {
    psCount = db.update(pollingState).set({ userId }).where(isNull(pollingState.userId)).run().changes;
  }

  const mrCount = db.update(mergeRules)
    .set({ userId })
    .where(isNull(mergeRules.userId))
    .run().changes;

  const total = lhCount + atCount + psCount + mrCount;
  if (total > 0) {
    console.log(`[users] migrados ${lhCount} plays, ${atCount} tokens, ${psCount} polling states, ${mrCount} merge rules → usuario ${userId}`);
  }
}

/** Verifica si un spotifyId puede autenticarse (existe y está activo, o no hay usuarios aún). */
export function isAllowedUser(spotifyId: string): boolean {
  const db = getDb();
  const count = db.select().from(users).all().length;
  // si no hay usuarios, permitir el primero (bootstrap)
  if (count === 0) return true;
  const user = findUserBySpotifyId(spotifyId);
  return user !== null && user.isActive;
}

export function hasAnyUsers(): boolean {
  const db = getDb();
  return db.select().from(users).all().length > 0;
}

function mapUser(row: any): User {
  return {
    id: row.id,
    spotifyId: row.spotifyId,
    displayName: row.displayName,
    imageUrl: row.imageUrl,
    isAdmin: !!row.isAdmin,
    isActive: row.isActive !== false && row.isActive !== 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
