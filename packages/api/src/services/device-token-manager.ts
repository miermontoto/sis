import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { deviceTokens } from '../db/schema.js';

// gestión de tokens de dispositivo para push (FCM android/ios, PushSubscription web).
// para web el token = JSON.stringify(PushSubscription). la FK apunta a users.id (INTEGER).

/** Registra un token, reactivándolo si ya existe (upsert por el UNIQUE de token). */
export function registerToken(userId: number, token: string, platform: string, userAgent?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(deviceTokens)
    .values({ userId, token, platform, userAgent: userAgent ?? null, isActive: true, createdAt: now, lastActiveAt: now })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      // reactivar el token existente y refrescar propietario/plataforma/actividad
      set: { userId, platform, userAgent: userAgent ?? null, isActive: true, lastActiveAt: now },
    })
    .run();
}

/** Tokens activos de un usuario, listos para dispatch (id + token + plataforma). */
export function listActiveTokens(userId: number): { id: number; token: string; platform: string }[] {
  const db = getDb();
  return db.select({ id: deviceTokens.id, token: deviceTokens.token, platform: deviceTokens.platform })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.isActive, true)))
    .all();
}

/** Desactiva un token (soft-delete). se usa al borrarlo o al detectar que es inválido. */
export function invalidateToken(token: string): void {
  const db = getDb();
  db.update(deviceTokens).set({ isActive: false }).where(eq(deviceTokens.token, token)).run();
}

/** Ids de usuarios con al menos un token activo (para iterar en el pipeline de eventos). */
export function listUserIdsWithActiveTokens(): number[] {
  const db = getDb();
  return db.selectDistinct({ userId: deviceTokens.userId })
    .from(deviceTokens)
    .where(eq(deviceTokens.isActive, true))
    .all()
    .map((r) => r.userId);
}
