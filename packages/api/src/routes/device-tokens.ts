import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { deviceTokens } from '../db/schema.js';
import { registerToken, invalidateToken } from '../services/device-token-manager.js';
import type { AppVariables } from '../app.js';
import type { DeviceTokenRecord, DevicePlatform } from '@sis/shared';

const deviceTokensRoute = new Hono<{ Variables: AppVariables }>();

// plataformas válidas al registrar un token
const VALID_PLATFORMS: readonly DevicePlatform[] = ['android', 'ios', 'web'] as const;

// lista los tokens activos del usuario (sin exponer el token en sí)
deviceTokensRoute.get('/', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const rows = db.select({ id: deviceTokens.id, platform: deviceTokens.platform, createdAt: deviceTokens.createdAt })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.isActive, true)))
    .all();
  return c.json(rows as DeviceTokenRecord[]);
});

// registra (o reactiva) un token para el usuario actual
deviceTokensRoute.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ token?: string; platform?: string; userAgent?: string }>();

  const token = body.token?.trim();
  if (!token) return c.json({ error: 'token is required' }, 400);
  if (!body.platform || !VALID_PLATFORMS.includes(body.platform as DevicePlatform)) {
    return c.json({ error: 'invalid platform' }, 400);
  }

  registerToken(userId, token, body.platform, body.userAgent);
  return c.json({ ok: true });
});

// soft-delete de un token, verificando que pertenece al usuario actual
deviceTokensRoute.delete('/:id', (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'));
  if (Number.isNaN(id)) return c.json({ error: 'invalid id' }, 400);

  const db = getDb();
  const row = db.select().from(deviceTokens).where(eq(deviceTokens.id, id)).get();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.userId !== userId) return c.json({ error: 'forbidden' }, 403);

  invalidateToken(row.token);
  return c.json({ ok: true });
});

export default deviceTokensRoute;
