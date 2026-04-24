import { Hono } from 'hono';
import { sql, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { mergeRules, albums, artists, tracks, users } from '../db/schema.js';
import { getAllUsers, updateUser, getUserById, hardDeleteUser } from '../services/user-manager.js';
import type { AppVariables } from '../app.js';
import type { EntityType } from '@sis/shared';

const admin = new Hono<{ Variables: AppVariables }>();

const VALID_ENTITY_TYPES: EntityType[] = ['album', 'artist', 'track'];
const isValidEntityType = (s: unknown): s is EntityType =>
  typeof s === 'string' && VALID_ENTITY_TYPES.includes(s as EntityType);

// helper: resolver la tabla drizzle para lookups por spotifyId según tipo
function entityTable(type: EntityType) {
  if (type === 'album') return albums;
  if (type === 'artist') return artists;
  return tracks;
}

// --- merge rules (per-user) ---

// crear regla de merge
admin.post('/merge', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ entityType: string; sourceId: string; targetId: string }>();
  const { entityType, sourceId, targetId } = body;

  if (!entityType || !sourceId || !targetId) {
    return c.json({ error: 'entityType, sourceId and targetId are required' }, 400);
  }
  if (!isValidEntityType(entityType)) {
    return c.json({ error: `unsupported entityType — must be one of ${VALID_ENTITY_TYPES.join(', ')}` }, 400);
  }
  if (sourceId === targetId) {
    return c.json({ error: 'cannot merge entity with itself' }, 400);
  }

  const db = getDb();
  const table = entityTable(entityType);
  const col = table.spotifyId;

  // verificar que ambos existen en la tabla correspondiente
  const source = db.select().from(table).where(eq(col, sourceId)).get() as { name: string } | undefined;
  const target = db.select().from(table).where(eq(col, targetId)).get() as { name: string } | undefined;
  if (!source) return c.json({ error: `source ${entityType} not found` }, 404);
  if (!target) return c.json({ error: `target ${entityType} not found` }, 404);

  // verificar que no exista ya (para este usuario, tipo específico)
  const existing = db.all(sql`
    SELECT id FROM merge_rules
    WHERE entity_type = ${entityType} AND user_id = ${userId}
      AND ((source_id = ${sourceId} AND target_id = ${targetId})
        OR (source_id = ${targetId} AND target_id = ${sourceId}))
  `);
  if (existing.length > 0) {
    return c.json({ error: 'merge rule already exists' }, 409);
  }

  // evitar cadenas (para este usuario, tipo específico)
  const sourceIsTarget = db.all(sql`
    SELECT id FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId} AND target_id = ${sourceId}
  `);
  if (sourceIsTarget.length > 0) {
    return c.json({ error: `source ${entityType} is already a merge target — merge its sources into the new target instead` }, 400);
  }

  const targetIsSource = db.all(sql`
    SELECT id FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId} AND source_id = ${targetId}
  `);
  if (targetIsSource.length > 0) {
    return c.json({ error: `target ${entityType} is already merged into another ${entityType}` }, 400);
  }

  const result = db.insert(mergeRules).values({
    userId,
    entityType,
    sourceId,
    targetId,
  }).run();

  return c.json({
    id: result.lastInsertRowid,
    entityType,
    sourceId,
    sourceName: source.name,
    targetId,
    targetName: target.name,
  });
});

// eliminar regla de merge (verificar que pertenece al usuario)
admin.delete('/merge/:id', (c) => {
  const id = parseInt(c.req.param('id'));
  const userId = c.get('userId');
  const db = getDb();

  const rule = db.select().from(mergeRules).where(eq(mergeRules.id, id)).get();
  if (!rule) return c.json({ error: 'merge rule not found' }, 404);
  if (rule.userId !== userId) return c.json({ error: 'forbidden' }, 403);

  db.delete(mergeRules).where(eq(mergeRules.id, id)).run();
  return c.json({ success: true });
});

// listar todas las reglas de merge del usuario, con metadata para UI en settings.
// El campo `artist_*` representa la agrupación padre:
//   - album: el artist principal del álbum target
//   - track: el artist principal del track target
//   - artist: null (se agrupa por target en el cliente)
admin.get('/merges', (c) => {
  const userId = c.get('userId');
  const db = getDb();

  const albumRows = db.all(sql`
    SELECT mr.id, mr.entity_type, mr.source_id, mr.target_id, mr.created_at,
           sa.name as source_name, sa.image_url as source_image,
           ta.name as target_name, ta.image_url as target_image,
           ar.spotify_id as artist_id, ar.name as artist_name, ar.image_url as artist_image
    FROM merge_rules mr
    JOIN albums sa ON sa.spotify_id = mr.source_id
    JOIN albums ta ON ta.spotify_id = mr.target_id
    LEFT JOIN (
      SELECT DISTINCT t.album_id, ta2.artist_id
      FROM tracks t
      JOIN track_artists ta2 ON ta2.track_id = t.spotify_id AND ta2.position = 0
    ) album_artist ON album_artist.album_id = mr.target_id
    LEFT JOIN artists ar ON ar.spotify_id = album_artist.artist_id
    WHERE mr.user_id = ${userId} AND mr.entity_type = 'album'
    ORDER BY ar.name, ta.name, sa.name
  `) as any[];

  const artistRows = db.all(sql`
    SELECT mr.id, mr.entity_type, mr.source_id, mr.target_id, mr.created_at,
           sa.name as source_name, sa.image_url as source_image,
           ta.name as target_name, ta.image_url as target_image,
           NULL as artist_id, NULL as artist_name, NULL as artist_image
    FROM merge_rules mr
    JOIN artists sa ON sa.spotify_id = mr.source_id
    JOIN artists ta ON ta.spotify_id = mr.target_id
    WHERE mr.user_id = ${userId} AND mr.entity_type = 'artist'
    ORDER BY ta.name, sa.name
  `) as any[];

  const trackRows = db.all(sql`
    SELECT mr.id, mr.entity_type, mr.source_id, mr.target_id, mr.created_at,
           st.name as source_name, sal.image_url as source_image,
           tt.name as target_name, tal.image_url as target_image,
           ar.spotify_id as artist_id, ar.name as artist_name, ar.image_url as artist_image
    FROM merge_rules mr
    JOIN tracks st ON st.spotify_id = mr.source_id
    LEFT JOIN albums sal ON sal.spotify_id = st.album_id
    JOIN tracks tt ON tt.spotify_id = mr.target_id
    LEFT JOIN albums tal ON tal.spotify_id = tt.album_id
    LEFT JOIN (
      SELECT track_id, MIN(artist_id) as artist_id
      FROM track_artists WHERE position = 0 GROUP BY track_id
    ) ta_pri ON ta_pri.track_id = mr.target_id
    LEFT JOIN artists ar ON ar.spotify_id = ta_pri.artist_id
    WHERE mr.user_id = ${userId} AND mr.entity_type = 'track'
    ORDER BY ar.name, tt.name, st.name
  `) as any[];

  return c.json([...albumRows, ...artistRows, ...trackRows]);
});

// sugerencias de merge unificadas.
// Query params:
//   entityType (required): 'album' | 'artist' | 'track'
//   parent (optional): artist spotifyId — para albums/tracks, restringe a entidades con ese artista principal
//   exclude (optional): id a excluir (típicamente el target para no auto-sugerir)
// Devuelve [{id, name, image_url, plays}] ordenado por plays DESC.
admin.get('/merge-suggestions', (c) => {
  const userId = c.get('userId');
  const entityType = c.req.query('entityType');
  const parent = c.req.query('parent');
  const exclude = c.req.query('exclude');

  if (!isValidEntityType(entityType)) {
    return c.json({ error: `entityType query param required — must be one of ${VALID_ENTITY_TYPES.join(', ')}` }, 400);
  }

  const db = getDb();
  const excludeClause = exclude ? sql`AND e.spotify_id != ${exclude}` : sql``;
  const sourceFilter = sql`e.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId})`;
  const importFilter = sql`e.spotify_id NOT LIKE 'import:%'`;

  let rows: { id: string; name: string; image_url: string | null; plays: number }[] = [];

  if (entityType === 'album') {
    if (!parent) return c.json({ error: 'parent (artistId) is required for album suggestions' }, 400);
    rows = db.all(sql`
      SELECT e.spotify_id as id, e.name, e.image_url,
             COALESCE(s.play_count, 0) as plays
      FROM albums e
      JOIN tracks t ON t.album_id = e.spotify_id
      JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
      LEFT JOIN (
        SELECT tr.album_id, COUNT(*) as play_count
        FROM listening_history lh
        JOIN tracks tr ON tr.spotify_id = lh.track_id
        WHERE tr.album_id IS NOT NULL AND lh.user_id = ${userId}
        GROUP BY tr.album_id
      ) s ON s.album_id = e.spotify_id
      WHERE ta.artist_id = ${parent}
        AND ${sourceFilter}
        AND ${importFilter}
        ${excludeClause}
      GROUP BY e.spotify_id
      ORDER BY plays DESC, e.name
    `) as typeof rows;
  } else if (entityType === 'artist') {
    rows = db.all(sql`
      SELECT e.spotify_id as id, e.name, e.image_url,
             COALESCE(s.play_count, 0) as plays
      FROM artists e
      JOIN (
        SELECT ta.artist_id, COUNT(*) as play_count
        FROM listening_history lh
        JOIN track_artists ta ON ta.track_id = lh.track_id
        WHERE lh.user_id = ${userId}
        GROUP BY ta.artist_id
      ) s ON s.artist_id = e.spotify_id
      WHERE ${sourceFilter}
        AND ${importFilter}
        ${excludeClause}
      ORDER BY plays DESC
    `) as typeof rows;
  } else {
    // track
    if (!parent) return c.json({ error: 'parent (artistId) is required for track suggestions' }, 400);
    rows = db.all(sql`
      SELECT e.spotify_id as id, e.name, al.image_url as image_url,
             COALESCE(s.play_count, 0) as plays
      FROM tracks e
      JOIN track_artists ta ON ta.track_id = e.spotify_id AND ta.position = 0
      LEFT JOIN albums al ON al.spotify_id = e.album_id
      LEFT JOIN (
        SELECT track_id, COUNT(*) as play_count
        FROM listening_history WHERE user_id = ${userId} GROUP BY track_id
      ) s ON s.track_id = e.spotify_id
      WHERE ta.artist_id = ${parent}
        AND ${sourceFilter}
        AND ${importFilter}
        ${excludeClause}
      GROUP BY e.spotify_id
      ORDER BY plays DESC, e.name
    `) as typeof rows;
  }

  return c.json(rows);
});

// --- user management (admin only) ---

admin.get('/users', (c) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);
  return c.json(getAllUsers());
});

admin.post('/users', async (c) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ spotifyId: string }>();
  if (!body.spotifyId?.trim()) {
    return c.json({ error: 'spotifyId is required' }, 400);
  }

  const db = getDb();
  const existing = db.select().from(users).where(eq(users.spotifyId, body.spotifyId.trim())).get();
  if (existing) {
    return c.json({ error: 'user already exists' }, 409);
  }

  const now = new Date().toISOString();
  const result = db.insert(users).values({
    spotifyId: body.spotifyId.trim(),
    isAdmin: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }).returning().get();

  return c.json(result, 201);
});

admin.put('/users/:id', async (c) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);

  const id = parseInt(c.req.param('id'));
  const body = await c.req.json<{ isAdmin?: boolean; isActive?: boolean }>();

  const user = getUserById(id);
  if (!user) return c.json({ error: 'user not found' }, 404);

  // prevenir quitar admin al último admin
  if (body.isAdmin === false && user.isAdmin) {
    const allUsers = getAllUsers();
    const adminCount = allUsers.filter(u => u.isAdmin && u.isActive).length;
    if (adminCount <= 1) {
      return c.json({ error: 'cannot remove last admin' }, 400);
    }
  }

  const updated = updateUser(id, body);
  return c.json(updated);
});

admin.delete('/users/:id', (c) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);

  const id = parseInt(c.req.param('id'));
  const currentUserId = c.get('userId');

  if (id === currentUserId) {
    return c.json({ error: 'cannot delete yourself' }, 400);
  }

  const user = getUserById(id);
  if (!user) return c.json({ error: 'user not found' }, 404);

  if (user.isActive) {
    // active users get soft-deleted first
    updateUser(id, { isActive: false });
  } else {
    // inactive users get hard-deleted
    hardDeleteUser(id);
  }
  return c.json({ success: true });
});

export default admin;
