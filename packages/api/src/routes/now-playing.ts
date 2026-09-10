import { Hono } from 'hono';
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { pollingState, tracks, artists, trackArtists, albums } from '../db/schema.js';
import { spotifyFetch, spotifyFetchRaw } from '../services/spotify-client.js';
import { getStoredTokens } from '../services/token-manager.js';
import { triggerCurrentlyPlayingPoll } from '../services/polling.js';
import { hiddenSpotifyIdsSubquery } from '../services/social.js';
import { SOCIAL_NOW_PLAYING_STALE_MS, NOW_PLAYING_STALE_MS, LASTFM_NOW_PLAYING_STALE_MS, HISTORY_TAIL_LIMIT } from '../constants.js';
import type { AppVariables } from '../app.js';
import type { SpotifyDevice, PlayContextRequest, LandedPlay } from '@sis/shared';
import type { SpotifyCurrentlyPlayingResponse } from '../types/spotify.js';

const nowPlaying = new Hono<{ Variables: AppVariables }>();

// Cola del historial: la marca de agua (played_at más reciente) y, si el cliente
// manda la suya en `?since=`, los plays que han aterrizado por encima de ella.
//
// La marca sirve de reloj: el cliente detecta el final de un track al instante,
// pero el play tarda unos segundos en aterrizar (scheduleHistoryFlush repolla
// recently-played en escalera). Releer los agregados antes de que aterrice
// recachearía el estado anterior durante otra hora, así que las vistas esperan
// a ver avanzar esta marca.
//
// La lista es la otra mitad, y es la que hace que el refresco no dependa de que
// el cliente haya VISTO empezar el track: un repeat-one, la app en segundo
// plano, otro dispositivo o un scrobble de last.fm/listenbrainz registran plays
// sin que la tarjeta cambie nunca. El servidor dice qué se registró y las vistas
// releen; el cliente ya no tiene que adivinarlo por observación.
//
// Coste: el índice único (user_id, played_at) hace de la marca un seek al final
// del rango, y del delta un rango indexado que casi siempre trae cero filas —
// gratis en un endpoint que se sondea cada 10s.
function readHistoryTail(userId: number | undefined, since: string | undefined) {
  if (!userId) return { historyWatermark: null, landedPlays: [] as LandedPlay[] };
  const db = getDb();
  const row = db.get(
    sql`SELECT MAX(played_at) AS watermark FROM listening_history WHERE user_id = ${userId}`
  ) as { watermark: string | null } | undefined;
  const watermark = row?.watermark ?? null;

  // sin marca del cliente (primer poll) no hay delta que pedir: esa lectura es
  // su línea base. Las marcas son ISO-8601 UTC del servidor, así que compararlas
  // como texto equivale a compararlas como instantes
  if (!since || !watermark || watermark <= since) {
    return { historyWatermark: watermark, landedPlays: [] as LandedPlay[] };
  }

  const rows = db.all(sql`
    SELECT
      lh.track_id AS trackId,
      lh.played_at AS playedAt,
      COALESCE(lh.duration_played_ms, t.duration_ms, 0) AS playedMs,
      t.album_id AS albumId,
      (SELECT GROUP_CONCAT(ta.artist_id) FROM track_artists ta WHERE ta.track_id = lh.track_id) AS artistIds
    FROM listening_history lh
    LEFT JOIN tracks t ON t.spotify_id = lh.track_id
    WHERE lh.user_id = ${userId} AND lh.played_at > ${since}
    ORDER BY lh.played_at DESC
    LIMIT ${HISTORY_TAIL_LIMIT}
  `) as Array<{ trackId: string; playedAt: string; playedMs: number; albumId: string | null; artistIds: string | null }>;

  // el LIMIT se queda con los más NUEVOS (de ahí el DESC), pero la lista se
  // entrega en orden cronológico, como ocurrieron
  const landedPlays: LandedPlay[] = rows.reverse().map(r => ({
    trackId: r.trackId,
    albumId: r.albumId,
    artistIds: r.artistIds ? r.artistIds.split(',') : [],
    playedAt: r.playedAt,
    playedMs: r.playedMs,
  }));
  return { historyWatermark: watermark, landedPlays };
}

// retorna el track actual desde polling_state (sin llamada a spotify)
nowPlaying.get('/', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const state = userId
    ? db.select().from(pollingState).where(eq(pollingState.userId, userId)).get()
    : null;
  const tail = readHistoryTail(userId, c.req.query('since'));

  if (!state?.lastCurrentlyPlayingTrackId) {
    return c.json({ playing: false, isPlaying: false, ...tail });
  }

  // usuarios solo-last.fm (sin token de spotify) no pueden controlar la
  // reproducción (tarjeta read-only) y su estado solo se refresca cada
  // LASTFM_POLL_INTERVAL_MS, así que la ventana de frescura es más amplia
  const controllable = userId ? !!getStoredTokens(userId) : false;
  const staleThresholdMs = controllable ? NOW_PLAYING_STALE_MS : LASTFM_NOW_PLAYING_STALE_MS;
  if (state.lastCurrentlyPlayingAt) {
    const lastUpdate = new Date(state.lastCurrentlyPlayingAt).getTime();
    if (Date.now() - lastUpdate > staleThresholdMs) {
      return c.json({ playing: false, isPlaying: false, ...tail });
    }
  }

  const track = db.select().from(tracks).where(eq(tracks.spotifyId, state.lastCurrentlyPlayingTrackId)).get();
  if (!track) return c.json({ playing: false, isPlaying: false, ...tail });

  const album = track.albumId
    ? db.select().from(albums).where(eq(albums.spotifyId, track.albumId)).get()
    : null;

  const trackArtistRows = db
    .select({ artistId: trackArtists.artistId, position: trackArtists.position })
    .from(trackArtists)
    .where(eq(trackArtists.trackId, track.spotifyId))
    .all();

  const sortedArtistIds = trackArtistRows
    .sort((a, b) => a.position - b.position)
    .map(ta => ta.artistId);
  const artistMap = new Map(
    db.select().from(artists).where(inArray(artists.spotifyId, sortedArtistIds)).all()
      .map(a => [a.spotifyId, a])
  );
  const artistList = sortedArtistIds.map(id => artistMap.get(id)).filter(Boolean);

  const isPlayingRow = db.get(sql`SELECT is_playing, progress_ms FROM polling_state WHERE user_id = ${userId}`) as { is_playing: number; progress_ms: number | null } | undefined;

  return c.json({
    playing: true,
    isPlaying: !!(isPlayingRow?.is_playing),
    controllable,
    progressMs: isPlayingRow?.progress_ms ?? null,
    track: {
      id: track.spotifyId,
      name: track.name,
      durationMs: track.durationMs,
      album: album ? { id: album.spotifyId, name: album.name, imageUrl: album.imageUrl } : null,
      artists: artistList.map(a => ({ id: a!.spotifyId, name: a!.name })),
    },
    updatedAt: state.lastCurrentlyPlayingAt,
    ...tail,
  });
});

nowPlaying.get('/friends', (c) => {
  const userId = c.get('userId');
  const db = getDb();
  // frescura por fuente: los amigos solo-last.fm (sin auth_tokens) se refrescan
  // cada LASTFM_POLL_INTERVAL_MS, así que su ventana es más amplia que la de
  // spotify para que no parpadeen entre ticks
  const spotifyStale = new Date(Date.now() - SOCIAL_NOW_PLAYING_STALE_MS).toISOString();
  const lastfmStale = new Date(Date.now() - LASTFM_NOW_PLAYING_STALE_MS).toISOString();

  const rows = db.all(sql`
    SELECT
      u.spotify_id AS spotifyId,
      u.display_name AS displayName,
      u.image_url AS imageUrl,
      ps.is_playing AS isPlaying,
      ps.last_currently_playing_at AS updatedAt,
      t.name AS trackName,
      a.image_url AS albumImageUrl,
      (SELECT GROUP_CONCAT(a2.name, ', ')
       FROM track_artists ta2
       JOIN artists a2 ON a2.spotify_id = ta2.artist_id
       WHERE ta2.track_id = t.spotify_id
       ORDER BY ta2.position) AS artistNames
    FROM follows f
    INNER JOIN users u ON u.id = f.followed_id
    INNER JOIN polling_state ps ON ps.user_id = u.id
    LEFT JOIN auth_tokens tok ON tok.user_id = u.id
    LEFT JOIN tracks t ON t.spotify_id = ps.last_currently_playing_track_id
      AND ps.last_currently_playing_at > (CASE WHEN tok.user_id IS NULL THEN ${lastfmStale} ELSE ${spotifyStale} END)
    LEFT JOIN albums a ON a.spotify_id = t.album_id
    WHERE f.follower_id = ${userId}
      AND u.is_active = 1
      AND u.spotify_id NOT IN (${hiddenSpotifyIdsSubquery()})
    ORDER BY ps.is_playing DESC, ps.last_currently_playing_at DESC
  `) as any[];

  return c.json(rows.map((r) => ({
    spotifyId: r.spotifyId,
    displayName: r.displayName,
    imageUrl: r.imageUrl,
    isPlaying: !!(r.isPlaying && r.trackName),
    track: r.trackName ? {
      name: r.trackName,
      artists: r.artistNames || '',
      albumImageUrl: r.albumImageUrl,
    } : null,
    updatedAt: r.updatedAt,
  })));
});

// lectura en vivo desde Spotify (no cache) — usado tras acciones de playback
nowPlaying.get('/live', async (c) => {
  const userId = c.get('userId');
  const data = await spotifyFetch<SpotifyCurrentlyPlayingResponse>('/me/player/currently-playing', { userId });

  const tail = readHistoryTail(userId, c.req.query('since'));
  if (!data?.item || data.currently_playing_type !== 'track') {
    return c.json({ playing: false, isPlaying: false, ...tail });
  }

  const item = data.item;
  return c.json({
    playing: true,
    isPlaying: !!data.is_playing,
    progressMs: data.progress_ms ?? null,
    volumePercent: data.device?.volume_percent ?? null,
    track: {
      id: item.id,
      name: item.name,
      durationMs: item.duration_ms,
      album: item.album ? {
        id: item.album.id,
        name: item.album.name,
        imageUrl: item.album.images?.[0]?.url ?? null,
      } : null,
      artists: (item.artists ?? []).map((a) => ({ id: a.id, name: a.name })),
    },
    updatedAt: new Date().toISOString(),
    ...tail,
  });
});

// --- controles de reproducción ---

nowPlaying.put('/play', async (c) => {
  const userId = c.get('userId');
  await spotifyFetch('/me/player/play', { userId, method: 'PUT' });
  const db = getDb();
  db.run(sql`UPDATE polling_state SET is_playing = 1 WHERE user_id = ${userId}`);
  triggerCurrentlyPlayingPoll(userId);
  return c.json({ success: true });
});

nowPlaying.put('/pause', async (c) => {
  const userId = c.get('userId');
  await spotifyFetch('/me/player/pause', { userId, method: 'PUT' });
  const db = getDb();
  db.run(sql`UPDATE polling_state SET is_playing = 0 WHERE user_id = ${userId}`);
  triggerCurrentlyPlayingPoll(userId);
  return c.json({ success: true });
});

nowPlaying.post('/next', async (c) => {
  const userId = c.get('userId');
  await spotifyFetch('/me/player/next', { userId, method: 'POST' });
  triggerCurrentlyPlayingPoll(userId);
  return c.json({ success: true });
});

nowPlaying.post('/previous', async (c) => {
  const userId = c.get('userId');
  await spotifyFetch('/me/player/previous', { userId, method: 'POST' });
  triggerCurrentlyPlayingPoll(userId);
  return c.json({ success: true });
});

// --- reproducir contenido específico (track/album/artist) ---

nowPlaying.put('/play-context', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<PlayContextRequest>();

  const spotifyBody: Record<string, unknown> = {};
  if (body.context_uri) spotifyBody.context_uri = body.context_uri;
  if (body.uris) spotifyBody.uris = body.uris;

  const endpoint = body.device_id
    ? `/me/player/play?device_id=${body.device_id}`
    : '/me/player/play';

  const res = await spotifyFetchRaw(endpoint, {
    userId,
    method: 'PUT',
    body: Object.keys(spotifyBody).length > 0 ? spotifyBody : undefined,
  });

  if (!res) return c.json({ success: false, error: 'rate_limited' });

  if (res.status === 404) {
    const text = await res.text();
    if (text.includes('NO_ACTIVE_DEVICE')) {
      return c.json({ success: false, error: 'no_active_device' });
    }
    return c.json({ success: false, error: 'not_found' });
  }

  if (res.status === 204 || res.ok) {
    const db = getDb();
    db.run(sql`UPDATE polling_state SET is_playing = 1 WHERE user_id = ${userId}`);
    triggerCurrentlyPlayingPoll(userId);
    return c.json({ success: true });
  }

  return c.json({ success: false, error: 'spotify_error' });
});

// --- seek ---

nowPlaying.put('/seek', async (c) => {
  const userId = c.get('userId');
  const { position_ms } = await c.req.json<{ position_ms: number }>();
  const clamped = Math.max(0, Math.round(position_ms));

  const res = await spotifyFetchRaw(`/me/player/seek?position_ms=${clamped}`, {
    userId,
    method: 'PUT',
  });

  if (!res) return c.json({ success: false, error: 'rate_limited' }, 429);

  if (res.status === 404) {
    const text = await res.text();
    if (text.includes('NO_ACTIVE_DEVICE')) {
      return c.json({ success: false, error: 'no_active_device' });
    }
    return c.json({ success: false, error: 'not_found' });
  }

  if (res.status === 204 || res.ok) {
    // reflejar el seek en polling_state: sin esto, las lecturas cacheadas
    // retrocederían la barra hasta el siguiente poll de currently-playing
    const db = getDb();
    db.run(sql`UPDATE polling_state SET progress_ms = ${clamped}, last_currently_playing_at = ${new Date().toISOString()} WHERE user_id = ${userId}`);
    // el timer del ciclo se calculó con el progreso anterior: sin re-poll, un
    // seek hacia el final del track deja el cambio sin detectar hasta 60s
    triggerCurrentlyPlayingPoll(userId);
    return c.json({ success: true, position_ms: clamped });
  }

  return c.json({ success: false, error: 'spotify_error' });
});

// --- volumen ---

nowPlaying.put('/volume', async (c) => {
  const userId = c.get('userId');
  const { volume_percent } = await c.req.json<{ volume_percent: number }>();
  const clamped = Math.max(0, Math.min(100, Math.round(volume_percent)));
  await spotifyFetchRaw(`/me/player/volume?volume_percent=${clamped}`, {
    userId,
    method: 'PUT',
  });
  return c.json({ success: true, volume_percent: clamped });
});

// --- dispositivos Spotify Connect ---

nowPlaying.get('/devices', async (c) => {
  const userId = c.get('userId');
  const data = await spotifyFetch<{ devices: SpotifyDevice[] }>('/me/player/devices', { userId });
  return c.json({ devices: data?.devices ?? [] });
});

nowPlaying.put('/device', async (c) => {
  const userId = c.get('userId');
  const { device_id, play } = await c.req.json<{ device_id: string; play?: boolean }>();
  await spotifyFetch('/me/player', {
    userId,
    method: 'PUT',
    body: { device_ids: [device_id], play: play ?? true },
  });
  triggerCurrentlyPlayingPoll(userId);
  return c.json({ success: true });
});

// --- liked songs (Spotify library) ---

nowPlaying.get('/like/:trackId', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('trackId');
  const data = await spotifyFetch<boolean[]>('/me/tracks/contains', {
    userId,
    params: { ids: trackId },
  });
  return c.json({ isLiked: data?.[0] ?? false });
});

nowPlaying.put('/like/:trackId', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('trackId');
  const res = await spotifyFetchRaw('/me/tracks', {
    userId,
    method: 'PUT',
    body: { ids: [trackId] },
  });
  if (!res) return c.json({ success: false, error: 'rate_limited' }, 429);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return c.json({ success: false, error: 'spotify_rejected', status: res.status, detail }, res.status as 400);
  }
  return c.json({ success: true });
});

nowPlaying.delete('/like/:trackId', async (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('trackId');
  const res = await spotifyFetchRaw('/me/tracks', {
    userId,
    method: 'DELETE',
    body: { ids: [trackId] },
  });
  if (!res) return c.json({ success: false, error: 'rate_limited' }, 429);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return c.json({ success: false, error: 'spotify_rejected', status: res.status, detail }, res.status as 400);
  }
  return c.json({ success: true });
});

// --- playlist presence ---

nowPlaying.get('/playlists/:trackId', (c) => {
  const userId = c.get('userId');
  const trackId = c.req.param('trackId');
  const db = getDb();
  const rows = db.all(sql`
    SELECT sp.id, sp.spotify_id as spotifyId, sp.name, sp.image_url as imageUrl
    FROM spotify_playlist_tracks spt
    JOIN spotify_playlists sp ON sp.id = spt.playlist_id AND sp.user_id = ${userId}
    WHERE spt.track_id = ${trackId}
    ORDER BY sp.name ASC
  `) as Array<{ id: number; spotifyId: string; name: string; imageUrl: string | null }>;
  return c.json({ playlists: rows });
});

// --- add to queue ---

nowPlaying.post('/queue', async (c) => {
  const userId = c.get('userId');
  const { uri } = await c.req.json<{ uri: string }>();

  if (!uri?.startsWith('spotify:')) {
    return c.json({ success: false, error: 'invalid_uri' }, 400);
  }

  const res = await spotifyFetchRaw('/me/player/queue', {
    userId,
    method: 'POST',
    params: { uri },
  });

  if (!res) return c.json({ success: false, error: 'rate_limited' }, 429);

  if (res.status === 404) {
    const text = await res.text();
    if (text.includes('NO_ACTIVE_DEVICE')) {
      return c.json({ success: false, error: 'no_active_device' });
    }
    return c.json({ success: false, error: 'not_found' });
  }

  if (res.status === 204 || res.ok) {
    return c.json({ success: true });
  }

  return c.json({ success: false, error: 'spotify_error' });
});

export default nowPlaying;
