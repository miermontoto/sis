// álbumes anunciados que aún no han salido: sus singles de adelanto rankean como el álbum
// que viene en vez de cada uno por su lado (complemento del plegado de singles, que sólo
// actúa cuando el álbum ya está en la biblioteca: ver single-fold.ts).
//
// Spotify enseña un álbum futuro por id (`GET /albums/{id}`: fecha, portada y los temas
// ya publicados con el id EXACTO de sus singles) pero nunca lo lista — ni en la
// discografía del artista ni en la búsqueda, ni por upc ni por isrc —. Así que el álbum se
// descubre por tres vías, y las dos primeras dan el id de spotify:
//   - un enlace que pega el usuario (POST /api/upcoming);
//   - el contexto de un play que sonó desde la página del álbum (raro: uno en prod);
//   - las preventas de iTunes, que traen el tracklist entero con nombres y duraciones
//     (los temas sin publicar spotify los enmascara como "Track N" de 0 ms). De iTunes
//     sólo se usan nombres, fechas y duraciones: su API es para promocionar su tienda,
//     así que ni portadas ni previews.
//
// Antes de salir, el álbum es una COLECCIÓN por usuario con sus singles dentro: la capa de
// colecciones ya los sustituye en todos los rankings y le da página. Al salir, el álbum
// real entra en la biblioteca, la colección se disuelve y el plegado de siempre mete los
// singles en él, con todo su historial (los merges se resuelven al consultar).
import { sql } from 'drizzle-orm';
import { collectionKey, itunesPreorders, itunesTracks, normalizeTitle, parseSpotifyAlbumId, type UpcomingLinkResult, type UpcomingTrack } from '@sis/shared';
import { getDb } from '../db/connection.js';
import { dbReadBackground } from '../db/read-pool.js';
import { addCollectionMember, canonicalMemberId, createCollection, deleteCollection, findMemberCollection, getCollectionRow } from '../db/queries/collections.js';
import type { UpcomingFoldPlan } from '../db/queries/upcoming.js';
import { invalidateDerived } from '../routes/collections.js';
import { spotifyFetch } from './spotify-client.js';
import { ensureFullAlbumTracks } from './ingestion/enrichment.js';
import { pickAlbumCover, upsertTrack } from './ingestion/upsert.js';
import { enabledUserIds, foldSinglesIfEnabled } from './single-fold.js';
import { getStoredTokens } from './token-manager.js';
import { getAllActiveUsersWithTokens } from './user-manager.js';
import { serviceUserAgent } from './public-origin.js';
import { createLogger } from './logger.js';
import {
  ITUNES_API_BASE, ITUNES_COUNTRY, ITUNES_REQUEST_GAP_MS, ITUNES_SEARCH_LIMIT,
  UPCOMING_ARTIST_RECHECK_MS, UPCOMING_CONTEXT_LOOKBACK_MS, UPCOMING_CONTEXT_MAX_PER_SWEEP,
  UPCOMING_ITUNES_ARTISTS_PER_SWEEP, UPCOMING_RELEASE_MATCH_DAYS, UPCOMING_RESOLVE_GRACE_MS,
  UPCOMING_SINGLE_LOOKBACK_MS, UPCOMING_SWEEP_INTERVAL_MS,
} from '../constants.js';
import type { SpotifyAlbum, SpotifyAlbumTracksResponse, SpotifyTrack } from '../types/spotify.js';

const log = createLogger('upcoming');

type Db = ReturnType<typeof getDb>;

const DAY_MS = 24 * 60 * 60_000;

// `/albums/{id}` completo: con market, los temas ya publicados vienen relinkados al id del
// single (`linked_from` es el del propio álbum) y los demás, `is_playable: false`
interface SpotifyFullAlbum extends SpotifyAlbum {
  tracks: { items: (SpotifyAlbumTracksResponse['items'][number] & { is_playable?: boolean })[] };
}

interface UpcomingInput {
  artistId: string;
  name: string;
  releaseDate: string;
  spotifyAlbumId?: string;
  itunesCollectionId?: string;
  imageUrl?: string | null;
  tracks: UpcomingTrack[];
}

interface UpcomingRow {
  id: number; artist_id: string; name: string; name_key: string; release_date: string;
  spotify_album_id: string | null; itunes_collection_id: string | null; image_url: string | null; tracks: string;
}

const today = () => new Date().toISOString().slice(0, 10);
// una fecha parcial ('2027', '2026-12') compara bien como texto contra la de hoy
const isFuture = (date: string) => date > today();

// el tracklist es catálogo: vale el token de cualquiera si el usuario no tiene (cuentas
// sólo last.fm), igual que en el plegado de singles
const tokenUserFor = (userId: number): number | null =>
  getStoredTokens(userId) ? userId : getAllActiveUsersWithTokens()[0]?.userId ?? null;

// --- catálogo de álbumes que vienen ---

// un mismo tema de las dos fuentes es uno: gana la entrada de spotify, que trae el id
const mergeTracks = (current: UpcomingTrack[], incoming: UpcomingTrack[]): UpcomingTrack[] => {
  const byName = new Map(current.map(t => [normalizeTitle(t.name), t]));
  incoming.forEach(t => {
    const key = normalizeTitle(t.name);
    const prev = byName.get(key);
    byName.set(key, prev && !t.trackId ? { ...t, trackId: prev.trackId } : t);
  });
  return [...byName.values()];
};

/** Alta o fusión por (artista, nombre): el enlace y la preventa del mismo disco son una
 *  fila. La fecha de spotify manda sobre la de iTunes (la de iTunes es la de su tienda). */
function upsertUpcoming(db: Db, u: UpcomingInput): number {
  const nameKey = normalizeTitle(u.name);
  const prev = db.get(sql`
    SELECT * FROM upcoming_albums WHERE artist_id = ${u.artistId} AND name_key = ${nameKey}
  `) as UpcomingRow | undefined;
  const spotifySource = !!u.spotifyAlbumId;

  if (!prev) {
    return (db.get(sql`
      INSERT INTO upcoming_albums (artist_id, name, name_key, release_date, spotify_album_id, itunes_collection_id, image_url, tracks)
      VALUES (${u.artistId}, ${u.name}, ${nameKey}, ${u.releaseDate}, ${u.spotifyAlbumId ?? null}, ${u.itunesCollectionId ?? null},
              ${u.imageUrl ?? null}, ${JSON.stringify(u.tracks)})
      RETURNING id
    `) as { id: number }).id;
  }

  const releaseDate = spotifySource || !prev.spotify_album_id ? u.releaseDate : prev.release_date;
  db.run(sql`
    UPDATE upcoming_albums SET
      name = ${spotifySource ? u.name : prev.name},
      release_date = ${releaseDate},
      spotify_album_id = ${u.spotifyAlbumId ?? prev.spotify_album_id},
      itunes_collection_id = ${u.itunesCollectionId ?? prev.itunes_collection_id},
      image_url = ${u.imageUrl ?? prev.image_url},
      tracks = ${JSON.stringify(mergeTracks(JSON.parse(prev.tracks) as UpcomingTrack[], u.tracks))},
      state = 'upcoming',
      updated_at = datetime('now')
    WHERE id = ${prev.id}
  `);
  return prev.id;
}

async function fetchSpotifyAlbum(albumId: string, userId: number): Promise<SpotifyFullAlbum | null> {
  return spotifyFetch<SpotifyFullAlbum>(`/albums/${albumId}`, { userId, params: { market: 'from_token' } });
}

// sólo los temas ya publicados: los demás llegan enmascarados ("Track 4", 0 ms) y un
// nombre así casaría con cualquier cosa
const fromSpotify = (a: SpotifyFullAlbum): UpcomingInput | null => a.artists[0]?.id ? {
  artistId: a.artists[0].id,
  name: a.name,
  releaseDate: a.release_date,
  spotifyAlbumId: a.id,
  imageUrl: pickAlbumCover(a.images),
  tracks: a.tracks.items.filter(t => t.is_playable && t.duration_ms > 0).map(t => ({ name: t.name, durationMs: t.duration_ms, trackId: t.id })),
} : null;

// --- iTunes ---

let lastItunesAt = 0;

/** Una llamada a iTunes respetando su límite (~20/min por IP). null = no respondió: quien
 *  llama corta la pasada sin sellar nada, y la próxima reintenta. */
async function itunesGet(path: string, params: Record<string, string>): Promise<unknown[] | null> {
  const wait = lastItunesAt + ITUNES_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastItunesAt = Date.now();

  const url = `${ITUNES_API_BASE}${path}?${new URLSearchParams({ ...params, country: ITUNES_COUNTRY })}`;
  const res = await fetch(url, { headers: { 'User-Agent': serviceUserAgent(), Accept: 'application/json' } }).catch(() => null);
  if (!res?.ok) {
    log.warn(`itunes ${path}: ${res?.status ?? 'sin respuesta'}`);
    return null;
  }
  return ((await res.json()) as { results?: unknown[] }).results ?? [];
}

async function discoverFromItunes(userIds: number[]): Promise<void> {
  const since = new Date(Date.now() - UPCOMING_SINGLE_LOOKBACK_MS).toISOString().slice(0, 10);
  const recheckBefore = new Date(Date.now() - UPCOMING_ARTIST_RECHECK_MS).toISOString();
  const artists = await dbReadBackground('upcoming', 'upcomingCandidateArtists', userIds, since, recheckBefore, UPCOMING_ITUNES_ARTISTS_PER_SWEEP);
  const db = getDb();

  for (const artist of artists) {
    const found = await itunesGet('/search', { term: artist.name, media: 'music', entity: 'album', attribute: 'artistTerm', limit: String(ITUNES_SEARCH_LIMIT) });
    if (found === null) return;
    for (const p of itunesPreorders(found, artist.name, today())) {
      const songs = await itunesGet('/lookup', { id: p.collectionId, entity: 'song' });
      if (songs === null) return;
      const tracks = itunesTracks(songs);
      if (tracks.length === 0) continue;
      upsertUpcoming(db, { artistId: artist.id, name: p.name, releaseDate: p.releaseDate, itunesCollectionId: p.collectionId, tracks });
      log.info(`preventa: "${p.name}" de ${artist.name} (${p.releaseDate}, ${tracks.length} temas)`);
    }
    db.run(sql`
      INSERT INTO upcoming_artist_checks (artist_id, checked_at) VALUES (${artist.id}, ${new Date().toISOString()})
      ON CONFLICT (artist_id) DO UPDATE SET checked_at = excluded.checked_at
    `);
  }
}

// --- contexto de los plays ---

async function discoverFromContext(userIds: number[]): Promise<void> {
  const since = new Date(Date.now() - UPCOMING_CONTEXT_LOOKBACK_MS).toISOString();
  const candidates = await dbReadBackground('upcoming', 'upcomingContextCandidates', userIds, since, UPCOMING_CONTEXT_MAX_PER_SWEEP);
  // en serie a propósito: son llamadas a spotify y comparten su rate limit
  for (const { albumId, userId } of candidates) {
    const tokenUser = tokenUserFor(userId);
    if (tokenUser === null) return;
    const album = await fetchSpotifyAlbum(albumId, tokenUser);
    const input = album && isFuture(album.release_date) ? fromSpotify(album) : null;
    if (!input) continue;
    upsertUpcoming(getDb(), input);
    log.info(`contexto: "${input.name}" (${input.releaseDate}) sonó desde su página antes de salir`);
  }
}

// --- colecciones por usuario ---

/** La portada de spotify del álbum que viene: entra en el pool del ImagePicker y pasa a
 *  ser la activa si la que había era la heredada de un miembro (un single). Una que el
 *  usuario eligió o subió se queda. iTunes no aporta portadas: ver la cabecera. */
function adoptCover(db: Db, collectionId: number, imageUrl: string): void {
  const key = collectionKey(collectionId);
  db.run(sql`INSERT OR IGNORE INTO album_covers (album_id, image_url, source) VALUES (${key}, ${imageUrl}, 'spotify')`);
  db.run(sql`
    UPDATE albums SET image_url = ${imageUrl}
    WHERE spotify_id = ${key} AND (image_url IS NULL OR image_url IN (
      SELECT a.image_url FROM album_collection_members m JOIN albums a ON a.spotify_id = m.member_id
      WHERE m.collection_id = ${collectionId} AND m.member_type = 'album'))
  `);
}

/** El plan se armó en otro hilo: lo que el usuario haya tocado entretanto manda (un
 *  single que metió en otra colección, una colección que borró). */
function applyPlan(db: Db, userId: number, p: UpcomingFoldPlan): number {
  const fold = db.get(sql`
    SELECT collection_id FROM upcoming_folds WHERE user_id = ${userId} AND upcoming_id = ${p.upcomingId}
  `) as { collection_id: number | null } | undefined;
  if (fold && (fold.collection_id === null || !getCollectionRow(db, fold.collection_id, userId))) return 0;

  const singles = p.singleIds.filter(id => canonicalMemberId(db, 'album', id, userId) === id && !findMemberCollection(db, 'album', id, userId));
  if (singles.length === 0) return 0;

  const collectionId = fold?.collection_id ?? createCollection(db, userId, p.artistId, p.name, null);
  if (!fold) db.run(sql`INSERT INTO upcoming_folds (user_id, upcoming_id, collection_id) VALUES (${userId}, ${p.upcomingId}, ${collectionId})`);
  // sin portada de spotify, addCollectionMember hereda la del primer single
  singles.forEach(id => addCollectionMember(db, collectionId, userId, 'album', id));
  if (p.imageUrl) adoptCover(db, collectionId, p.imageUrl);
  log.child(userId).info(`${singles.length} singles plegados en "${p.name}" (aún sin salir)`);
  return singles.length;
}

const inFlight = new Map<number, Promise<number>>();

/** Mete en la colección de cada álbum que viene los singles de este usuario que van
 *  dentro. No mira el ajuste: el barrido sólo lo llama para quien lo tiene activo, y un
 *  enlace pegado a mano ya es la decisión del usuario. Devuelve los singles añadidos. */
export function applyUpcomingFolds(userId: number): Promise<number> {
  const running = inFlight.get(userId);
  if (running) return running;
  const run = (async () => {
    const plans = await dbReadBackground(`upcoming:${userId}`, 'planUpcomingFolds', userId);
    if (plans.length === 0) return 0;
    const db = getDb();
    const added = db.transaction(() => plans.reduce((n, p) => n + applyPlan(db, userId, p), 0));
    if (added > 0) invalidateDerived(userId);
    return added;
  })().finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

// --- salida ---

/** El álbum real en la discografía del artista, una vez publicado: mismo nombre y fecha
 *  a pocos días (la de iTunes es la de su tienda). */
async function findReleasedAlbum(u: UpcomingRow, userId: number): Promise<string | null> {
  const res = await spotifyFetch<{ items: SpotifyAlbum[] }>(`/artists/${u.artist_id}/albums`, {
    userId, params: { include_groups: 'album', limit: '10' },
  });
  const target = Date.parse(u.release_date);
  return res?.items.find(a => normalizeTitle(a.name) === u.name_key
    && Math.abs(Date.parse(a.release_date) - target) <= UPCOMING_RELEASE_MATCH_DAYS * DAY_MS)?.id ?? null;
}

/** Fila del álbum y tracklist entero. Se pide sin market: sin relinking, los ids son
 *  los del álbum y no los de sus singles (que no deben cambiar de álbum). */
async function ingestAlbum(album: SpotifyFullAlbum, userId: number): Promise<boolean> {
  const first = album.tracks?.items[0];
  if (!first) return false;
  upsertTrack({ ...first, album, popularity: 0 } as SpotifyTrack);
  await ensureFullAlbumTracks(album.id, album.total_tracks, userId, { force: true });
  return true;
}

/** Disuelve las colecciones del álbum que salió y deja al plegado de siempre meter sus
 *  singles en el álbum real (ya en la biblioteca). */
function dissolve(db: Db, u: UpcomingRow, albumId: string): number[] {
  const folds = db.all(sql`
    SELECT user_id, collection_id FROM upcoming_folds WHERE upcoming_id = ${u.id} AND collection_id IS NOT NULL
  `) as { user_id: number; collection_id: number }[];
  db.transaction(() => {
    folds.filter(f => getCollectionRow(db, f.collection_id, f.user_id)).forEach(f => deleteCollection(db, f.collection_id, f.user_id));
    db.run(sql`UPDATE upcoming_folds SET collection_id = NULL WHERE upcoming_id = ${u.id}`);
    db.run(sql`UPDATE upcoming_albums SET state = 'released', spotify_album_id = ${albumId}, updated_at = datetime('now') WHERE id = ${u.id}`);
  });
  return folds.map(f => f.user_id);
}

async function settleReleased(tokenUser: number): Promise<void> {
  const db = getDb();
  const due = db.all(sql`SELECT * FROM upcoming_albums WHERE state = 'upcoming' AND release_date <= ${today()}`) as UpcomingRow[];
  for (const u of due) {
    // sin colecciones vivas no hay nada que disolver, ni motivo para meter el disco en la
    // biblioteca de nadie: el plegado de siempre lo hará cuando alguien lo escuche
    const live = db.get(sql`SELECT 1 AS ok FROM upcoming_folds WHERE upcoming_id = ${u.id} AND collection_id IS NOT NULL`);
    if (!live) {
      db.run(sql`UPDATE upcoming_albums SET state = 'released', updated_at = datetime('now') WHERE id = ${u.id}`);
      continue;
    }
    const albumId = u.spotify_album_id ?? await findReleasedAlbum(u, tokenUser);
    const album = albumId ? await spotifyFetch<SpotifyFullAlbum>(`/albums/${albumId}`, { userId: tokenUser }) : null;
    if (album && isFuture(album.release_date)) {
      // se retrasó: la colección sigue hasta la fecha nueva
      db.run(sql`UPDATE upcoming_albums SET release_date = ${album.release_date}, updated_at = datetime('now') WHERE id = ${u.id}`);
      continue;
    }
    if (album && albumId && await ingestAlbum(album, tokenUser)) {
      const users = dissolve(db, u, albumId);
      log.info(`"${u.name}" ya salió: ${users.length} colecciones disueltas en el álbum real`);
      for (const userId of users) {
        invalidateDerived(userId);
        await foldSinglesIfEnabled(userId).catch(err => log.child(userId).error('plegado tras la salida:', err));
      }
    } else if (Date.now() - Date.parse(u.release_date) > UPCOMING_RESOLVE_GRACE_MS) {
      // no apareció: la colección se queda como una colección normal
      db.run(sql`UPDATE upcoming_albums SET state = 'gone', updated_at = datetime('now') WHERE id = ${u.id}`);
      log.warn(`"${u.name}" no apareció en spotify tras salir: su colección se queda como está`);
    }
  }
}

// --- barrido ---

let sweeping: Promise<void> | null = null;
let lastSweepAt = 0;

async function runSweep(): Promise<void> {
  lastSweepAt = Date.now();
  const userIds = enabledUserIds();
  if (userIds.length === 0) return;
  await discoverFromContext(userIds);
  await discoverFromItunes(userIds);
  const tokenUser = getAllActiveUsersWithTokens()[0]?.userId;
  if (tokenUser !== undefined) await settleReleased(tokenUser);
  for (const userId of userIds) {
    await applyUpcomingFolds(userId).catch(err => log.child(userId).error('error:', err));
  }
}

/** Tick del polling: fuentes, salidas y plegado de todos los usuarios con el ajuste. */
export function sweepUpcoming(): Promise<void> {
  sweeping ??= runSweep().finally(() => { sweeping = null; });
  return sweeping;
}

/** Arranque diferido de cada usuario: sólo la primera tras un deploy, que reinicia el
 *  timer; el resto de usuarios que arrancan detrás no repiten la pasada global. */
export function sweepUpcomingIfDue(): Promise<void> {
  return Date.now() - lastSweepAt < UPCOMING_SWEEP_INTERVAL_MS ? sweeping ?? Promise.resolve() : sweepUpcoming();
}

// --- enlace manual ---

type LinkOutcome = { result: UpcomingLinkResult } | { error: string; status: 400 | 404 | 409 };

/** `POST /api/upcoming`: el usuario pega el enlace de un álbum que aún no ha salido. */
export async function linkUpcomingAlbum(userId: number, input: string): Promise<LinkOutcome> {
  const albumId = parseSpotifyAlbumId(input);
  if (!albumId) return { error: 'not a Spotify album link', status: 400 };
  const tokenUser = tokenUserFor(userId);
  const album = tokenUser === null ? null : await fetchSpotifyAlbum(albumId, tokenUser);
  if (!album) return { error: "couldn't read that album from Spotify", status: 404 };
  const parsed = fromSpotify(album);
  if (!parsed) return { error: "couldn't read that album from Spotify", status: 404 };
  if (!isFuture(album.release_date)) return { error: 'already released: its singles fold into it on their own once you play it', status: 409 };

  const db = getDb();
  const upcomingId = upsertUpcoming(db, parsed);
  await applyUpcomingFolds(userId);

  const fold = db.get(sql`
    SELECT uf.collection_id AS collectionId, (SELECT COUNT(*) FROM album_collection_members m WHERE m.collection_id = uf.collection_id) AS singles
    FROM upcoming_folds uf WHERE uf.user_id = ${userId} AND uf.upcoming_id = ${upcomingId}
  `) as { collectionId: number | null; singles: number } | undefined;
  // la colección pudo nacer antes por la preventa de iTunes, con la portada de un single
  if (fold?.collectionId && parsed.imageUrl) adoptCover(db, fold.collectionId, parsed.imageUrl);
  return {
    result: {
      upcomingId, name: parsed.name, releaseDate: parsed.releaseDate,
      collectionId: fold?.collectionId ?? null, singles: fold?.singles ?? 0,
    },
  };
}
