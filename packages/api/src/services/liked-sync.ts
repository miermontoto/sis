// espejo local de los "liked songs" de spotify. la pertenencia se consultaba en
// vivo (`/me/tracks/contains`) en cada cambio de tema y en cada detalle de track:
// una llamada a spotify por corazón pintado. aquí se mantiene una copia en sqlite
// y la comprobación pasa a ser una lectura local.
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { LIKED_SYNC_PAGE_SIZE } from '../constants.js';
import { spotifyFetch } from './spotify-client.js';
import { getAllActiveUsersWithTokens } from './user-manager.js';
import type { SpotifySavedTracksResponse } from '../types/spotify.js';
import { createLogger } from './logger.js';

const log = createLogger('liked-sync');

/** ¿tenemos espejo para este usuario? sin él la pertenencia no se puede
 *  responder en local y hay que caer a spotify. */
export function isLikedSynced(userId: number): boolean {
  return !!getDb().all(sql`SELECT 1 FROM liked_sync_state WHERE user_id = ${userId}`)[0];
}

export function isTrackLiked(userId: number, trackId: string): boolean {
  return !!getDb().all(sql`
    SELECT 1 FROM liked_tracks WHERE user_id = ${userId} AND track_id = ${trackId}
  `)[0];
}

/** subconjunto de `trackIds` que está en los liked del usuario. */
export function likedTrackIds(userId: number, trackIds: string[]): string[] {
  if (trackIds.length === 0) return [];
  const rows = getDb().all(sql`
    SELECT track_id FROM liked_tracks
    WHERE user_id = ${userId} AND track_id IN (${sql.join(trackIds.map(id => sql`${id}`), sql`, `)})
  `) as { track_id: string }[];
  return rows.map(r => r.track_id);
}

/** aplica un like/unlike propio al espejo. `total` se mueve con él porque el de
 *  spotify también cambia: si no, el siguiente ciclo vería discrepancia y
 *  repaginaría la biblioteca entera por una pulsación nuestra. */
export function setTrackLikedLocal(userId: number, trackId: string, liked: boolean): void {
  const db = getDb();
  if (!isLikedSynced(userId)) return;
  const changed = liked !== isTrackLiked(userId, trackId);
  if (liked) {
    db.run(sql`
      INSERT OR IGNORE INTO liked_tracks (user_id, track_id, added_at)
      VALUES (${userId}, ${trackId}, ${new Date().toISOString()})
    `);
  } else {
    db.run(sql`DELETE FROM liked_tracks WHERE user_id = ${userId} AND track_id = ${trackId}`);
  }
  if (changed) {
    db.run(sql`
      UPDATE liked_sync_state SET total = MAX(0, total + ${liked ? 1 : -1}) WHERE user_id = ${userId}
    `);
  }
}

/** Sincroniza el espejo de un usuario.
 *
 *  `/me/tracks` viene ordenado por fecha de guardado descendente, así que toda
 *  alta aparece en la primera página y toda baja mueve el `total`. Con esas dos
 *  señales el caso normal (nada ha cambiado) se resuelve en UNA petición; sólo
 *  cuando alguna falla se pagina la biblioteca entera. */
export async function syncUserLikedTracks(userId: number): Promise<void> {
  const db = getDb();
  const first = await spotifyFetch<SpotifySavedTracksResponse>('/me/tracks', {
    userId,
    params: { limit: String(LIKED_SYNC_PAGE_SIZE), offset: '0' },
  });
  // sin respuesta (rate limit, token caído): no tocar el espejo, reintenta el
  // siguiente ciclo. borrarlo dejaría los corazones apagados mientras tanto
  if (!first) return;

  const state = db.all(sql`
    SELECT total FROM liked_sync_state WHERE user_id = ${userId}
  `)[0] as { total: number } | undefined;

  const pageIds = first.items.map(i => i.track?.id).filter((id): id is string => !!id);
  const now = new Date().toISOString();

  if (state && state.total === first.total && likedTrackIds(userId, pageIds).length === pageIds.length) {
    db.run(sql`UPDATE liked_sync_state SET synced_at = ${now} WHERE user_id = ${userId}`);
    log.debug(`usuario ${userId}: sin cambios (${first.total} liked)`);
    return;
  }

  const collected = first.items
    .filter(i => !!i.track?.id)
    .map(i => ({ trackId: i.track!.id, addedAt: i.added_at }));
  let next = first.next;
  let offset = first.items.length;

  while (next) {
    const page = await spotifyFetch<SpotifySavedTracksResponse>('/me/tracks', {
      userId,
      params: { limit: String(LIKED_SYNC_PAGE_SIZE), offset: String(offset) },
    });
    if (!page || page.items.length === 0) break;
    for (const item of page.items) {
      if (item.track?.id) collected.push({ trackId: item.track.id, addedAt: item.added_at });
    }
    offset += page.items.length;
    next = page.next;
  }

  // reemplazo atómico: un espejo a medias es peor que uno viejo, porque cada
  // hueco se lee como "no está en tus liked"
  db.transaction(() => {
    db.run(sql`DELETE FROM liked_tracks WHERE user_id = ${userId}`);
    for (const t of collected) {
      db.run(sql`
        INSERT OR IGNORE INTO liked_tracks (user_id, track_id, added_at)
        VALUES (${userId}, ${t.trackId}, ${t.addedAt})
      `);
    }
    db.run(sql`
      INSERT INTO liked_sync_state (user_id, total, synced_at)
      VALUES (${userId}, ${first.total}, ${now})
      ON CONFLICT(user_id) DO UPDATE SET total = ${first.total}, synced_at = ${now}
    `);
  });

  log.info(`usuario ${userId}: ${collected.length} liked songs sincronizados`);
}

export async function syncAllUsersLikedTracks(): Promise<void> {
  for (const { userId } of getAllActiveUsersWithTokens()) {
    try {
      await syncUserLikedTracks(userId);
    } catch (err) {
      log.error(`error usuario ${userId}:`, err);
    }
  }
}
