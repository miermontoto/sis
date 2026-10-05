// Créditos corregidos por el usuario (shared/credits.ts): lectura para el modal y
// escritura para routes/credits.ts. Lo que los APLICA a las cifras vive en helpers.ts
// (trackArtistsFor, artistCreditedAlbums, albumArtistId) y en los formateadores.
import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import type { CreditArtist, CreditSubjectType, EntityCredits } from '@sis/shared';
import { getAlbumArtists } from './album.js';
import { getEntityMergeGroup } from './merge.js';

type ArtistRow = { id: string; name: string; image_url: string | null };
const toCredit = (r: ArtistRow): CreditArtist => ({ id: r.id, name: r.name, imageUrl: r.image_url });
const idList = (ids: string[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

// los del catálogo: para un álbum, la misma resolución que su página sin corregir
// (artist_ids de spotify o la mayoría de sus temas)
function originalCredits(db: Db, type: CreditSubjectType, id: string): CreditArtist[] {
  if (type === 'album') {
    return getAlbumArtists(db, id, undefined, null).map(a => ({ id: a.artist_id, name: a.name, imageUrl: a.image_url }));
  }
  return (db.all(sql`
    SELECT a.spotify_id AS id, a.name, a.image_url
    FROM track_artists ta JOIN artists a ON a.spotify_id = ta.artist_id
    WHERE ta.track_id = ${id}
    ORDER BY ta.position
  `) as ArtistRow[]).map(toCredit);
}

function correctedCredits(db: Db, type: CreditSubjectType, id: string, userId: number): CreditArtist[] {
  return (db.all(sql`
    SELECT a.spotify_id AS id, a.name, a.image_url
    FROM credit_overrides co JOIN artists a ON a.spotify_id = co.artist_id
    WHERE co.user_id = ${userId} AND co.subject_type = ${type} AND co.subject_id = ${id}
    ORDER BY co.position
  `) as ArtistRow[]).map(toCredit);
}

export function getEntityCredits(db: Db, type: CreditSubjectType, id: string, userId: number): EntityCredits {
  const original = originalCredits(db, type, id);
  const corrected = correctedCredits(db, type, id, userId);
  return { original, credits: corrected.length > 0 ? corrected : original, overridden: corrected.length > 0 };
}

/** Escribe la lista corregida sobre el GRUPO de merge entero, no sobre el id suelto: el
 *  eje artista cuenta cada play por los créditos de su track crudo (y `artistCreditedAlbums`
 *  por los del álbum crudo), así que corregir sólo el canónico dejaba las escuchas de sus
 *  alias contando para los artistas de antes, dentro de la misma página.
 *  Una lista igual a la del catálogo no se guarda: es deshacer la corrección. */
export function setEntityCredits(db: Db, type: CreditSubjectType, id: string, userId: number, artistIds: string[]): void {
  const group = getEntityMergeGroup(db, type, id, userId);
  const same = originalCredits(db, type, id).map(a => a.id).join(',') === artistIds.join(',');
  db.transaction((tx) => {
    tx.run(sql`DELETE FROM credit_overrides WHERE user_id = ${userId} AND subject_type = ${type} AND subject_id IN (${idList(group)})`);
    if (same) return;
    group.forEach(subjectId => artistIds.forEach((artistId, position) => tx.run(sql`
      INSERT INTO credit_overrides (user_id, subject_type, subject_id, artist_id, position)
      VALUES (${userId}, ${type}, ${subjectId}, ${artistId}, ${position})
    `)));
  });
}

export function clearEntityCredits(db: Db, type: CreditSubjectType, id: string, userId: number): void {
  const group = getEntityMergeGroup(db, type, id, userId);
  db.run(sql`DELETE FROM credit_overrides WHERE user_id = ${userId} AND subject_type = ${type} AND subject_id IN (${idList(group)})`);
}
