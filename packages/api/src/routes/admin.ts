import { Hono } from 'hono';
import { sql, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { mergeRules, albums, artists, tracks, users } from '../db/schema.js';
import { getEntityMergeGroup } from '../db/queries/merge.js';
import { getAllUsers, updateUser, getUserById, hardDeleteUser } from '../services/user-manager.js';
import { spotifyFetch } from '../services/spotify-client.js';
import type { AppVariables } from '../app.js';
import type { EntityType } from '@sis/shared';

const admin = new Hono<{ Variables: AppVariables }>();

const VALID_ENTITY_TYPES: EntityType[] = ['album', 'artist', 'track'];

// --- track matching helpers (shared between album-merge-preview and album-remerge-preview) ---

interface MatchableTrack {
  id: string;
  name: string;
  trackNumber: number | null;
  discNumber: number | null;
  durationMs: number;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const trigrams = (s: string) => {
  const t = new Set<string>();
  const n = norm(s);
  for (let i = 0; i <= n.length - 3; i++) t.add(n.slice(i, i + 3));
  return t;
};
const trigramSimilarity = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return common / Math.max(a.size, b.size);
};

function autoMatchTracks(
  sourceTracks: MatchableTrack[],
  targetTracks: MatchableTrack[],
): { sourceTrackId: string; targetTrackId: string; confidence: 'position' | 'name' }[] {
  const matches: { sourceTrackId: string; targetTrackId: string; confidence: 'position' | 'name' }[] = [];
  const usedSource = new Set<string>();
  const usedTarget = new Set<string>();

  // pass 1: match by track_number within same disc
  for (const st of sourceTracks) {
    if (st.trackNumber == null) continue;
    const disc = st.discNumber ?? 1;
    const match = targetTracks.find(tt =>
      !usedTarget.has(tt.id) && tt.trackNumber === st.trackNumber && (tt.discNumber ?? 1) === disc
    );
    if (match) {
      matches.push({ sourceTrackId: st.id, targetTrackId: match.id, confidence: 'position' });
      usedSource.add(st.id);
      usedTarget.add(match.id);
    }
  }

  // pass 2: name similarity for unmatched
  const candidates: { sourceId: string; targetId: string; sim: number }[] = [];
  for (const st of sourceTracks) {
    if (usedSource.has(st.id)) continue;
    const stTri = trigrams(st.name);
    for (const tt of targetTracks) {
      if (usedTarget.has(tt.id)) continue;
      const sim = trigramSimilarity(stTri, trigrams(tt.name));
      if (sim >= 0.4) candidates.push({ sourceId: st.id, targetId: tt.id, sim });
    }
  }
  candidates.sort((a, b) => b.sim - a.sim);
  for (const c of candidates) {
    if (usedSource.has(c.sourceId) || usedTarget.has(c.targetId)) continue;
    matches.push({ sourceTrackId: c.sourceId, targetTrackId: c.targetId, confidence: 'name' });
    usedSource.add(c.sourceId);
    usedTarget.add(c.targetId);
  }

  return matches;
}
const isValidEntityType = (s: unknown): s is EntityType =>
  typeof s === 'string' && VALID_ENTITY_TYPES.includes(s as EntityType);

// helper: resolver la tabla drizzle para lookups por spotifyId según tipo
function entityTable(type: EntityType) {
  if (type === 'album') return albums;
  if (type === 'artist') return artists;
  return tracks;
}

type MergeValidationResult =
  | { ok: true }
  | { ok: false; reason: 'exists' | 'source_is_target' | 'target_is_source' };

function validateMergeRule(
  db: ReturnType<typeof getDb>,
  userId: number,
  entityType: string,
  sourceId: string,
  targetId: string,
): MergeValidationResult {
  const row = db.get(sql`
    SELECT
      EXISTS(SELECT 1 FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId}
        AND ((source_id = ${sourceId} AND target_id = ${targetId})
          OR (source_id = ${targetId} AND target_id = ${sourceId}))) as dup,
      EXISTS(SELECT 1 FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId}
        AND target_id = ${sourceId}) as src_is_tgt,
      EXISTS(SELECT 1 FROM merge_rules WHERE entity_type = ${entityType} AND user_id = ${userId}
        AND source_id = ${targetId}) as tgt_is_src
  `) as { dup: number; src_is_tgt: number; tgt_is_src: number };
  if (row.dup) return { ok: false, reason: 'exists' };
  if (row.src_is_tgt) return { ok: false, reason: 'source_is_target' };
  if (row.tgt_is_src) return { ok: false, reason: 'target_is_source' };
  return { ok: true };
}

const MERGE_ERRORS: Record<string, (type: string) => [string, number]> = {
  exists: () => ['merge rule already exists', 409],
  source_is_target: (t) => [`source ${t} is already a merge target — merge its sources into the new target instead`, 400],
  target_is_source: (t) => [`target ${t} is already merged into another ${t}`, 400],
};

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

  const v = validateMergeRule(db, userId, entityType, sourceId, targetId);
  if (!v.ok) {
    const [msg, status] = MERGE_ERRORS[v.reason](entityType);
    return c.json({ error: msg }, status as 400);
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

// preview de merge de álbum: devuelve tracks de ambos álbumes con auto-match
admin.get('/album-merge-preview', (c) => {
  const userId = c.get('userId');
  const sourceId = c.req.query('source');
  const targetId = c.req.query('target');
  if (!sourceId || !targetId) return c.json({ error: 'source and target are required' }, 400);

  const db = getDb();
  const sourceAlbum = db.select().from(albums).where(eq(albums.spotifyId, sourceId)).get();
  const targetAlbum = db.select().from(albums).where(eq(albums.spotifyId, targetId)).get();
  if (!sourceAlbum) return c.json({ error: 'source album not found' }, 404);
  if (!targetAlbum) return c.json({ error: 'target album not found' }, 404);

  const mergedTrackIds = new Set(
    (db.all(sql`SELECT source_id FROM merge_rules WHERE entity_type = 'track' AND user_id = ${userId}`) as { source_id: string }[])
      .map(r => r.source_id)
  );

  const getTracksForAlbum = (albumId: string) =>
    (db.all(sql`
      SELECT t.spotify_id as id, t.name, t.track_number, t.disc_number, t.duration_ms
      FROM tracks t
      WHERE t.album_id = ${albumId}
      ORDER BY COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, t.name ASC
    `) as { id: string; name: string; track_number: number | null; disc_number: number | null; duration_ms: number }[])
      .filter(t => !mergedTrackIds.has(t.id))
      .map(t => ({ id: t.id, name: t.name, trackNumber: t.track_number, discNumber: t.disc_number, durationMs: t.duration_ms }));

  const sourceTracks = getTracksForAlbum(sourceId);
  const targetTracks = getTracksForAlbum(targetId);
  const matches = autoMatchTracks(sourceTracks, targetTracks);

  return c.json({
    source: { id: sourceId, name: sourceAlbum.name, imageUrl: sourceAlbum.imageUrl, tracks: sourceTracks },
    target: { id: targetId, name: targetAlbum.name, imageUrl: targetAlbum.imageUrl, tracks: targetTracks },
    matches,
  });
});

// merge de álbum batch: crea merge de álbum + merges de tracks en una transacción
admin.post('/merge-album', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    sourceAlbumId: string;
    targetAlbumId: string;
    trackPairs: Array<{ sourceTrackId: string; targetTrackId: string }>;
  }>();
  const { sourceAlbumId, targetAlbumId, trackPairs } = body;

  if (!sourceAlbumId || !targetAlbumId) return c.json({ error: 'sourceAlbumId and targetAlbumId are required' }, 400);
  if (sourceAlbumId === targetAlbumId) return c.json({ error: 'cannot merge album with itself' }, 400);

  const db = getDb();

  const sourceAlbum = db.select().from(albums).where(eq(albums.spotifyId, sourceAlbumId)).get();
  const targetAlbum = db.select().from(albums).where(eq(albums.spotifyId, targetAlbumId)).get();
  if (!sourceAlbum) return c.json({ error: 'source album not found' }, 404);
  if (!targetAlbum) return c.json({ error: 'target album not found' }, 404);

  const albumV = validateMergeRule(db, userId, 'album', sourceAlbumId, targetAlbumId);
  if (!albumV.ok) {
    const [msg, status] = MERGE_ERRORS[albumV.reason]('album');
    return c.json({ error: msg }, status as 400);
  }

  // ejecutar todo en transacción
  const result = db.transaction(() => {
    const albumResult = db.insert(mergeRules).values({
      userId, entityType: 'album', sourceId: sourceAlbumId, targetId: targetAlbumId,
    }).run();

    const trackRules: Array<{ id: number; sourceTrackId: string; targetTrackId: string }> = [];
    const skipped: string[] = [];

    for (const pair of (trackPairs ?? [])) {
      if (!pair.sourceTrackId || !pair.targetTrackId || pair.sourceTrackId === pair.targetTrackId) {
        skipped.push(`${pair.sourceTrackId}: invalid pair`);
        continue;
      }

      // verificar que los tracks existen
      const src = db.select().from(tracks).where(eq(tracks.spotifyId, pair.sourceTrackId)).get();
      const tgt = db.select().from(tracks).where(eq(tracks.spotifyId, pair.targetTrackId)).get();
      if (!src || !tgt) { skipped.push(`${pair.sourceTrackId}: track not found`); continue; }

      const tv = validateMergeRule(db, userId, 'track', pair.sourceTrackId, pair.targetTrackId);
      if (!tv.ok) {
        const reasons = { exists: 'already merged', source_is_target: 'is already a merge target', target_is_source: 'target already merged elsewhere' };
        skipped.push(`${pair.sourceTrackId}: ${reasons[tv.reason]}`);
        continue;
      }

      const r = db.insert(mergeRules).values({
        userId, entityType: 'track', sourceId: pair.sourceTrackId, targetId: pair.targetTrackId,
      }).run();
      trackRules.push({ id: Number(r.lastInsertRowid), sourceTrackId: pair.sourceTrackId, targetTrackId: pair.targetTrackId });
    }

    return {
      albumRule: { id: Number(albumResult.lastInsertRowid), sourceId: sourceAlbumId, targetId: targetAlbumId },
      trackRules,
      skipped,
    };
  });

  return c.json(result);
});

// preview de re-merge: detecta tracks sin mergear en álbumes ya mergeados hacia un target
admin.get('/album-remerge-preview', (c) => {
  const userId = c.get('userId');
  const albumId = c.req.query('album');
  if (!albumId) return c.json({ error: 'album query param is required' }, 400);

  const db = getDb();

  const sourceAlbumRows = db.all(sql`
    SELECT mr.source_id, a.name, a.image_url
    FROM merge_rules mr
    JOIN albums a ON a.spotify_id = mr.source_id
    WHERE mr.entity_type = 'album' AND mr.target_id = ${albumId} AND mr.user_id = ${userId}
  `) as { source_id: string; name: string; image_url: string | null }[];

  if (sourceAlbumRows.length === 0) return c.json({ pairs: [], sourceAlbums: [] });

  const mergedTrackIds = new Set(
    (db.all(sql`SELECT source_id FROM merge_rules WHERE entity_type = 'track' AND user_id = ${userId}`) as { source_id: string }[])
      .map(r => r.source_id)
  );

  const getUnmergedTracks = (aid: string): MatchableTrack[] =>
    (db.all(sql`
      SELECT t.spotify_id as id, t.name, t.track_number, t.disc_number, t.duration_ms
      FROM tracks t WHERE t.album_id = ${aid}
      ORDER BY COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, t.name ASC
    `) as { id: string; name: string; track_number: number | null; disc_number: number | null; duration_ms: number }[])
      .filter(t => !mergedTrackIds.has(t.id))
      .map(t => ({ id: t.id, name: t.name, trackNumber: t.track_number, discNumber: t.disc_number, durationMs: t.duration_ms }));

  const targetTracks = getUnmergedTracks(albumId);

  const pairs: Array<{
    sourceTrack: MatchableTrack;
    targetTrack: MatchableTrack;
    sourceAlbumName: string;
    confidence: 'position' | 'name';
  }> = [];

  const usedTargetIds = new Set<string>();

  for (const sa of sourceAlbumRows) {
    const sourceTracks = getUnmergedTracks(sa.source_id);
    const availableTargets = targetTracks.filter(t => !usedTargetIds.has(t.id));
    const matches = autoMatchTracks(sourceTracks, availableTargets);

    for (const m of matches) {
      const st = sourceTracks.find(t => t.id === m.sourceTrackId)!;
      const tt = targetTracks.find(t => t.id === m.targetTrackId)!;
      pairs.push({ sourceTrack: st, targetTrack: tt, sourceAlbumName: sa.name, confidence: m.confidence });
      usedTargetIds.add(m.targetTrackId);
    }
  }

  return c.json({
    pairs,
    sourceAlbums: sourceAlbumRows.map(r => ({ id: r.source_id, name: r.name })),
  });
});

// batch merge de tracks (sin crear merge de álbum — para re-merge de tracks de álbumes ya mergeados)
admin.post('/batch-merge-tracks', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ trackPairs: Array<{ sourceTrackId: string; targetTrackId: string }> }>();
  const { trackPairs } = body;

  if (!trackPairs?.length) return c.json({ error: 'trackPairs array is required' }, 400);

  const db = getDb();

  const result = db.transaction(() => {
    let created = 0;
    const skipped: string[] = [];

    for (const pair of trackPairs) {
      if (!pair.sourceTrackId || !pair.targetTrackId || pair.sourceTrackId === pair.targetTrackId) {
        skipped.push(`${pair.sourceTrackId}: invalid pair`);
        continue;
      }

      const src = db.select().from(tracks).where(eq(tracks.spotifyId, pair.sourceTrackId)).get();
      const tgt = db.select().from(tracks).where(eq(tracks.spotifyId, pair.targetTrackId)).get();
      if (!src || !tgt) { skipped.push(`${pair.sourceTrackId}: track not found`); continue; }

      const tv = validateMergeRule(db, userId, 'track', pair.sourceTrackId, pair.targetTrackId);
      if (!tv.ok) {
        const reasons = { exists: 'already merged', source_is_target: 'is already a merge target', target_is_source: 'target already merged elsewhere' };
        skipped.push(`${pair.sourceTrackId}: ${reasons[tv.reason]}`);
        continue;
      }

      db.insert(mergeRules).values({
        userId, entityType: 'track', sourceId: pair.sourceTrackId, targetId: pair.targetTrackId,
      }).run();
      created++;
    }

    return { created, skipped };
  });

  return c.json(result);
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
  const importFilter = sql`e.spotify_id NOT LIKE 'unresolved:%'`;

  let rows: { id: string; name: string; image_url: string | null; plays: number }[] = [];

  if (entityType === 'album') {
    if (!parent) return c.json({ error: 'parent (artistId) is required for album suggestions' }, 400);
    // expandir parent al grupo de merge para incluir álbumes de artistas hermanos / target / sources
    const parentIds = getEntityMergeGroup(db, 'artist', parent, userId);
    const artistInClause = parentIds.length === 1
      ? sql`ta.artist_id = ${parentIds[0]}`
      : sql`ta.artist_id IN (${sql.join(parentIds.map(id => sql`${id}`), sql`, `)})`;
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
      WHERE ${artistInClause}
        AND ${sourceFilter}
        AND ${importFilter}
        ${excludeClause}
      GROUP BY e.spotify_id
      HAVING plays > 0
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
    // expandir parent al grupo de merge para incluir tracks de artistas hermanos / target / sources
    const parentIds = getEntityMergeGroup(db, 'artist', parent, userId);
    const artistInClause = parentIds.length === 1
      ? sql`ta.artist_id = ${parentIds[0]}`
      : sql`ta.artist_id IN (${sql.join(parentIds.map(id => sql`${id}`), sql`, `)})`;
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
      WHERE ${artistInClause}
        AND ${sourceFilter}
        AND ${importFilter}
        ${excludeClause}
      GROUP BY e.spotify_id
      HAVING plays > 0
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

admin.patch('/track/:id', async (c) => {
  const trackId = decodeURIComponent(c.req.param('id'));
  const { durationMs } = await c.req.json<{ durationMs: number }>();

  if (typeof durationMs !== 'number' || durationMs < 0) {
    return c.json({ error: 'durationMs debe ser un número >= 0' }, 400);
  }

  const db = getDb();
  const existing = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
  if (!existing) return c.json({ error: 'track no encontrado' }, 404);

  db.update(tracks).set({ durationMs }).where(eq(tracks.spotifyId, trackId)).run();
  return c.json({ success: true, durationMs });
});

admin.post('/track/:id/refresh-duration', async (c) => {
  const trackId = decodeURIComponent(c.req.param('id'));
  const userId = c.get('userId');

  const db = getDb();
  const existing = db.select().from(tracks).where(eq(tracks.spotifyId, trackId)).get();
  if (!existing) return c.json({ error: 'track no encontrado' }, 404);

  const data = await spotifyFetch<{ duration_ms: number }>(`/tracks/${trackId}`, { userId });
  if (!data) return c.json({ error: 'no se pudo obtener datos de Spotify' }, 502);

  const newMs = data.duration_ms;
  const changed = existing.durationMs !== newMs;
  if (changed) {
    db.update(tracks).set({ durationMs: newMs }).where(eq(tracks.spotifyId, trackId)).run();
  }
  return c.json({ success: true, durationMs: newMs, changed });
});

export default admin;
