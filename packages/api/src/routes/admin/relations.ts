// Relaciones "soft" entre artistas: el vínculo se declara pero el tracking no cambia
// (Julian Casablancas ←→ The Strokes). La relación "hard" —un artista absorbido dentro
// de otro, como "Ye" en "Kanye West"— sigue siendo un merge y vive en merges.ts.
import { sql, eq } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { artistRelations, artists } from '../../db/schema.js';
import { getEntityMergeGroup } from '../../db/queries/merge.js';
import { adminRouter } from './_shared.js';

const relations = adminRouter();

// par normalizado: el UNIQUE de la tabla deduplica las dos direcciones sobre este orden
const orderedPair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

const idList = (ids: string[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

// listar todas las relaciones del usuario, con metadata de ambos lados para la UI de
// settings. No hay dirección que respetar, así que se ordena por el nombre del lado A.
relations.get('/artist-relations', (c) => {
  const userId = c.get('userId');
  const db = getDb();

  return c.json(db.all(sql`
    SELECT ar.id, ar.created_at,
           a.spotify_id as a_id, a.name as a_name, a.image_url as a_image,
           b.spotify_id as b_id, b.name as b_name, b.image_url as b_image
    FROM artist_relations ar
    JOIN artists a ON a.spotify_id = ar.artist_a
    JOIN artists b ON b.spotify_id = ar.artist_b
    WHERE ar.user_id = ${userId}
    ORDER BY a.name COLLATE NOCASE, b.name COLLATE NOCASE
  `));
});

// crear relación entre dos artistas
relations.post('/artist-relation', async (c) => {
  const userId = c.get('userId');
  const { artistId, relatedId } = await c.req.json<{ artistId: string; relatedId: string }>();

  if (!artistId || !relatedId) return c.json({ error: 'artistId and relatedId are required' }, 400);
  if (artistId === relatedId) return c.json({ error: 'cannot relate an artist to itself' }, 400);

  const db = getDb();
  const source = db.select().from(artists).where(eq(artists.spotifyId, artistId)).get();
  const related = db.select().from(artists).where(eq(artists.spotifyId, relatedId)).get();
  if (!source) return c.json({ error: 'artist not found' }, 404);
  if (!related) return c.json({ error: 'related artist not found' }, 404);

  // los merges ya son la relación "hard": dentro de un mismo grupo no hay nada que declarar
  const group = getEntityMergeGroup(db, 'artist', artistId, userId);
  if (group.includes(relatedId)) {
    return c.json({ error: 'both artists are already merged together — that is a hard relation' }, 400);
  }

  // la relación es entre grupos, no entre ids sueltos: si ya existe una entre cualquier
  // miembro de uno y del otro, crear otra pintaría el mismo enlace dos veces
  const relatedGroup = getEntityMergeGroup(db, 'artist', relatedId, userId);
  const existing = db.get(sql`
    SELECT id FROM artist_relations
    WHERE user_id = ${userId}
      AND ((artist_a IN (${idList(group)}) AND artist_b IN (${idList(relatedGroup)}))
        OR (artist_a IN (${idList(relatedGroup)}) AND artist_b IN (${idList(group)})))
  `) as { id: number } | undefined;
  if (existing) return c.json({ error: 'these artists are already related' }, 409);

  const [artistA, artistB] = orderedPair(artistId, relatedId);
  const result = db.insert(artistRelations).values({ userId, artistA, artistB }).run();

  return c.json({ id: Number(result.lastInsertRowid), artistId, relatedId });
});

// eliminar relación (verificar que pertenece al usuario)
relations.delete('/artist-relation/:id', (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  const db = getDb();

  const rule = db.select().from(artistRelations).where(eq(artistRelations.id, id)).get();
  if (!rule) return c.json({ error: 'artist relation not found' }, 404);
  if (rule.userId !== userId) return c.json({ error: 'forbidden' }, 403);

  db.delete(artistRelations).where(eq(artistRelations.id, id)).run();
  return c.json({ success: true });
});

export default relations;
