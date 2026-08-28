// Valoraciones de álbum: estrellas enteras (0-5, sin medias) + texto opcional.
// Una valoración por (usuario, grupo de merge): las escrituras limpian el resto
// del grupo para que nunca convivan dos opiniones sobre el mismo álbum lógico.
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppVariables } from '../app.js';
import { getDb } from '../db/connection.js';
import { getEntityMergeGroup } from '../db/queries/merge.js';
import { ALBUM_RATING_MIN, ALBUM_RATING_MAX, ALBUM_REVIEW_MAX_CHARS } from '@sis/shared';

const ratings = new Hono<{ Variables: AppVariables }>();

const idList = (ids: string[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

// crear o actualizar la valoración del álbum (PUT = reemplazo completo: el
// cliente manda siempre rating y review juntos)
ratings.put('/album/:id', async (c) => {
  const albumId = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json<{ rating?: unknown; review?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);

  const { rating } = body;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < ALBUM_RATING_MIN || rating > ALBUM_RATING_MAX) {
    return c.json({ error: `rating must be an integer between ${ALBUM_RATING_MIN} and ${ALBUM_RATING_MAX}` }, 400);
  }
  if (body.review !== undefined && body.review !== null && typeof body.review !== 'string') {
    return c.json({ error: 'review must be a string' }, 400);
  }
  const review = typeof body.review === 'string' ? body.review.trim().slice(0, ALBUM_REVIEW_MAX_CHARS) || null : null;

  const db = getDb();
  const album = db.all(sql`SELECT spotify_id FROM albums WHERE spotify_id = ${albumId}`)[0];
  if (!album) return c.json({ error: 'album not found' }, 404);

  // la valoración pertenece al grupo de merge, no al id suelto: sin esta limpieza
  // una fila vieja en otro miembro del grupo resucitaría al borrar la nueva
  const rest = getEntityMergeGroup(db, 'album', albumId, userId).filter(gid => gid !== albumId);
  if (rest.length > 0) {
    db.run(sql`DELETE FROM album_ratings WHERE user_id = ${userId} AND album_id IN (${idList(rest)})`);
  }
  db.run(sql`
    INSERT INTO album_ratings (user_id, album_id, rating, review)
    VALUES (${userId}, ${albumId}, ${rating}, ${review})
    ON CONFLICT(user_id, album_id) DO UPDATE SET
      rating = excluded.rating,
      review = excluded.review,
      updated_at = datetime('now')
  `);

  const row = db.all(sql`
    SELECT rating, review, updated_at FROM album_ratings
    WHERE user_id = ${userId} AND album_id = ${albumId}
  `)[0] as { rating: number; review: string | null; updated_at: string };
  return c.json({ rating: row.rating, review: row.review, updatedAt: row.updated_at });
});

// eliminar la valoración (álbum sin valorar). Borra sobre el grupo entero: si la
// fila vive en un id mergeado, borrar solo el visitado la dejaría reapareciendo
ratings.delete('/album/:id', (c) => {
  const albumId = c.req.param('id');
  const userId = c.get('userId');
  const db = getDb();

  const group = getEntityMergeGroup(db, 'album', albumId, userId);
  db.run(sql`DELETE FROM album_ratings WHERE user_id = ${userId} AND album_id IN (${idList(group)})`);
  return c.json({ success: true });
});

export default ratings;
