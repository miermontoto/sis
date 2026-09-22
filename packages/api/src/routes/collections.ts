// Colecciones ("álbumes lógicos"): contenedor del usuario que agrega álbumes enteros y
// temas sueltos de un artista. A diferencia de un merge no absorbe a sus miembros —sus
// páginas siguen enteras—, pero en los rankings los sustituye (ver shared/collections.ts
// y db/queries/helpers.ts). Misma familia de anotación por usuario que album_ratings y
// concerts: las lecturas resuelven el grupo de merge del artista, las escrituras caen
// sobre el id visitado.
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppVariables } from '../app.js';
import { getDb } from '../db/connection.js';
import { getEntityMergeGroup } from '../db/queries/merge.js';
import {
  createCollection, updateCollection, deleteCollection, addCollectionMember,
  removeCollectionMember, reorderCollectionMembers, findMemberCollection,
  getCollectionRow, getCollectionSummary, getArtistCollections, getCollectionMembers,
  canonicalMemberId, isEligibleMember, artistMergeGroup, getEligibleCollections,
  getCollectionCandidates,
} from '../db/queries/collections.js';
import { invalidateRecordsCacheForUser } from '../services/records-cache.js';
import { invalidateReportCacheForUser } from '../services/report-cache.js';
import { COLLECTION_NAME_MAX_CHARS, COLLECTION_NOTES_MAX_CHARS, COLLECTION_CANDIDATES_LIMIT } from '@sis/shared';
import type { CollectionMemberType } from '@sis/shared';

const collections = new Hono<{ Variables: AppVariables }>();

/** Una colección cambia a qué entidad se atribuyen los plays de sus miembros, así que
 *  mueve TODO ranking derivado. Las caches horneadas se calculan sobre la marca de agua
 *  del historial (`MAX(played_at)`), que una mutación de colección no toca: sin esto,
 *  crear una colección no se vería en records ni en reports hasta el próximo play. */
function invalidateDerived(userId: number): void {
  invalidateRecordsCacheForUser(userId);
  invalidateReportCacheForUser(userId);
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, COLLECTION_NAME_MAX_CHARS);
  return name.length > 0 ? name : null;
}

function parseNotes(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, COLLECTION_NOTES_MAX_CHARS) || null;
}

function isMemberType(value: unknown): value is CollectionMemberType {
  return value === 'album' || value === 'track';
}

// colecciones de un artista, resueltas sobre su grupo de merge (igual que los
// conciertos y las valoraciones): la página de un alias enseña las del canónico
collections.get('/artist/:id', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const artistIds = getEntityMergeGroup(db, 'artist', c.req.param('id'), userId);
  return c.json(getArtistCollections(db, artistIds, userId));
});

// colecciones en las que ESTA entidad puede entrar: las de cualquier artista
// acreditado en ella, no sólo las del principal (un tema a dos nombres cabe en las
// dos). `memberOf` dice cuál la tiene ya, si alguna
collections.get('/for/:type/:entityId', (c) => {
  const userId = c.get('userId');
  const type = c.req.param('type');
  if (!isMemberType(type)) return c.json({ error: "type must be 'album' or 'track'" }, 400);
  const entityId = c.req.param('entityId');
  const db = getDb();
  const eligible = getEligibleCollections(db, type, entityId, userId);
  const memberOf = findMemberCollection(db, type, entityId, userId);
  return c.json({ collections: eligible, memberOf: memberOf?.id ?? null });
});

// candidatos del picker: lo del artista de la colección que puede entrar en ella
collections.get('/:id{[0-9]+}/candidates', (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const db = getDb();
  if (!getCollectionRow(db, id, userId)) return c.json({ error: 'collection not found' }, 404);
  const limit = Math.min(parseInt(c.req.query('limit') || String(COLLECTION_CANDIDATES_LIMIT)), 200);
  return c.json(getCollectionCandidates(db, id, userId, c.req.query('q') ?? '', limit));
});

collections.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ name?: unknown; artistId?: unknown; notes?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);

  const name = parseName(body.name);
  if (!name) return c.json({ error: 'name is required' }, 400);
  if (typeof body.artistId !== 'string') return c.json({ error: 'artistId is required' }, 400);

  const db = getDb();
  const artist = db.all(sql`SELECT spotify_id FROM artists WHERE spotify_id = ${body.artistId}`)[0];
  if (!artist) return c.json({ error: 'artist not found' }, 404);

  const id = createCollection(db, userId, body.artistId, name, parseNotes(body.notes));
  invalidateDerived(userId);
  return c.json(getCollectionSummary(db, id, userId), 201);
});

// nombre y notas. La portada y el color NO están aquí: una colección tiene fila en
// `albums`, así que los edita el mismo `/api/covers/album/:id` que cualquier disco
collections.put('/:id{[0-9]+}', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: unknown; notes?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);

  const db = getDb();
  if (!getCollectionRow(db, id, userId)) return c.json({ error: 'collection not found' }, 404);

  const fields: { name?: string; notes?: string | null } = {};
  if (body.name !== undefined) {
    const name = parseName(body.name);
    if (!name) return c.json({ error: 'name cannot be empty' }, 400);
    fields.name = name;
  }
  if (body.notes !== undefined) fields.notes = body.notes === null ? null : parseNotes(body.notes);

  updateCollection(db, id, userId, fields);
  invalidateDerived(userId);
  return c.json(getCollectionSummary(db, id, userId));
});

collections.delete('/:id{[0-9]+}', (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const db = getDb();
  if (!getCollectionRow(db, id, userId)) return c.json({ error: 'collection not found' }, 404);
  deleteCollection(db, id, userId);
  invalidateDerived(userId);
  return c.json({ success: true });
});

collections.get('/:id{[0-9]+}/members', (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const db = getDb();
  if (!getCollectionRow(db, id, userId)) return c.json({ error: 'collection not found' }, 404);
  return c.json(getCollectionMembers(db, id, userId));
});

// añadir un miembro. El 409 nombra la colección que ya lo tiene: el invariante de "un
// miembro, una colección" es lo que sostiene que los rankings no cuenten sus plays dos
// veces, así que el conflicto se explica en vez de resolverse por las bravas
collections.post('/:id{[0-9]+}/members', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ entityType?: unknown; entityId?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);
  if (!isMemberType(body.entityType)) return c.json({ error: "entityType must be 'album' or 'track'" }, 400);
  if (typeof body.entityId !== 'string' || !body.entityId) return c.json({ error: 'entityId is required' }, 400);

  const db = getDb();
  if (!getCollectionRow(db, id, userId)) return c.json({ error: 'collection not found' }, 404);

  const table = body.entityType === 'album' ? sql`albums` : sql`tracks`;
  const exists = db.all(sql`SELECT spotify_id FROM ${table} WHERE spotify_id = ${body.entityId}`)[0];
  if (!exists) return c.json({ error: `${body.entityType} not found` }, 404);

  // una colección agrupa lo que es DEL artista: se comprueba sobre el id canónico,
  // que es el que se va a guardar y el que acabará contando (ver isEligibleMember)
  const memberId = canonicalMemberId(db, body.entityType, body.entityId, userId);
  const collection = getCollectionRow(db, id, userId)!;
  if (!isEligibleMember(db, body.entityType, memberId, artistMergeGroup(db, collection.artist_id, userId))) {
    const artist = db.all(sql`SELECT name FROM artists WHERE spotify_id = ${collection.artist_id}`)[0] as { name: string } | undefined;
    return c.json({ error: `not credited to ${artist?.name ?? 'this artist'}` }, 422);
  }

  const conflict = findMemberCollection(db, body.entityType, body.entityId, userId);
  if (conflict) {
    if (conflict.id === id) return c.json(getCollectionMembers(db, id, userId));
    return c.json({ error: 'already in another collection', collectionId: conflict.id, collectionName: conflict.name }, 409);
  }

  addCollectionMember(db, id, userId, body.entityType, body.entityId);
  invalidateDerived(userId);
  return c.json(getCollectionMembers(db, id, userId), 201);
});

collections.delete('/:id{[0-9]+}/members/:type/:entityId', (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const type = c.req.param('type');
  if (!isMemberType(type)) return c.json({ error: "type must be 'album' or 'track'" }, 400);

  const db = getDb();
  if (!getCollectionRow(db, id, userId)) return c.json({ error: 'collection not found' }, 404);
  removeCollectionMember(db, id, userId, type, c.req.param('entityId'));
  invalidateDerived(userId);
  return c.json(getCollectionMembers(db, id, userId));
});

collections.put('/:id{[0-9]+}/order', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ order?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.order)) return c.json({ error: 'order must be an array' }, 400);

  const order = body.order.filter((m): m is { entityType: CollectionMemberType; entityId: string } =>
    !!m && typeof m === 'object' && isMemberType((m as { entityType?: unknown }).entityType) && typeof (m as { entityId?: unknown }).entityId === 'string');

  const db = getDb();
  if (!getCollectionRow(db, id, userId)) return c.json({ error: 'collection not found' }, 404);
  reorderCollectionMembers(db, id, userId, order);
  return c.json(getCollectionMembers(db, id, userId));
});

export default collections;
