// Estado de tareas diferidas al startup — se ejecutan al primer request de cada usuario
// en vez de bloquear el arranque del servidor.

import { syncUserPlaylists } from './playlist-sync.js';
import { computeAndCacheForUserAsync } from './records-cache.js';
import { getUserById } from './user-manager.js';

const deferredUsers = new Set<number>();

/** Lanzar tareas diferidas para un usuario (playlist sync + records cache).
 *  Todo se ejecuta en worker threads, sin bloquear el event loop principal. */
export function triggerDeferredStartup(userId: number) {
  if (deferredUsers.has(userId)) return;
  deferredUsers.add(userId);

  syncUserPlaylists(userId).catch(err =>
    console.error(`[playlist-sync] error lazy sync usuario ${userId}:`, err));

  // records cache: ejecuta getRecords en worker thread via dbRead
  const user = getUserById(userId);
  if (user) {
    computeAndCacheForUserAsync(userId, user.spotifyId).catch(err =>
      console.error(`[records-cache] error lazy compute usuario ${userId}:`, err));
  }
}

/** Resetear estado (tras OAuth de nuevo usuario, restartPolling, etc.) */
export function resetDeferredState() {
  deferredUsers.clear();
}
