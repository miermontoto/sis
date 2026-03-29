import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { pollingState } from '../db/schema.js';
import { spotifyFetch } from './spotify-client.js';
import { insertPlay, insertLocalPlay, upsertTrack, enrichArtistMetadata, enrichLocalAlbumCovers, resolveLocalFileIds, resolveImportArtists, resolveImportAlbums, fixTrackAlbumAssignments, fixTrackArtistAssociations, deduplicateTracks, deduplicateAlbums, deduplicateLocalAlbums } from './ingestion.js';
import { getStoredTokens } from './token-manager.js';
import { getAllActiveUsersWithTokens } from './user-manager.js';
import {
  CURRENTLY_PLAYING_INTERVAL_MS,
  RECENTLY_PLAYED_INTERVAL_MS,
  RECENTLY_PLAYED_LIMIT,
  METADATA_REFRESH_INTERVAL_MS,
  RECORDS_CACHE_INTERVAL_MS,
} from '../constants.js';
import { computeAndCacheRecords } from './records-cache.js';
import type {
  SpotifyCurrentlyPlayingResponse,
  SpotifyRecentlyPlayedResponse,
} from '../types/spotify.js';

// timers por usuario
interface UserTimers {
  currentlyPlaying: ReturnType<typeof setInterval>;
  recentlyPlayed: ReturnType<typeof setInterval>;
}

const userTimers = new Map<number, UserTimers>();

// estado de archivos locales por usuario
const userLocalTracks = new Map<number, { id: string; startedAt: string; durationMs: number; lastProgressMs: number }>();

// timers compartidos (catálogo global)
let metadataRefreshTimer: ReturnType<typeof setInterval> | null = null;
let artistFixTimer: ReturnType<typeof setInterval> | null = null;
let recordsCacheTimer: ReturnType<typeof setInterval> | null = null;

const ARTIST_FIX_INTERVAL_MS = 5 * 60_000;

function getPollingStateForUser(userId: number) {
  const db = getDb();
  return db.select().from(pollingState).where(eq(pollingState.userId, userId)).get();
}

function updatePollingStateForUser(userId: number, data: Partial<typeof pollingState.$inferInsert>) {
  const db = getDb();
  const existing = getPollingStateForUser(userId);
  if (existing) {
    db.update(pollingState).set(data).where(eq(pollingState.userId, userId)).run();
  } else {
    db.insert(pollingState).values({ userId, ...data }).run();
  }
}

async function pollCurrentlyPlaying(userId: number) {
  try {
    const data = await spotifyFetch<SpotifyCurrentlyPlayingResponse>('/me/player/currently-playing', { userId });

    if (!data || !data.item || data.currently_playing_type !== 'track') {
      // si el track anterior era local, registrar la reproducción
      const lastLocal = userLocalTracks.get(userId);
      if (lastLocal) {
        insertLocalPlay(lastLocal.id, lastLocal.startedAt, userId, lastLocal.durationMs);
        console.log(`[poll:${userId}] registrada reproducción local: ${lastLocal.id}`);
        userLocalTracks.delete(userId);
      }
      updatePollingStateForUser(userId, {
        lastCurrentlyPlayingTrackId: null,
        lastCurrentlyPlayingAt: null,
      });
      const db = getDb();
      db.run(sql`UPDATE polling_state SET is_playing = 0 WHERE user_id = ${userId}`);
      return;
    }

    // resolver IDs sintéticos para archivos locales antes de comparar
    resolveLocalFileIds(data.item);

    const state = getPollingStateForUser(userId);
    const trackChanged = state?.lastCurrentlyPlayingTrackId !== data.item.id;

    // detectar loop: mismo track local pero el progreso retrocedió (reinició)
    const progressMs = data.progress_ms ?? 0;
    const lastLocal = userLocalTracks.get(userId);
    const loopDetected = !trackChanged
      && lastLocal
      && lastLocal.id === data.item.id
      && progressMs < lastLocal.lastProgressMs;

    if (trackChanged || loopDetected) {
      // si el track anterior era local, registrar la reproducción
      if (lastLocal) {
        insertLocalPlay(lastLocal.id, lastLocal.startedAt, userId, lastLocal.durationMs);
        console.log(`[poll:${userId}] registrada reproducción local: ${lastLocal.id}`);
      }

      if (trackChanged) {
        upsertTrack(data.item);
        console.log(`[poll:${userId}] reproduciendo: ${data.item.artists[0]?.name} - ${data.item.name}`);
      }

      // trackear si el track actual es local
      if (data.item.is_local) {
        userLocalTracks.set(userId, { id: data.item.id, startedAt: new Date().toISOString(), durationMs: data.item.duration_ms, lastProgressMs: progressMs });
      } else {
        userLocalTracks.delete(userId);
      }
    } else if (lastLocal) {
      // actualizar progreso para detección de loop
      lastLocal.lastProgressMs = progressMs;
    }

    updatePollingStateForUser(userId, {
      lastCurrentlyPlayingTrackId: data.item.id,
      lastCurrentlyPlayingAt: new Date().toISOString(),
    });
    const db = getDb();
    db.run(sql`UPDATE polling_state SET is_playing = ${data.is_playing ? 1 : 0} WHERE user_id = ${userId}`);
  } catch (err) {
    console.error(`[poll:${userId}] error en currently playing:`, err);
  }
}

async function pollRecentlyPlayed(userId: number) {
  try {
    const state = getPollingStateForUser(userId);
    const params: Record<string, string> = {
      limit: String(RECENTLY_PLAYED_LIMIT),
    };

    // usar cursor para obtener solo tracks nuevos
    if (state?.lastRecentlyPlayedCursor) {
      params.after = state.lastRecentlyPlayedCursor;
    }

    const data = await spotifyFetch<SpotifyRecentlyPlayedResponse>(
      '/me/player/recently-played',
      { userId, params },
    );

    if (!data?.items?.length) return;

    let inserted = 0;
    for (const item of data.items) {
      if (insertPlay(item, userId)) inserted++;
    }

    // actualizar cursor para la siguiente poll
    if (data.cursors?.after) {
      updatePollingStateForUser(userId, {
        lastRecentlyPlayedCursor: data.cursors.after,
        lastPollAt: new Date().toISOString(),
      });
    }

    if (inserted > 0) {
      console.log(`[poll:${userId}] ${inserted} nuevas reproducciones registradas`);
    }
  } catch (err) {
    console.error(`[poll:${userId}] error en recently played:`, err);
  }
}

function startPollingForUser(userId: number) {
  if (userTimers.has(userId)) return; // ya activo

  const tokens = getStoredTokens(userId);
  if (!tokens) {
    console.log(`[poll:${userId}] sin tokens, saltando`);
    return;
  }

  console.log(`[poll:${userId}] iniciando polling...`);

  // ejecutar inmediatamente
  pollCurrentlyPlaying(userId);
  pollRecentlyPlayed(userId);

  const timers: UserTimers = {
    currentlyPlaying: setInterval(() => pollCurrentlyPlaying(userId), CURRENTLY_PLAYING_INTERVAL_MS),
    recentlyPlayed: setInterval(() => pollRecentlyPlayed(userId), RECENTLY_PLAYED_INTERVAL_MS),
  };

  userTimers.set(userId, timers);
}

function stopPollingForUser(userId: number) {
  const timers = userTimers.get(userId);
  if (!timers) return;
  clearInterval(timers.currentlyPlaying);
  clearInterval(timers.recentlyPlayed);
  userTimers.delete(userId);
  userLocalTracks.delete(userId);
}

// obtener el primer userId con tokens (para operaciones globales de catálogo)
function getAnyActiveUserId(): number | null {
  const users = getAllActiveUsersWithTokens();
  return users.length > 0 ? users[0].userId : null;
}

export function startPolling() {
  const activeUsers = getAllActiveUsersWithTokens();
  if (activeUsers.length === 0) {
    console.log('[poll] sin usuarios con tokens, polling desactivado');
    return;
  }

  console.log(`[poll] iniciando polling para ${activeUsers.length} usuario(s)...`);

  // polling per-user
  for (const { userId } of activeUsers) {
    startPollingForUser(userId);
  }

  // operaciones globales de catálogo (usan cualquier token activo)
  const globalUserId = activeUsers[0].userId;

  enrichArtistMetadata(globalUserId).catch(err => console.error('[metadata] error:', err));
  enrichLocalAlbumCovers().catch(err => console.error('[metadata] error portadas:', err));

  metadataRefreshTimer = setInterval(() => {
    const uid = getAnyActiveUserId();
    if (!uid) return;
    enrichArtistMetadata(uid).catch(err => console.error('[metadata] error:', err));
    enrichLocalAlbumCovers().catch(err => console.error('[metadata] error portadas:', err));
    resolveImportArtists(uid).catch(err => console.error('[resolve] error artistas:', err));
    resolveImportAlbums(uid).catch(err => console.error('[resolve] error álbumes:', err));
    fixTrackAlbumAssignments(uid).catch(err => console.error('[resolve] error álbumes tracks:', err));
  }, METADATA_REFRESH_INTERVAL_MS);

  fixTrackArtistAssociations(globalUserId)
    .then(() => { deduplicateTracks(); deduplicateAlbums(); deduplicateLocalAlbums(); })
    .catch(err => console.error('[resolve] error artistas:', err));
  artistFixTimer = setInterval(() => {
    const uid = getAnyActiveUserId();
    if (!uid) return;
    fixTrackArtistAssociations(uid)
      .then(() => { deduplicateTracks(); deduplicateAlbums(); deduplicateLocalAlbums(); })
      .catch(err => console.error('[resolve] error artistas:', err));
  }, ARTIST_FIX_INTERVAL_MS);

  // records cache (se recomputa para todos los usuarios)
  try { computeAndCacheRecords(); } catch (err) { console.error('[records-cache] error:', err); }
  recordsCacheTimer = setInterval(
    () => { try { computeAndCacheRecords(); } catch (err) { console.error('[records-cache] error:', err); } },
    RECORDS_CACHE_INTERVAL_MS,
  );

  console.log(`[poll] currently playing cada ${CURRENTLY_PLAYING_INTERVAL_MS / 1000}s`);
  console.log(`[poll] recently played cada ${RECENTLY_PLAYED_INTERVAL_MS / 1000}s`);
}

export function stopPolling() {
  // detener timers por usuario
  for (const [userId] of userTimers) {
    stopPollingForUser(userId);
  }

  // detener timers compartidos
  if (metadataRefreshTimer) clearInterval(metadataRefreshTimer);
  if (artistFixTimer) clearInterval(artistFixTimer);
  if (recordsCacheTimer) clearInterval(recordsCacheTimer);
  metadataRefreshTimer = null;
  artistFixTimer = null;
  recordsCacheTimer = null;
  console.log('[poll] polling detenido');
}

// re-iniciar polling (útil después de OAuth de nuevo usuario)
export function restartPolling() {
  stopPolling();
  startPolling();
}
