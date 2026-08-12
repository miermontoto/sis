import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { shareLinks } from '../db/schema.js';
import { getUserById } from '../services/user-manager.js';
import { buildProfile, parseTimeRange } from '../services/social.js';
import { generateOgImage } from '../services/og-image.js';
import type { TimeRange } from '../constants.js';
import type { User } from '../services/user-manager.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('og');
const publicRoutes = new Hono();

// resultado de resolver un token: distingue inexistente (404) de revocado (410)
type TokenResolution =
  | { status: 'ok'; user: User; range: TimeRange | null }
  | { status: 'not_found' }
  | { status: 'revoked' };

function resolveShareToken(token: string): TokenResolution {
  const db = getDb();
  const link = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get();
  if (!link) return { status: 'not_found' };
  if (link.revokedAt) return { status: 'revoked' };

  const user = getUserById(link.userId);
  if (!user || !user.isActive) return { status: 'not_found' };

  // registrar último acceso (best-effort, no bloquear la respuesta)
  db.update(shareLinks)
    .set({ lastAccessedAt: new Date().toISOString() })
    .where(eq(shareLinks.token, token))
    .run();

  return { status: 'ok', user, range: (link.range as TimeRange | null) ?? null };
}

export { resolveShareToken };

// snapshot público de perfil vía share token.
// NOTA: los share links se saltan socialVisibility a propósito — son una
// acción explícita y revocable del dueño del perfil.
publicRoutes.get('/share/:token', async (c) => {
  const resolution = resolveShareToken(c.req.param('token'));
  if (resolution.status === 'not_found') return c.json({ error: 'enlace no encontrado' }, 404);
  if (resolution.status === 'revoked') return c.json({ error: 'enlace revocado' }, 410);

  // si el enlace tiene rango congelado, ignorar el query param
  const rangeLocked = resolution.range !== null;
  const range = rangeLocked ? resolution.range! : parseTimeRange(c.req.query('range'));

  const profile = await buildProfile(resolution.user, range);
  return c.json({ ...profile, rangeLocked }, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

// tarjeta OG del share link (1200×630 PNG)
publicRoutes.get('/share/:token/og.png', async (c) => {
  const resolution = resolveShareToken(c.req.param('token'));
  if (resolution.status !== 'ok') return c.notFound();

  try {
    const png = await generateOgImage(c.req.param('token'), resolution.user, resolution.range ?? 'month');
    return c.body(new Uint8Array(png), 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=600',
    });
  } catch (err) {
    log.error('error generando imagen:', err);
    return c.notFound();
  }
});

export default publicRoutes;
