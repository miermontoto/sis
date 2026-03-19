import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { pollingState } from '../db/schema.js';
import { spotifyFetch } from './spotify-client.js';
import { insertPlay, insertLocalPlay, upsertTrack, enrichArtistMetadata, enrichLocalAlbumCovers, resolveLocalFileIds, resolveImportArtists, resolveImportAlbums, fixTrackAlbumAssignments, fixTrackArtistAssociations, deduplicateTracks, deduplicateAlbums } from './ingestion.js';
import { getStoredTokens } from './token-manager.js';
import {
  CURRENTLY_PLAYING_INTERVAL_MS,
  RECENTLY_PLAYED_INTERVAL_MS,
  RECENTLY_PLAYED_LIMIT,
  METADATA_REFRESH_INTERVAL_MS,
} from '../constants.js';
import type {
  SpotifyCurrentlyPlayingResponse,
  SpotifyRecentlyPlayedResponse,
} from '../types/spotify.js';

let currentlyPlayingTimer: ReturnType<typeof setInterval> | null = null;
let recentlyPlayedTimer: ReturnType<typeof setInterval> | null = null;
let metadataRefreshTimer: ReturnType<typeof setInterval> | null = null;
let artistFixTimer: ReturnType<typeof setInterval> | null = null;

const ARTIST_FIX_INTERVAL_MS = 5 * 60_000; // cada 5 minutos

// estado del archivo local en reproducción (para registrar plays desde currently-playing)
let lastLocalTrack: { id: string; startedAt: string; durationMs: number; lastProgressMs: number } | null = null;

function getPollingState() {
  const db = getDb();
  return db.select().from(pollingState).where(eq(pollingState.id, 1)).get();
}

function updatePollingState(data: Partial<typeof pollingState.$inferInsert>) {
  const db = getDb();
  const existing = getPollingState();
  if (existing) {
    db.update(pollingState).set(data).where(eq(pollingState.id, 1)).run();
  } else {
    db.insert(pollingState).values({ id: 1, ...data }).run();
  }
}

async function pollCurrentlyPlaying() {
  try {
    const data = await spotifyFetch<SpotifyCurrentlyPlayingResponse>('/me/player/currently-playing');

    if (!data || !data.item || data.currently_playing_type !== 'track') {
      // si el track anterior era local, registrar la reproducción
      if (lastLocalTrack) {
        insertLocalPlay(lastLocalTrack.id, lastLocalTrack.startedAt, lastLocalTrack.durationMs);
        console.log(`[poll] registrada reproducción local: ${lastLocalTrack.id}`);
        lastLocalTrack = null;
      }
      updatePollingState({
        lastCurrentlyPlayingTrackId: null,
        lastCurrentlyPlayingAt: null,
      });
      return;
    }

    // resolver IDs sintéticos para archivos locales antes de comparar
    resolveLocalFileIds(data.item);

    const state = getPollingState();
    const trackChanged = state?.lastCurrentlyPlayingTrackId !== data.item.id;

    // detectar loop: mismo track local pero el progreso retrocedió (reinició)
    const progressMs = data.progress_ms ?? 0;
    const loopDetected = !trackChanged
      && lastLocalTrack
      && lastLocalTrack.id === data.item.id
      && progressMs < lastLocalTrack.lastProgressMs;

    if (trackChanged || loopDetected) {
      // si el track anterior era local, registrar la reproducción
      if (lastLocalTrack) {
        insertLocalPlay(lastLocalTrack.id, lastLocalTrack.startedAt, lastLocalTrack.durationMs);
        console.log(`[poll] registrada reproducción local: ${lastLocalTrack.id}`);
      }

      if (trackChanged) {
        upsertTrack(data.item);
        console.log(`[poll] reproduciendo: ${data.item.artists[0]?.name} - ${data.item.name}`);
      }

      // trackear si el track actual es local
      lastLocalTrack = data.item.is_local
        ? { id: data.item.id, startedAt: new Date().toISOString(), durationMs: data.item.duration_ms, lastProgressMs: progressMs }
        : null;
    } else if (lastLocalTrack) {
      // actualizar progreso para detección de loop
      lastLocalTrack.lastProgressMs = progressMs;
    }

    updatePollingState({
      lastCurrentlyPlayingTrackId: data.item.id,
      lastCurrentlyPlayingAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[poll] error en currently playing:', err);
  }
}

async function pollRecentlyPlayed() {
  try {
    const state = getPollingState();
    const params: Record<string, string> = {
      limit: String(RECENTLY_PLAYED_LIMIT),
    };

    // usar cursor para obtener solo tracks nuevos
    if (state?.lastRecentlyPlayedCursor) {
      params.after = state.lastRecentlyPlayedCursor;
    }

    const data = await spotifyFetch<SpotifyRecentlyPlayedResponse>(
      '/me/player/recently-played',
      { params },
    );

    if (!data?.items?.length) return;

    let inserted = 0;
    for (const item of data.items) {
      if (insertPlay(item)) inserted++;
    }

    // actualizar cursor para la siguiente poll
    if (data.cursors?.after) {
      updatePollingState({
        lastRecentlyPlayedCursor: data.cursors.after,
        lastPollAt: new Date().toISOString(),
      });
    }

    if (inserted > 0) {
      console.log(`[poll] ${inserted} nuevas reproducciones registradas`);
    }
  } catch (err) {
    console.error('[poll] error en recently played:', err);
  }
}

export function startPolling() {
  const tokens = getStoredTokens();
  if (!tokens) {
    console.log('[poll] sin tokens, polling desactivado. completar OAuth primero');
    return;
  }

  console.log('[poll] iniciando polling...');

  // ejecutar inmediatamente, luego repetir
  pollCurrentlyPlaying();
  pollRecentlyPlayed();
  enrichArtistMetadata().catch(err => console.error('[metadata] error en enriquecimiento:', err));
  enrichLocalAlbumCovers().catch(err => console.error('[metadata] error en portadas locales:', err));

  currentlyPlayingTimer = setInterval(pollCurrentlyPlaying, CURRENTLY_PLAYING_INTERVAL_MS);
  recentlyPlayedTimer = setInterval(pollRecentlyPlayed, RECENTLY_PLAYED_INTERVAL_MS);
  metadataRefreshTimer = setInterval(
    () => {
      enrichArtistMetadata().catch(err => console.error('[metadata] error en enriquecimiento:', err));
      enrichLocalAlbumCovers().catch(err => console.error('[metadata] error en portadas locales:', err));
      // resolver import: IDs junto con metadata (cada 24h, no agresivo)
      resolveImportArtists().catch(err => console.error('[resolve] error resolviendo artistas:', err));
      resolveImportAlbums().catch(err => console.error('[resolve] error resolviendo álbumes:', err));
      fixTrackAlbumAssignments().catch(err => console.error('[resolve] error verificando álbumes:', err));
    },
    METADATA_REFRESH_INTERVAL_MS,
  );

  // verificar artistas de tracks + deduplicar, cada 5 min hasta completar
  fixTrackArtistAssociations()
    .then(() => { deduplicateTracks(); deduplicateAlbums(); })
    .catch(err => console.error('[resolve] error verificando artistas:', err));
  artistFixTimer = setInterval(
    () => fixTrackArtistAssociations()
      .then(() => { deduplicateTracks(); deduplicateAlbums(); })
      .catch(err => console.error('[resolve] error verificando artistas:', err)),
    ARTIST_FIX_INTERVAL_MS,
  );

  console.log(`[poll] currently playing cada ${CURRENTLY_PLAYING_INTERVAL_MS / 1000}s`);
  console.log(`[poll] recently played cada ${RECENTLY_PLAYED_INTERVAL_MS / 1000}s`);
}

export function stopPolling() {
  if (currentlyPlayingTimer) clearInterval(currentlyPlayingTimer);
  if (recentlyPlayedTimer) clearInterval(recentlyPlayedTimer);
  if (metadataRefreshTimer) clearInterval(metadataRefreshTimer);
  if (artistFixTimer) clearInterval(artistFixTimer);
  currentlyPlayingTimer = null;
  recentlyPlayedTimer = null;
  metadataRefreshTimer = null;
  artistFixTimer = null;
  console.log('[poll] polling detenido');
}

// re-iniciar polling (útil después de OAuth)
export function restartPolling() {
  stopPolling();
  startPolling();
}
