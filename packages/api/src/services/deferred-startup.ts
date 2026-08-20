// Estado de tareas diferidas al startup — se ejecutan al primer request de cada usuario
// en vez de bloquear el arranque del servidor.

import { syncUserPlaylists } from './playlist-sync.js';
import { computeAndCacheForUserAsync } from './records-cache.js';
import { warmRecentRankChanges } from './recent-changes-cache.js';
import { getProfileSummaryCached, getUserStreaksCached } from './social.js';
import { getUserById } from './user-manager.js';
import { createLogger } from './logger.js';

const logPlaylistSync = createLogger('playlist-sync');
const logRecordsCache = createLogger('records-cache');
const logRecentChanges = createLogger('recent-changes');
const logSocialCard = createLogger('social-card');
const deferredUsers = new Set<number>();

/** Lanzar tareas diferidas para un usuario (playlist sync + records cache +
 *  warmup de recent-rank-changes). Todo en worker threads, sin bloquear el
 *  event loop principal. */
export function triggerDeferredStartup(userId: number) {
  if (deferredUsers.has(userId)) return;
  deferredUsers.add(userId);

  syncUserPlaylists(userId).catch(err =>
    logPlaylistSync.error(`error lazy sync usuario ${userId}:`, err));

  // records cache + recent-rank-changes: ejecutan sus queries en worker threads via dbRead
  const user = getUserById(userId);
  if (user) {
    computeAndCacheForUserAsync(userId, user.spotifyId).catch(err =>
      logRecordsCache.error(`error lazy compute usuario ${userId}:`, err));
    warmRecentRankChanges(userId, user.spotifyId).catch(err =>
      logRecentChanges.error(`error en warmup usuario ${userId}:`, err));
    // tarjeta de identidad social (resumen + rachas all-time): warmup para que el
    // primer /u o /compare tras un deploy no pague los scans completos
    getProfileSummaryCached(userId).catch(err =>
      logSocialCard.error(`error en warmup de resumen usuario ${userId}:`, err));
    getUserStreaksCached(userId).catch(err =>
      logSocialCard.error(`error en warmup de rachas usuario ${userId}:`, err));
  }
}

/** Resetear estado (tras OAuth de nuevo usuario, restartPolling, etc.) */
export function resetDeferredState() {
  deferredUsers.clear();
}
