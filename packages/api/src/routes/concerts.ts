// Registro de conciertos asistidos. Anotación por usuario sobre un artista: la
// lectura resuelve el grupo de merge entero (un bolo dado de alta sobre un alias
// debe verse desde el artista canónico y al revés), la escritura aterriza en el
// id visitado — mismo contrato que las valoraciones de álbum.
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppVariables } from '../app.js';
import { getDb } from '../db/connection.js';
import { getEntityMergeGroup } from '../db/queries/merge.js';
import { dbRead } from '../db/read-pool.js';
import { hydrateConcerts, resolveSetlistSongs } from '../services/concerts.js';
import { isSetlistfmConfigured, searchArtistShows, getShow, resolveAcceptedArtists } from '../services/setlistfm-client.js';
import { createLogger } from '../services/logger.js';
import { invalidateRecordsCacheForUser } from '../services/records-cache.js';
import { refreshConcertCounts } from '../services/social.js';
import { CONCERT_TEXT_MAX_CHARS, CONCERT_NOTES_MAX_CHARS } from '@sis/shared';
import type { ConcertStats, SetlistfmShow } from '@sis/shared';

const concerts = new Hono<{ Variables: AppVariables }>();
const log = createLogger('concerts');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// El UNIQUE (user, artista, fecha) es la defensa contra registrar dos veces el
// mismo bolo, así que hay que distinguirlo de un fallo real. Drizzle envuelve el
// error de better-sqlite3 en uno propio ("Failed to run the query '...'"), de
// modo que el código SQLITE_CONSTRAINT_UNIQUE sólo aparece en la cadena de
// `cause`: mirar el mensaje de arriba devolvía siempre un 500.
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) return true;
    if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) return true;
  }
  return false;
}

const DUPLICATE_ERROR = 'ya tienes un concierto de este artista en esa fecha';

// recorta y capa un campo de texto libre; '' se guarda como NULL para que la UI
// no tenga que distinguir vacío de ausente
function text(value: unknown, max = CONCERT_TEXT_MAX_CHARS): string | null {
  return typeof value === 'string' ? value.trim().slice(0, max) || null : null;
}

// grupo de merge del artista + comprobación de que existe. Devuelve null si el
// artista no está en el catálogo (id inventado o borrado por un dedup)
function artistGroup(artistId: string, userId: number): string[] | null {
  const db = getDb();
  const exists = db.all(sql`SELECT spotify_id FROM artists WHERE spotify_id = ${artistId}`)[0];
  if (!exists) return null;
  return getEntityMergeGroup(db, 'artist', artistId, userId);
}

// --- lectura ---

// registro completo del usuario + totales (página global)
concerts.get('/', async (c) => {
  const userId = c.get('userId');
  const [rows, stats] = await Promise.all([
    dbRead('getConcerts', userId, null),
    dbRead('getConcertStats', userId),
  ]);

  const payload: ConcertStats = {
    total: stats.totals.total,
    artists: stats.totals.artists,
    venues: stats.totals.venues,
    cities: stats.totals.cities,
    countries: stats.totals.countries,
    firstDate: stats.totals.first_date,
    lastDate: stats.totals.last_date,
    byYear: stats.byYear,
    topArtists: stats.topArtists.map(a => ({ artistId: a.artist_id, name: a.name, imageUrl: a.image_url, count: a.count })),
  };

  return c.json({ concerts: await hydrateConcerts(userId, rows), stats: payload });
});

// un concierto concreto, para su vista de detalle. Va ANTES de las rutas con
// prefijo fijo ya declaradas arriba, pero DESPUÉS de '/' para que hono no case
// '/artist/x' ni '/setlistfm/x' contra este :id
concerts.get('/:id{[0-9]+}', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const rows = (await dbRead('getConcerts', userId, null)).filter(r => r.id === id);
  if (rows.length === 0) return c.json({ error: 'concert not found' }, 404);
  return c.json((await hydrateConcerts(userId, rows))[0]);
});

// conciertos de un artista (grupo de merge resuelto): lo pide la página de
// artista tras cada mutación, sin reventar el detail entero
concerts.get('/artist/:artistId', async (c) => {
  const userId = c.get('userId');
  const group = artistGroup(c.req.param('artistId'), userId);
  if (!group) return c.json({ error: 'artist not found' }, 404);
  return c.json(await hydrateConcerts(userId, await dbRead('getConcerts', userId, group)));
});

// --- escritura ---

// alta manual. El UNIQUE (user, artista, fecha) es el que impide duplicar un
// bolo ya registrado, incluido el que se importó de setlist.fm
concerts.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);

  const artistId = typeof body.artistId === 'string' ? body.artistId : '';
  const date = typeof body.date === 'string' ? body.date : '';
  if (!artistId) return c.json({ error: 'artistId required' }, 400);
  if (!ISO_DATE.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  if (!artistGroup(artistId, userId)) return c.json({ error: 'artist not found' }, 404);

  const db = getDb();
  try {
    const result = db.run(sql`
      INSERT INTO concerts (user_id, artist_id, concert_date, venue, city, country, tour, notes)
      VALUES (${userId}, ${artistId}, ${date}, ${text(body.venue)}, ${text(body.city)},
              ${text(body.country)}, ${text(body.tour)}, ${text(body.notes, CONCERT_NOTES_MAX_CHARS)})
    `);
    await refreshConcertCounts(userId);
    // los records de directo (mostConcerts / mostHeardLive) salen del log de
    // conciertos, no del historial: sin invalidar, la cache los daría por vigentes
    // hasta la siguiente escucha, porque su marca de agua es MAX(played_at)
    invalidateRecordsCacheForUser(userId);
    const rows = await dbRead('getConcerts', userId, null);
    const created = rows.find(r => r.id === Number(result.lastInsertRowid));
    return c.json((await hydrateConcerts(userId, created ? [created] : []))[0] ?? null, 201);
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: DUPLICATE_ERROR }, 409);
    throw err;
  }
});

// edición de los campos manuales. No toca el setlist: si el bolo vino de
// setlist.fm, corregirle el recinto no debe invalidar las canciones importadas
concerts.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);
  if (body.date !== undefined && !(typeof body.date === 'string' && ISO_DATE.test(body.date))) {
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  }

  const db = getDb();
  const existing = db.all(sql`SELECT id, concert_date FROM concerts WHERE id = ${id} AND user_id = ${userId}`)[0] as { id: number; concert_date: string } | undefined;
  if (!existing) return c.json({ error: 'concert not found' }, 404);

  const date = typeof body.date === 'string' ? body.date : existing.concert_date;
  try {
    db.run(sql`
      UPDATE concerts SET
        concert_date = ${date},
        venue = ${text(body.venue)},
        city = ${text(body.city)},
        country = ${text(body.country)},
        tour = ${text(body.tour)},
        notes = ${text(body.notes, CONCERT_NOTES_MAX_CHARS)},
        updated_at = datetime('now')
      WHERE id = ${id} AND user_id = ${userId}
    `);
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: DUPLICATE_ERROR }, 409);
    throw err;
  }

  const rows = (await dbRead('getConcerts', userId, null)).filter(r => r.id === id);
  return c.json((await hydrateConcerts(userId, rows))[0] ?? null);
});

// baja. Las canciones caen por ON DELETE CASCADE (la conexión abre con
// foreign_keys = ON), así que no hace falta borrarlas a mano
concerts.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const db = getDb();
  const result = db.run(sql`DELETE FROM concerts WHERE id = ${id} AND user_id = ${userId}`);
  if (result.changes === 0) return c.json({ error: 'concert not found' }, 404);
  await refreshConcertCounts(userId);
  invalidateRecordsCacheForUser(userId);
  return c.json({ success: true });
});

// reasignar a qué track de la librería corresponde una canción del setlist.
// El matching automático es una heurística por nombre: falla con títulos
// repetidos entre discos, con directos y con las canciones que no encontró.
// trackId null la desvincula ("no la tengo"), que también es una corrección
// válida cuando el matcher se inventó un parecido.
concerts.put('/:id{[0-9]+}/songs/:position{[0-9]+}', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const position = Number(c.req.param('position'));
  const body = await c.req.json<{ trackId?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);
  if (body.trackId !== null && typeof body.trackId !== 'string') {
    return c.json({ error: 'trackId must be a string or null' }, 400);
  }
  const trackId = body.trackId as string | null;

  const db = getDb();
  const owned = db.all(sql`SELECT id FROM concerts WHERE id = ${id} AND user_id = ${userId}`)[0];
  if (!owned) return c.json({ error: 'concert not found' }, 404);

  // el track tiene que existir: la atribución es evidencia sobre el catálogo,
  // no una vía para inventar entidades
  if (trackId) {
    const track = db.all(sql`SELECT spotify_id FROM tracks WHERE spotify_id = ${trackId}`)[0];
    if (!track) return c.json({ error: 'track not found' }, 404);
  }

  const result = db.run(sql`
    UPDATE concert_songs SET track_id = ${trackId}
    WHERE concert_id = ${id} AND position = ${position}
  `);
  if (result.changes === 0) return c.json({ error: 'song not found' }, 404);
  invalidateRecordsCacheForUser(userId);

  const rows = (await dbRead('getConcerts', userId, null)).filter(r => r.id === id);
  return c.json((await hydrateConcerts(userId, rows))[0]);
});

// --- setlist.fm ---

// candidatos para un artista. `configured: false` distingue "faltan credenciales"
// de "no hay bolos": la UI ofrece el alta manual en vez de un vacío sin explicar
concerts.get('/setlistfm/:artistId', async (c) => {
  const userId = c.get('userId');
  const artistId = c.req.param('artistId');
  const group = artistGroup(artistId, userId);
  if (!group) return c.json({ error: 'artist not found' }, 404);

  const db = getDb();
  // el NOMBRE sale siempre del artista visitado: coger uno cualquiera del grupo
  // de merge hacía buscar bolos de otro (un alias absorbido, o el artista de una
  // colaboración) y devolver un listado entero que no era el suyo
  const visited = db.all(sql`SELECT name FROM artists WHERE spotify_id = ${artistId}`)[0] as { name: string } | undefined;
  if (!visited) return c.json({ error: 'artist not found' }, 404);

  const empty = { artistName: visited.name, shows: [], page: 1, totalPages: 0, importedIds: [] };
  if (!isSetlistfmConfigured()) return c.json({ configured: false, ...empty });

  // el MBID sí puede venir de cualquier miembro del grupo: identifica a la misma
  // persona. NO es la clave de búsqueda (ver searchArtistShows): sólo desempata
  // homónimos, y sólo si aparece entre las entidades que devuelve el nombre.
  // Lo acreta el reconciliador de sintéticos y a veces es de otro artista
  const withMbid = db.all(sql`
    SELECT mbid FROM artists
    WHERE spotify_id IN (${sql.join(group.map(id => sql`${id}`), sql`, `)})
      AND mbid IS NOT NULL AND mbid != ''
    LIMIT 1
  `)[0] as { mbid: string } | undefined;
  const artist = { name: visited.name, mbid: withMbid?.mbid ?? null };

  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  // filtro por año: se ignora si no son cuatro dígitos. Es un filtro, no un
  // identificador — devolver 400 por un valor raro sería más ruidoso que útil
  const yearParam = c.req.query('year');
  const year = yearParam && /^\d{4}$/.test(yearParam) ? yearParam : null;
  try {
    // entidades que cuentan como bolos suyos (la propia + las giras que
    // encabeza). Sin esto, buscar por nombre arrastra los conciertos de otro en
    // los que estaba acreditado
    const accepted = await resolveAcceptedArtists(artist.name, artist.mbid);
    const acceptMbids = new Set(accepted.map(a => a.mbid));
    const found = await searchArtistShows({ artistName: artist.name, page, year, acceptMbids });
    const importedIds = await dbRead('getImportedSetlistIds', userId, group);
    return c.json({ configured: true, artistName: artist.name, ...found, importedIds });
  } catch (err) {
    log.error(`búsqueda de bolos de "${artist.name}" fallida:`, err);
    return c.json({ error: 'setlist.fm no responde' }, 502);
  }
});

// importa un setlist concreto como concierto asistido. Se vuelve a pedir a
// setlist.fm en vez de fiarse del payload del cliente: es la fuente de verdad y
// evita que un cliente inyecte un setlist arbitrario
concerts.post('/setlistfm/:artistId', async (c) => {
  const userId = c.get('userId');
  const artistId = c.req.param('artistId');
  const group = artistGroup(artistId, userId);
  if (!group) return c.json({ error: 'artist not found' }, 404);
  if (!isSetlistfmConfigured()) return c.json({ error: 'setlist.fm no configurado' }, 503);

  const body = await c.req.json<{ setlistId?: unknown }>().catch(() => null);
  const setlistId = typeof body?.setlistId === 'string' ? body.setlistId : '';
  if (!setlistId) return c.json({ error: 'setlistId required' }, 400);

  let show: SetlistfmShow | null;
  try {
    show = await getShow(setlistId);
  } catch (err) {
    log.error(`import del setlist ${setlistId} fallido:`, err);
    return c.json({ error: 'setlist.fm no responde' }, 502);
  }
  if (!show) return c.json({ error: 'setlist not found' }, 404);

  const resolved = await resolveSetlistSongs(group, show.songs);
  const db = getDb();
  let concertId: number;
  try {
    concertId = db.transaction(() => {
      const result = db.run(sql`
        INSERT INTO concerts (user_id, artist_id, concert_date, venue, city, country, tour, setlistfm_id, setlistfm_url)
        VALUES (${userId}, ${artistId}, ${show.date}, ${text(show.venue)}, ${text(show.city)},
                ${text(show.country)}, ${text(show.tour)}, ${show.id}, ${show.url})
      `);
      const newId = Number(result.lastInsertRowid);
      show.songs.forEach((song, i) => {
        db.run(sql`
          INSERT INTO concert_songs (concert_id, position, name, track_id, info, is_encore, cover_artist)
          VALUES (${newId}, ${i}, ${song.name.slice(0, CONCERT_TEXT_MAX_CHARS)}, ${resolved[i].trackId},
                  ${text(song.info)}, ${song.isEncore ? 1 : 0}, ${text(song.coverArtist)})
        `);
      });
      return newId;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: DUPLICATE_ERROR }, 409);
    throw err;
  }

  await refreshConcertCounts(userId);
  invalidateRecordsCacheForUser(userId);
  log.info(`concierto importado de setlist.fm: ${show.artistName} ${show.date} (${show.songs.length} canciones)`);
  const rows = (await dbRead('getConcerts', userId, group)).filter(r => r.id === concertId);
  return c.json((await hydrateConcerts(userId, rows))[0] ?? null, 201);
});

export default concerts;
