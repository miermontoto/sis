// API de ingesta de scrobbles compatible con listenbrainz, montada en /1/* (fuera
// del gate de sesión: autentica por token de scrobbling). implementa el subconjunto
// que usan los clientes push (pano scrobbler, web scrobbler, navidrome, mpv…):
// GET /1/validate-token y POST /1/submit-listens (single | import | playing_now).
// referencia: https://listenbrainz.readthedocs.io/en/latest/users/api/core.html
import { Hono } from 'hono';
import type { Context } from 'hono';
import { importListenEvents, upsertScrobbleTrack, type ListenEvent } from '../services/history-import.js';
import { setExternalNowPlaying } from '../services/lastfm-sync.js';
import { getStoredTokens } from '../services/token-manager.js';
import { getListenToken, regenerateListenToken, revokeListenToken, resolveListenToken } from '../services/listen-tokens.js';
import { LISTENBRAINZ_MAX_LISTENS, LISTENBRAINZ_FUTURE_TOLERANCE_S } from '../constants.js';
import type { AppVariables } from '../app.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('listens');

// --- shapes del protocolo ---

interface LbAdditionalInfo {
  spotify_id?: string;
  isrc?: string;
  recording_mbid?: string;
  artist_mbids?: string[];
  release_mbid?: string;
  duration_ms?: number;
  duration?: number; // segundos (algunos clientes mandan esta en vez de duration_ms)
  submission_client?: string;
  media_player?: string;
}

interface LbListen {
  listened_at?: number; // epoch en segundos; ausente en playing_now
  track_metadata?: {
    track_name?: string;
    artist_name?: string;
    release_name?: string;
    additional_info?: LbAdditionalInfo;
  };
}

interface LbSubmission {
  listen_type?: string;
  payload?: LbListen[];
}

// token en Authorization: Token <x> (formato listenbrainz) o ?token= (legacy)
function requestToken(c: Context): string {
  const header = c.req.header('authorization');
  if (header?.toLowerCase().startsWith('token ')) return header.slice(6).trim();
  return c.req.query('token') ?? '';
}

const SPOTIFY_TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;

// additional_info.spotify_id llega como URL (https://open.spotify.com/track/<id>)
function parseSpotifyTrackId(value: string | undefined): string | null {
  if (!value) return null;
  const id = value.split('?')[0].split('/').filter(Boolean).pop() ?? '';
  return SPOTIFY_TRACK_ID_RE.test(id) ? id : null;
}

// null = listen estructuralmente inválido (faltan track/artist/listened_at)
function toListenEvent(listen: LbListen): ListenEvent | null {
  const meta = listen.track_metadata;
  if (!meta?.track_name || !meta.artist_name || !listen.listened_at) return null;
  const info = meta.additional_info ?? {};
  const durationMs = info.duration_ms ?? (info.duration ? info.duration * 1000 : null);
  return {
    playedAt: new Date(listen.listened_at * 1000).toISOString(),
    trackName: meta.track_name,
    artistName: meta.artist_name,
    albumName: meta.release_name || null,
    spotifyTrackId: parseSpotifyTrackId(info.spotify_id),
    isrc: info.isrc || null,
    trackMbid: info.recording_mbid || null,
    artistMbid: info.artist_mbids?.[0] || null,
    albumMbid: info.release_mbid || null,
    durationMs,
  };
}

const lbError = (c: Context, code: 400 | 401, error: string) => c.json({ code, error }, code);

export const listenbrainzApi = new Hono();

// los clientes validan el token al configurar el servicio. responde 200 con
// valid true/false (igual que listenbrainz: un token malo no es un 401 aquí)
listenbrainzApi.get('/validate-token', (c) => {
  const resolved = resolveListenToken(requestToken(c));
  if (!resolved) return c.json({ code: 200, message: 'Token invalid.', valid: false });
  return c.json({ code: 200, message: 'Token valid.', valid: true, user_name: resolved.userName });
});

listenbrainzApi.post('/submit-listens', async (c) => {
  const resolved = resolveListenToken(requestToken(c), true);
  if (!resolved) return lbError(c, 401, 'Invalid authorization token.');

  let body: LbSubmission;
  try {
    body = await c.req.json<LbSubmission>();
  } catch {
    return lbError(c, 400, 'Invalid JSON document submitted.');
  }

  const { listen_type: listenType, payload } = body;
  if (!Array.isArray(payload) || payload.length === 0) {
    return lbError(c, 400, 'JSON document requires a non-empty payload list.');
  }
  if (payload.length > LISTENBRAINZ_MAX_LISTENS) {
    return lbError(c, 400, `Too many listens in payload (max ${LISTENBRAINZ_MAX_LISTENS}).`);
  }

  if (listenType === 'playing_now') {
    // solo para usuarios sin spotify vinculado: los híbridos ya tienen now-playing
    // vía polling y este escribiría estado en conflicto cada 30s
    const meta = payload[0]?.track_metadata;
    if (!meta?.track_name || !meta.artist_name) {
      return lbError(c, 400, 'playing_now requires track_name and artist_name.');
    }
    if (!getStoredTokens(resolved.userId)) {
      const info = meta.additional_info ?? {};
      const trackId = upsertScrobbleTrack({
        name: meta.track_name,
        mbid: info.recording_mbid,
        artist: { '#text': meta.artist_name, mbid: info.artist_mbids?.[0] },
        album: { '#text': meta.release_name ?? '', mbid: info.release_mbid },
      });
      if (trackId) setExternalNowPlaying(resolved.userId, trackId);
    }
    return c.json({ status: 'ok' });
  }

  if (listenType !== 'single' && listenType !== 'import') {
    return lbError(c, 400, `Unknown listen_type: ${String(listenType)}.`);
  }

  const maxUts = Math.floor(Date.now() / 1000) + LISTENBRAINZ_FUTURE_TOLERANCE_S;
  const events: ListenEvent[] = [];
  for (const [i, listen] of payload.entries()) {
    const event = toListenEvent(listen);
    if (!event) {
      return lbError(c, 400, `Listen ${i}: track_name, artist_name and listened_at are required.`);
    }
    if (listen.listened_at! > maxUts) {
      return lbError(c, 400, `Listen ${i}: listened_at is in the future.`);
    }
    events.push(event);
  }

  const result = importListenEvents(events, resolved.userId, 'listenbrainz');
  const client = payload[0]?.track_metadata?.additional_info?.submission_client;
  log.child(resolved.userId).debug(
    `${result.imported} listens nuevos (${result.duplicates} duplicados)${client ? ` vía ${client}` : ''}`,
  );
  return c.json({ status: 'ok' });
});

// --- gestión del token (rutas con sesión, montadas bajo /api) ---

export const listenTokenRoutes = new Hono<{ Variables: AppVariables }>();

listenTokenRoutes.get('/', (c) => {
  const info = getListenToken(c.get('userId'));
  return c.json({ token: info?.token ?? null, createdAt: info?.createdAt ?? null, lastUsedAt: info?.lastUsedAt ?? null });
});

// generar o regenerar (invalida el token anterior)
listenTokenRoutes.post('/', (c) => {
  const userId = c.get('userId');
  const info = regenerateListenToken(userId);
  log.child(userId).info('token de scrobbling regenerado');
  return c.json(info);
});

listenTokenRoutes.delete('/', (c) => {
  revokeListenToken(c.get('userId'));
  return c.json({ ok: true });
});
