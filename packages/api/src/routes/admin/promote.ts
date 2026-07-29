// promoción de un miembro de un grupo de merge a canónico ("swap" de dirección).
//
// Un grupo es siempre un canónico + N sources, de un solo nivel: validateMergeRule
// rechaza encadenar merges. Por eso invertir UNA regla suelta no vale — dejaría a los
// hermanos apuntando a un source. La operación correcta reescribe el grupo entero:
// el canónico viejo y todos los hermanos pasan a apuntar al promovido.
import { sql } from 'drizzle-orm';
import { mergeRules } from '../../db/schema.js';
import type { getDb } from '../../db/connection.js';
import type { EntityType } from '@sis/shared';

type Db = ReturnType<typeof getDb>;

export type PromoteResult =
  | { ok: true; previousCanonicalId: string; rulesRewritten: number; nestedTrackGroups: number }
  | { ok: false; reason: 'not_merged' | 'already_canonical' };

export const PROMOTE_ERRORS: Record<string, (type: string) => [string, number]> = {
  not_merged: (t) => [`${t} is not merged into anything — nothing to swap`, 400],
  already_canonical: (t) => [`${t} is already the canonical of its group`, 409],
};

/** Reescribe el grupo de `newCanonicalId` para que sea él el canónico. No abre
 *  transacción: el caller decide el alcance (una promoción de álbum arrastra las
 *  de sus tracks y todo debe caer junto). */
export function promoteToCanonical(
  db: Db, userId: number, type: EntityType, newCanonicalId: string,
): PromoteResult {
  const parent = db.all(sql`
    SELECT target_id FROM merge_rules
    WHERE entity_type = ${type} AND source_id = ${newCanonicalId} AND user_id = ${userId}
  `)[0] as { target_id: string } | undefined;

  if (!parent) {
    const isCanonical = (db.all(sql`
      SELECT 1 FROM merge_rules
      WHERE entity_type = ${type} AND target_id = ${newCanonicalId} AND user_id = ${userId} LIMIT 1
    `)).length > 0;
    return { ok: false, reason: isCanonical ? 'already_canonical' : 'not_merged' };
  }

  const previousCanonicalId = parent.target_id;
  const siblings = (db.all(sql`
    SELECT source_id FROM merge_rules
    WHERE entity_type = ${type} AND target_id = ${previousCanonicalId} AND user_id = ${userId}
  `) as { source_id: string }[]).map(r => r.source_id);

  // el canónico viejo baja a source y los hermanos se repuntan; el promovido sale de la lista
  const newSources = [previousCanonicalId, ...siblings.filter(s => s !== newCanonicalId)];

  db.run(sql`
    DELETE FROM merge_rules
    WHERE entity_type = ${type} AND target_id = ${previousCanonicalId} AND user_id = ${userId}
  `);
  // vía drizzle, no SQL crudo: created_at es NOT NULL sin default en SQLite y su valor
  // lo pone el $defaultFn del schema
  for (const sourceId of newSources) {
    db.insert(mergeRules).values({
      userId, entityType: type, sourceId, targetId: newCanonicalId,
    }).run();
  }

  return { ok: true, previousCanonicalId, rulesRewritten: newSources.length, nestedTrackGroups: 0 };
}

/** Promoción de álbum: además del grupo de álbumes, arrastra los grupos de tracks cuyo
 *  canónico vive en el álbum que deja de serlo. Si no, el álbum recién promovido mostraría
 *  pistas que a su vez están fusionadas hacia las del álbum viejo. */
export function promoteAlbumCanonical(db: Db, userId: number, newAlbumId: string): PromoteResult {
  const album = promoteToCanonical(db, userId, 'album', newAlbumId);
  if (!album.ok) return album;

  // un grupo de tracks por canónico viejo: si varias pistas del álbum promovido caen en el
  // mismo grupo, sólo se promociona una (MIN por id, determinista) — el resto quedan como
  // hermanos suyos, que es exactamente lo que promoteToCanonical deja
  const nested = db.all(sql`
    SELECT MIN(mr.source_id) as new_track
    FROM merge_rules mr
    JOIN tracks st ON st.spotify_id = mr.source_id
    JOIN tracks tt ON tt.spotify_id = mr.target_id
    WHERE mr.entity_type = 'track' AND mr.user_id = ${userId}
      AND st.album_id = ${newAlbumId}
      AND tt.album_id = ${album.previousCanonicalId}
    GROUP BY mr.target_id
  `) as { new_track: string }[];

  const promoted = nested.filter(r => promoteToCanonical(db, userId, 'track', r.new_track).ok);
  return { ...album, nestedTrackGroups: promoted.length };
}
