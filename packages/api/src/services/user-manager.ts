import { eq, isNull, sql, getTableName } from 'drizzle-orm';
import { COLLECTION_ID_PREFIX } from '@sis/shared';
import { getDb } from '../db/connection.js';
import { users, listeningHistory, authTokens, pollingState, mergeRules } from '../db/schema.js';
import { invalidateRecordsCacheForUser } from './records-cache.js';
import { invalidateReportCacheForUser } from './report-cache.js';
import { invalidateProjectionBase } from './projection-cache.js';
import { createLogger } from './logger.js';

const log = createLogger('users');

// columna con la que una tabla apunta a su dueño. las que no llevan FK a users
// (sent_notifications, notification_period_state) sólo se reconocen por este nombre
// y su tipo: la de user_settings es TEXT y guarda el spotify id, no el numérico
const USER_ID_COLUMN = 'user_id';
const USER_ID_TYPE = 'INTEGER';
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

  log.info(`usuario creado: ${displayName} (${spotifyId})${isFirstUser ? ' [ADMIN]' : ''}`);
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

/** Elimina un usuario y TODO lo que cuelga de él, en una transacción: o se va entero
 *  o no se toca nada. Las tablas no se enumeran a mano: la lista vieja cubría 10 de 25
 *  y, con foreign_keys = ON, el DELETE de `users` moría con el historial ya borrado.
 *  Se descubren en el esquema (toda columna `user_id` entera o con FK a users, lo que
 *  incluye las dos de `follows` y la `sessions` legacy), así que una tabla nueva entra
 *  sola. A mano queda lo que es del usuario sin nombrarlo por su id: los ajustes (por
 *  spotify id), las filas de álbum de sus colecciones y las hijas de sus playlists y
 *  bolos, que van antes que sus padres. */
export function hardDeleteUser(id: number): void {
  const db = getDb();
  const usersTable = getTableName(users);
  const owned = db.all(sql`
    SELECT m.name AS tbl, p.name AS col
    FROM sqlite_master m JOIN pragma_table_info(m.name) p
    WHERE m.type = 'table' AND m.name != ${usersTable}
      AND ((p.name = ${USER_ID_COLUMN} AND p.type = ${USER_ID_TYPE}) OR EXISTS (
        SELECT 1 FROM pragma_foreign_key_list(m.name) f WHERE f."from" = p.name AND f."table" = ${usersTable}))
  `) as { tbl: string; col: string }[];
  const collectionAlbums = sql`SELECT ${COLLECTION_ID_PREFIX} || id FROM album_collections WHERE user_id = ${id}`;

  const deleted = db.transaction(() => [
    sql`DELETE FROM user_settings WHERE user_id = (SELECT spotify_id FROM ${users} WHERE ${users.id} = ${id})`,
    sql`DELETE FROM album_ratings WHERE album_id IN (${collectionAlbums})`,
    sql`DELETE FROM album_covers WHERE album_id IN (${collectionAlbums})`,
    sql`DELETE FROM albums WHERE spotify_id IN (${collectionAlbums})`,
    sql`DELETE FROM generated_playlist_tracks WHERE playlist_id IN (SELECT id FROM generated_playlists WHERE user_id = ${id})`,
    sql`DELETE FROM spotify_playlist_tracks WHERE playlist_id IN (SELECT id FROM spotify_playlists WHERE user_id = ${id})`,
    sql`DELETE FROM concert_songs WHERE concert_id IN (SELECT id FROM concerts WHERE user_id = ${id})`,
    ...owned.map(({ tbl, col }) => sql`DELETE FROM ${sql.identifier(tbl)} WHERE ${sql.identifier(col)} = ${id}`),
    sql`DELETE FROM ${users} WHERE ${users.id} = ${id}`,
  ].reduce((n, stmt) => n + db.run(stmt).changes, 0));

  // lo horneado en memoria también son sus datos: no esperamos al siguiente deploy
  invalidateRecordsCacheForUser(id);
  invalidateReportCacheForUser(id);
  invalidateProjectionBase(id);
  log.info(`usuario ${id} eliminado (${deleted} filas)`);
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
    log.info(`migrados ${lhCount} plays, ${atCount} tokens, ${psCount} polling states, ${mrCount} merge rules → usuario ${userId}`);
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
