// Créditos corregidos por el usuario: la lista de artistas de un tema o un álbum tal
// como la quiere ver él (ver shared/credits.ts). PUT sustituye la lista entera —el orden
// importa: la primera es el principal— y DELETE vuelve a la del catálogo.
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppVariables } from '../app.js';
import { getDb } from '../db/connection.js';
import { entityTableName } from '../db/queries/helpers.js';
import { getEntityCredits, setEntityCredits, clearEntityCredits } from '../db/queries/credits.js';
import { invalidateRecordsCacheForUser } from '../services/records-cache.js';
import { invalidateReportCacheForUser } from '../services/report-cache.js';
import { invalidateProjectionBase } from '../services/projection-cache.js';
import { isCreditSubjectType, isCollectionKey, CREDITS_MAX_ARTISTS } from '@sis/shared';
import type { CreditSubjectType } from '@sis/shared';

const credits = new Hono<{ Variables: AppVariables }>();

const idList = (ids: string[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

// cambiar a quién cuenta un tema mueve rankings, records y reports, y la marca de agua
// de esas caches (MAX(played_at)) no se entera: se tiran, como con las colecciones
function invalidateDerived(userId: number): void {
  invalidateRecordsCacheForUser(userId);
  invalidateReportCacheForUser(userId);
  invalidateProjectionBase(userId);
}

// un álbum lógico no tiene créditos que corregir: su único artista es el dueño de la
// colección, y ése se cambia desde la colección
function subjectExists(type: CreditSubjectType, id: string): boolean {
  if (type === 'album' && isCollectionKey(id)) return false;
  const table = sql.raw(entityTableName(type));
  return getDb().all(sql`SELECT 1 AS ok FROM ${table} WHERE spotify_id = ${id}`).length > 0;
}

credits.get('/:type/:id', (c) => {
  const type = c.req.param('type');
  const id = c.req.param('id');
  if (!isCreditSubjectType(type)) return c.json({ error: 'invalid type' }, 400);
  if (!subjectExists(type, id)) return c.json({ error: `${type} not found` }, 404);
  return c.json(getEntityCredits(getDb(), type, id, c.get('userId')));
});

credits.put('/:type/:id', async (c) => {
  const type = c.req.param('type');
  const id = c.req.param('id');
  const userId = c.get('userId');
  if (!isCreditSubjectType(type)) return c.json({ error: 'invalid type' }, 400);

  const body = await c.req.json<{ artistIds?: unknown }>().catch(() => null);
  const raw = body?.artistIds;
  if (!Array.isArray(raw) || !raw.every(v => typeof v === 'string' && v.length > 0)) {
    return c.json({ error: 'artistIds must be a list of artist ids' }, 400);
  }
  // un artista dos veces en la misma lista no significa nada: gana su primera posición
  const artistIds = [...new Set(raw as string[])];
  // una lista vacía dejaría el tema sin nadie a quien contarle las escuchas: para
  // volver a los créditos del catálogo está el DELETE
  if (artistIds.length === 0) return c.json({ error: 'a credit list needs at least one artist' }, 400);
  if (artistIds.length > CREDITS_MAX_ARTISTS) return c.json({ error: `at most ${CREDITS_MAX_ARTISTS} artists` }, 400);

  if (!subjectExists(type, id)) return c.json({ error: `${type} not found` }, 404);

  // sólo artistas que ya existen: corregir un crédito es evidencia sobre el catálogo,
  // no una forma de acuñar entidades (igual que la atribución de un setlist)
  const db = getDb();
  const known = db.all(sql`SELECT spotify_id FROM artists WHERE spotify_id IN (${idList(artistIds)})`) as { spotify_id: string }[];
  if (known.length !== artistIds.length) return c.json({ error: 'unknown artist' }, 404);

  setEntityCredits(db, type, id, userId, artistIds);
  invalidateDerived(userId);
  return c.json(getEntityCredits(db, type, id, userId));
});

credits.delete('/:type/:id', (c) => {
  const type = c.req.param('type');
  const id = c.req.param('id');
  const userId = c.get('userId');
  if (!isCreditSubjectType(type)) return c.json({ error: 'invalid type' }, 400);
  if (!subjectExists(type, id)) return c.json({ error: `${type} not found` }, 404);

  const db = getDb();
  clearEntityCredits(db, type, id, userId);
  invalidateDerived(userId);
  return c.json(getEntityCredits(db, type, id, userId));
});

export default credits;
