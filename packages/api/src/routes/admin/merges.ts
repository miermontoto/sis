import { sql, eq } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { mergeRules, albums, artists, tracks } from '../../db/schema.js';
import { getEntityMergeGroup } from '../../db/queries/merge.js';
import {
  adminRouter, VALID_ENTITY_TYPES, isValidEntityType, entityTable,
  validateMergeRule, MERGE_ERRORS, autoMatchTracks,
} from './_shared.js';
import { buildAlbumRemerge, loadRemergeContext } from './remerge.js';
import { promoteToCanonical, promoteAlbumCanonical, PROMOTE_ERRORS } from './promote.js';
import { getTopEntities } from '../../db/queries/entity.js';
import { getRangeStart } from '../../db/queries/index.js';
import { computeMergeImpact } from './impact.js';
import { BULK_SCAN_LIMITS, DEFAULT_BULK_SCAN_SCOPE, IMPACT_TOP_THRESHOLD } from '../../constants.js';

const merges = adminRouter();

// crear regla de merge
merges.post('/merge', async (c) => {
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

// invertir la dirección de un merge: promover una entidad a canónica de su grupo.
// Reescribe el grupo entero (ver promote.ts); en álbumes arrastra los grupos de tracks.
merges.post('/merge-canonical', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ entityType: string; entityId: string }>();
  const { entityType, entityId } = body;

  if (!entityType || !entityId) {
    return c.json({ error: 'entityType and entityId are required' }, 400);
  }
  if (!isValidEntityType(entityType)) {
    return c.json({ error: `unsupported entityType — must be one of ${VALID_ENTITY_TYPES.join(', ')}` }, 400);
  }

  const db = getDb();
  const exists = db.select().from(entityTable(entityType)).where(eq(entityTable(entityType).spotifyId, entityId)).get();
  if (!exists) return c.json({ error: `${entityType} not found` }, 404);

  const result = db.transaction(() => (entityType === 'album'
    ? promoteAlbumCanonical(db, userId, entityId)
    : promoteToCanonical(db, userId, entityType, entityId)));

  if (!result.ok) {
    const [msg, status] = PROMOTE_ERRORS[result.reason](entityType);
    return c.json({ error: msg }, status as 400);
  }

  return c.json({
    entityType,
    canonicalId: entityId,
    previousCanonicalId: result.previousCanonicalId,
    rulesRewritten: result.rulesRewritten,
    nestedTrackGroups: result.nestedTrackGroups,
  });
});

// impacto en el ranking all-time de unos merges aún no aplicados
merges.post('/merge-impact', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    entityType: string;
    pairs: { sourceId: string; targetId: string }[];
    metric?: string;
  }>();
  const { entityType, pairs } = body;

  if (!isValidEntityType(entityType)) {
    return c.json({ error: `entityType must be one of ${VALID_ENTITY_TYPES.join(', ')}` }, 400);
  }
  if (!Array.isArray(pairs)) return c.json({ error: 'pairs array is required' }, 400);
  if (pairs.length === 0) {
    return c.json({
      entityType, metric: body.metric === 'plays' ? 'plays' : 'time',
      topThreshold: IMPACT_TOP_THRESHOLD, items: [], movedCount: 0, enteredTop: 0, biggest: [],
    });
  }

  const metric = body.metric === 'plays' ? 'plays' : 'time';
  return c.json(computeMergeImpact(getDb(), userId, entityType, pairs, metric));
});

// eliminar regla de merge (verificar que pertenece al usuario)
merges.delete('/merge/:id', (c) => {
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
merges.get('/merges', (c) => {
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
merges.get('/album-merge-preview', (c) => {
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
merges.post('/merge-album', async (c) => {
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

// preview de re-merge de un álbum: candidatos de auto-merge para su grupo.
merges.get('/album-remerge-preview', (c) => {
  const userId = c.get('userId');
  const albumId = c.req.query('album');
  if (!albumId) return c.json({ error: 'album query param is required' }, 400);

  const db = getDb();
  const album = db.select().from(albums).where(eq(albums.spotifyId, albumId)).get();
  if (!album) return c.json({ error: 'album not found' }, 404);

  return c.json(buildAlbumRemerge(db, albumId, album.name, loadRemergeContext(db, userId)));
});

// barrido masivo: los mismos candidatos sobre los álbumes más escuchados de todos los
// tiempos, para revisarlos de una sentada en vez de álbum por álbum. Se devuelven sólo
// los álbumes con candidatos; el orden es el del top (más tiempo escuchado primero).
merges.get('/bulk-remerge-preview', (c) => {
  const userId = c.get('userId');
  const scope = c.req.query('scope') ?? DEFAULT_BULK_SCAN_SCOPE;
  const limit = BULK_SCAN_LIMITS[scope];
  if (!limit) {
    return c.json({ error: `unsupported scope — must be one of ${Object.keys(BULK_SCAN_LIMITS).join(', ')}` }, 400);
  }

  const db = getDb();
  const top = getTopEntities(db, 'album', getRangeStart('all'), 'time', limit, null, userId);
  const ctx = loadRemergeContext(db, userId);

  const names = new Map(
    (top.length === 0 ? [] : db.all(sql`
      SELECT spotify_id, name, image_url FROM albums
      WHERE spotify_id IN (${sql.join(top.map(r => sql`${r.entity_id}`), sql`, `)})
    `) as { spotify_id: string; name: string; image_url: string | null }[])
      .map(a => [a.spotify_id, a] as const)
  );

  const scanned = top.filter(r => names.has(r.entity_id));
  const albumsOut = scanned
    .map(row => {
      const meta = names.get(row.entity_id)!;
      const { pairs } = buildAlbumRemerge(db, row.entity_id, meta.name, ctx);
      return { id: row.entity_id, name: meta.name, imageUrl: meta.image_url, playCount: row.play_count, pairs };
    })
    .filter(a => a.pairs.length > 0);

  return c.json({
    scope,
    scanned: scanned.length,
    albums: albumsOut,
    totalPairs: albumsOut.reduce((n, a) => n + a.pairs.length, 0),
  });
});

// batch merge de tracks (sin crear merge de álbum — para re-merge de tracks de álbumes ya mergeados)
merges.post('/batch-merge-tracks', async (c) => {
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
merges.get('/merge-suggestions', (c) => {
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
    // matchear el artista en cualquier posición (no solo la principal): distintos releases
    // de la misma canción acreditan al artista en distinto orden (ej. "The Line" en el álbum
    // de la banda sonora vs. el single), y con position=0 no aparecerían como candidatos.
    rows = db.all(sql`
      SELECT e.spotify_id as id, e.name, al.image_url as image_url,
             COALESCE(s.play_count, 0) as plays
      FROM tracks e
      JOIN track_artists ta ON ta.track_id = e.spotify_id
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

export default merges;
