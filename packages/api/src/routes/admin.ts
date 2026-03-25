import { Hono } from 'hono';
import { sql, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { mergeRules, albums, artists, tracks, trackArtists } from '../db/schema.js';

const admin = new Hono();

// crear regla de merge
admin.post('/merge', async (c) => {
  const body = await c.req.json<{ entityType: string; sourceId: string; targetId: string }>();
  const { entityType, sourceId, targetId } = body;

  if (!entityType || !sourceId || !targetId) {
    return c.json({ error: 'entityType, sourceId and targetId are required' }, 400);
  }
  if (entityType !== 'album') {
    return c.json({ error: 'only album merges are supported' }, 400);
  }
  if (sourceId === targetId) {
    return c.json({ error: 'cannot merge entity with itself' }, 400);
  }

  const db = getDb();

  // verificar que ambos existen
  const source = db.select().from(albums).where(eq(albums.spotifyId, sourceId)).get();
  const target = db.select().from(albums).where(eq(albums.spotifyId, targetId)).get();
  if (!source) return c.json({ error: 'source album not found' }, 404);
  if (!target) return c.json({ error: 'target album not found' }, 404);

  // verificar que no exista ya
  const existing = db.all(sql`
    SELECT id FROM merge_rules
    WHERE entity_type = 'album'
      AND ((source_id = ${sourceId} AND target_id = ${targetId})
        OR (source_id = ${targetId} AND target_id = ${sourceId}))
  `);
  if (existing.length > 0) {
    return c.json({ error: 'merge rule already exists' }, 409);
  }

  // evitar cadenas: si el source ya es target de otra regla, o el target es source de otra
  const sourceIsTarget = db.all(sql`
    SELECT id FROM merge_rules WHERE entity_type = 'album' AND target_id = ${sourceId}
  `);
  if (sourceIsTarget.length > 0) {
    return c.json({ error: 'source album is already a merge target — merge its sources into the new target instead' }, 400);
  }

  const targetIsSource = db.all(sql`
    SELECT id FROM merge_rules WHERE entity_type = 'album' AND source_id = ${targetId}
  `);
  if (targetIsSource.length > 0) {
    return c.json({ error: 'target album is already merged into another album' }, 400);
  }

  const result = db.insert(mergeRules).values({
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

// eliminar regla de merge
admin.delete('/merge/:id', (c) => {
  const id = parseInt(c.req.param('id'));
  const db = getDb();

  const rule = db.select().from(mergeRules).where(eq(mergeRules.id, id)).get();
  if (!rule) return c.json({ error: 'merge rule not found' }, 404);

  db.delete(mergeRules).where(eq(mergeRules.id, id)).run();
  return c.json({ success: true });
});

// listar reglas de merge con nombres
admin.get('/merges', (c) => {
  const db = getDb();

  const rows = db.all(sql`
    SELECT mr.id, mr.entity_type, mr.source_id, mr.target_id, mr.created_at,
           sa.name as source_name, sa.image_url as source_image,
           ta.name as target_name, ta.image_url as target_image,
           ar.spotify_id as artist_id, ar.name as artist_name, ar.image_url as artist_image
    FROM merge_rules mr
    LEFT JOIN albums sa ON sa.spotify_id = mr.source_id AND mr.entity_type = 'album'
    LEFT JOIN albums ta ON ta.spotify_id = mr.target_id AND mr.entity_type = 'album'
    LEFT JOIN (
      SELECT DISTINCT t.album_id, ta2.artist_id
      FROM tracks t
      JOIN track_artists ta2 ON ta2.track_id = t.spotify_id AND ta2.position = 0
    ) album_artist ON album_artist.album_id = mr.target_id
    LEFT JOIN artists ar ON ar.spotify_id = album_artist.artist_id
    ORDER BY ar.name, ta.name, sa.name
  `) as any[];

  return c.json(rows);
});

// sugerencias de merge: álbumes duplicados para un artista
admin.get('/merge-suggestions/:artistId', (c) => {
  const artistId = c.req.param('artistId');
  const db = getDb();

  // buscar álbumes del artista (position=0) con plays
  const artistAlbums = db.all(sql`
    SELECT al.spotify_id as id, al.name, al.image_url,
           COALESCE(s.play_count, 0) as plays
    FROM albums al
    JOIN tracks t ON t.album_id = al.spotify_id
    JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
    LEFT JOIN (
      SELECT tr.album_id, COUNT(*) as play_count
      FROM listening_history lh
      JOIN tracks tr ON tr.spotify_id = lh.track_id
      WHERE tr.album_id IS NOT NULL
      GROUP BY tr.album_id
    ) s ON s.album_id = al.spotify_id
    WHERE ta.artist_id = ${artistId}
      AND al.spotify_id NOT IN (SELECT source_id FROM merge_rules WHERE entity_type = 'album')
    GROUP BY al.spotify_id
    ORDER BY al.name
  `) as { id: string; name: string; image_url: string | null; plays: number }[];

  return c.json(artistAlbums);
});

export default admin;
