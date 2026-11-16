import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { withSpan } from '@platform/observability';
import { withoutRemasterSuffix } from '@sis/shared';

// el directorio de portadas se crea al importar enrichment.ts: fuera del repo
vi.hoisted(() => {
  process.env.DATABASE_PATH = `${process.env.TMPDIR ?? '/tmp'}/sis-enrichment-test/sis.db`;
  process.env.LOG_LEVEL = 'silent';
  process.env.LASTFM_API_KEY = 'test';
  process.env.LASTFM_API_SECRET = 'test';
});

let db: BetterSQLite3Database;
vi.mock('../../db/connection.js', () => ({ getDb: () => db }));
vi.mock('../../constants.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../constants.js')>(),
  MB_DELAY_MS: 0,
  MB_RETRY_BACKOFF_MS: 0,
  LASTFM_REQUEST_SPACING_MS: 0,
}));

import { enrichImportTrackDurations, enrichLocalAlbumCovers } from './enrichment.js';
import { enrichImportTrackIdentity } from './identity.js';
import { enrichLastfmDurations } from '../lastfm-enrich.js';
import { importListenEvents } from '../history-import.js';
import { TRACK_DURATION_NOT_FOUND, TRACK_DURATION_PENDING } from '../../constants.js';

// sólo las columnas que tocan estos caminos
const DDL = `
  CREATE TABLE artists (spotify_id TEXT PRIMARY KEY, name TEXT NOT NULL, genres TEXT DEFAULT '[]', mbid TEXT, updated_at TEXT NOT NULL DEFAULT '');
  CREATE TABLE albums (spotify_id TEXT PRIMARY KEY, name TEXT NOT NULL, image_url TEXT, mbid TEXT, updated_at TEXT NOT NULL DEFAULT '');
  CREATE TABLE tracks (spotify_id TEXT PRIMARY KEY, name TEXT NOT NULL, album_id TEXT, duration_ms INTEGER NOT NULL DEFAULT 0, isrc TEXT, mbid TEXT, updated_at TEXT NOT NULL DEFAULT '');
  CREATE TABLE track_artists (track_id TEXT NOT NULL, artist_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (track_id, artist_id));
  CREATE TABLE album_covers (album_id TEXT NOT NULL, image_url TEXT NOT NULL, source TEXT, UNIQUE (album_id, image_url));
  CREATE TABLE listening_history (id INTEGER PRIMARY KEY, track_id TEXT NOT NULL, played_at TEXT NOT NULL, user_id INTEGER, duration_played_ms INTEGER, source TEXT, UNIQUE (user_id, played_at));
`;

const ARTIST = 'Silverchair';
// holgado para una pasada lineal (~5ms) y muy por debajo de la cuadrática (~42s)
const MAX_LINEAR_MATCH_MS = 1_000;
const ARTIST_ID = 'import:silverchair';
// la forma real de /recording?query=, medida contra musicbrainz: length en ms, créditos y
// lanzamientos con su release-group. dos de estudio es el mínimo que acepta la búsqueda
const STUDIO_RELEASE = { status: 'Official', 'release-group': { 'primary-type': 'Album' } };
const recording = (title: string, length?: number) => ({
  id: `mbid:${title}`, title, score: 100, length,
  'artist-credit': [{ name: ARTIST, artist: { id: 'mbid:artist', name: ARTIST } }],
  releases: [STUDIO_RELEASE, STUDIO_RELEASE],
});
const search = (...recordings: ReturnType<typeof recording>[]) => Response.json({ count: recordings.length, recordings });
const unavailable = () => new Response('', { status: 503, headers: { 'Retry-After': '0' } });

const fetchMock = vi.fn<typeof fetch>();
const respondWith = (...responses: (() => Response)[]) =>
  responses.forEach(r => fetchMock.mockImplementationOnce(async () => r()));
const requested = () => fetchMock.mock.calls.map(([url]) => decodeURIComponent(String(url)));

function seedTrack(id: string, name: string, durationMs: number, extra: { mbid?: string; isrc?: string } = {}) {
  db.run(sql`INSERT OR IGNORE INTO artists (spotify_id, name) VALUES (${ARTIST_ID}, ${ARTIST})`);
  db.run(sql`INSERT INTO tracks (spotify_id, name, duration_ms, mbid, isrc) VALUES (${id}, ${name}, ${durationMs}, ${extra.mbid ?? null}, ${extra.isrc ?? null})`);
  db.run(sql`INSERT INTO track_artists (track_id, artist_id, position) VALUES (${id}, ${ARTIST_ID}, 0)`);
}
const trackRow = (id: string) =>
  db.get(sql`SELECT duration_ms AS durationMs, mbid, isrc FROM tracks WHERE spotify_id = ${id}`) as { durationMs: number; mbid: string | null; isrc: string | null };

beforeEach(() => {
  const sqlite = new Database(':memory:');
  sqlite.exec(DDL);
  db = drizzle(sqlite);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('enrichImportTrackDurations', () => {
  it('sólo pregunta por los sintéticos pendientes: ni -1, ni con duración, ni ids reales', async () => {
    seedTrack('import:pending', 'Pending Import', TRACK_DURATION_PENDING);
    seedTrack('local:pending', 'Pending Local', TRACK_DURATION_PENDING);
    seedTrack('import:lost', 'Given Up', TRACK_DURATION_NOT_FOUND);
    seedTrack('import:known', 'Known', 200_000);
    seedTrack('0stJVUaaaaaaaaaaaaaaaa', 'Real Spotify Id', TRACK_DURATION_PENDING);
    fetchMock.mockImplementation(async () => search());

    await enrichImportTrackDurations();

    const asked = requested().join('\n');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(asked).toContain('Pending Import');
    expect(asked).toContain('Pending Local');
    expect(asked).not.toMatch(/Given Up|Known|Real Spotify Id/);
  });

  it('un 200 sin coincidencia marca -1 y el track no vuelve a preguntarse', async () => {
    seedTrack('import:a', 'Family Guy Compilation', TRACK_DURATION_PENDING);
    respondWith(search);

    await enrichImportTrackDurations();
    expect(trackRow('import:a')).toMatchObject({ durationMs: TRACK_DURATION_NOT_FOUND, mbid: null });

    await enrichImportTrackDurations();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un 200 con coincidencia guarda la duración y acreta el mbid', async () => {
    seedTrack('import:a', 'Tomorrow', TRACK_DURATION_PENDING);
    respondWith(() => search(recording('Tomorrow', 266_613)));

    await enrichImportTrackDurations();

    expect(trackRow('import:a')).toEqual({ durationMs: 266_613, mbid: 'mbid:Tomorrow', isrc: null });
  });

  it('una coincidencia sin length marca -1 pero conserva el mbid', async () => {
    seedTrack('import:a', 'Deja Vu', TRACK_DURATION_PENDING);
    respondWith(() => search(recording('Deja Vu')));

    await enrichImportTrackDurations();

    expect(trackRow('import:a')).toMatchObject({ durationMs: TRACK_DURATION_NOT_FOUND, mbid: 'mbid:Deja Vu' });
  });

  it('un 503 reintenta una vez y aprovecha la respuesta', async () => {
    seedTrack('import:a', 'Tomorrow', TRACK_DURATION_PENDING);
    respondWith(unavailable, () => search(recording('Tomorrow', 266_613)));

    await enrichImportTrackDurations();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(trackRow('import:a').durationMs).toBe(266_613);
  });

  it('dos 503 seguidos no marcan: el track sigue en cola para la siguiente pasada', async () => {
    seedTrack('import:a', 'Tomorrow', TRACK_DURATION_PENDING);
    respondWith(unavailable, unavailable, () => search(recording('Tomorrow', 266_613)));

    await enrichImportTrackDurations();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(trackRow('import:a').durationMs).toBe(TRACK_DURATION_PENDING);

    await enrichImportTrackDurations();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(trackRow('import:a').durationMs).toBe(266_613);
  });

  // un 400 es determinista: si dejara el track en cola, sería este mismo bucle otra vez
  it('un 400 no se reintenta y da el track por perdido', async () => {
    seedTrack('import:a', 'Tomorrow', TRACK_DURATION_PENDING);
    respondWith(() => new Response('', { status: 400 }));

    await enrichImportTrackDurations();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trackRow('import:a').durationMs).toBe(TRACK_DURATION_NOT_FOUND);
  });

  it('un título remasterizado cae al título base: toma su duración, nunca su mbid', async () => {
    seedTrack('import:a', 'Tomorrow - Remastered', TRACK_DURATION_PENDING);
    respondWith(search, () => search(recording('Tomorrow', 266_613)));

    await enrichImportTrackDurations();

    expect(requested()[1]).toContain('recording:"Tomorrow" AND');
    expect(trackRow('import:a')).toMatchObject({ durationMs: 266_613, mbid: null });
  });

  it('un 503 en la búsqueda del título base no marca', async () => {
    seedTrack('import:a', 'Tomorrow - Remastered', TRACK_DURATION_PENDING);
    respondWith(search, unavailable, unavailable);

    await enrichImportTrackDurations();

    expect(trackRow('import:a').durationMs).toBe(TRACK_DURATION_PENDING);
  });

  // otra grabación: el título base daría una duración que no es la suya
  it.each(['Chicle Cosmos - Demo', 'Chicos Malos - Live Barcelona 20-9-2008', 'Revolution 909 - Roger Sanchez Remix'])(
    '%s no cae al título base', async (name) => {
      seedTrack('import:a', name, TRACK_DURATION_PENDING);
      respondWith(search);

      await enrichImportTrackDurations();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(trackRow('import:a').durationMs).toBe(TRACK_DURATION_NOT_FOUND);
    });
});

describe('traza del reintento', () => {
  it('el span de la espera lleva el Retry-After que mandó el servidor', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    provider.register();
    try {
      seedTrack('import:a', 'Tomorrow', TRACK_DURATION_PENDING);
      respondWith(unavailable, search);

      await withSpan('job', () => enrichImportTrackDurations(), { root: true });

      const wait = exporter.getFinishedSpans().find(s => s.name === 'musicbrainz retry wait');
      expect(wait?.attributes).toMatchObject({ 'http.response.status_code': 503, 'http.response.header.retry-after': '0' });
    } finally {
      await provider.shutdown();
      trace.disable();
    }
  });
});

describe('withoutRemasterSuffix', () => {
  // los dos primeros son filas reales: con el sufijo, la búsqueda citada da count=0
  it.each([
    ['Tomorrow - Remastered', 'Tomorrow'],
    ['Tantas Cosas Que Arreglar - Remasterizada', 'Tantas Cosas Que Arreglar'],
    ['Paint It Black - Remastered 2011', 'Paint It Black'],
    ['Heroes - 2017 Remaster', 'Heroes'],
    ['Heroes - 2003 Digital Remaster', 'Heroes'],
    ['Heroes - Remastered Version', 'Heroes'],
    ['Heroes (Remastered)', 'Heroes'],
    ['Heroes (2011 Remaster)', 'Heroes'],
  ])('%s → %s', (title, base) => {
    expect(withoutRemasterSuffix(title)).toBe(base);
  });

  // otra grabación u otro título: quitarles algo daría la duración de otro tema
  it.each([
    'Chicle Cosmos - Demo',
    'Chicos Malos - Live Barcelona 20-9-2008',
    'Revolution 909 - Roger Sanchez Remix',
    'Cancer - Acoustic; Live at 98.7-FM Penthouse',
    'Remastered',
    'The Remaster Song',
    'Song - Remastered 2011 - Live',
    '(Remastered)',
    '- Remastered',
  ])('%s se queda igual', (title) => {
    expect(withoutRemasterSuffix(title)).toBe(title);
  });

  // el título llega por scrobble sin tope de longitud y el job corre en el hilo principal
  it('una racha larga de espacios no la vuelve cuadrática', () => {
    const title = `a${' '.repeat(80_000)}b`;
    const start = performance.now();
    expect(withoutRemasterSuffix(title)).toBe(title);
    expect(performance.now() - start).toBeLessThan(MAX_LINEAR_MATCH_MS);
  });
});

describe('enrichLastfmDurations', () => {
  it('lee la misma cola: los -1 tampoco vuelven a last.fm', async () => {
    seedTrack('import:pending', 'Pending', TRACK_DURATION_PENDING);
    seedTrack('import:lost', 'Given Up', TRACK_DURATION_NOT_FOUND);
    fetchMock.mockImplementation(async () => Response.json({ track: { duration: '180000' } }));

    expect(await enrichLastfmDurations()).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requested()[0]).toContain('track=Pending');
    expect(trackRow('import:pending').durationMs).toBe(180_000);
    expect(trackRow('import:lost').durationMs).toBe(TRACK_DURATION_NOT_FOUND);
  });
});

describe('upsert de un import', () => {
  it('una duración real sobrescribe el -1 y el track sigue fuera de la cola', async () => {
    seedTrack('import:a', 'Tomorrow', TRACK_DURATION_NOT_FOUND);

    importListenEvents(
      [{ playedAt: '2026-11-06T12:00:00.000Z', trackName: 'Tomorrow', artistName: ARTIST, spotifyTrackId: 'import:a', durationMs: 266_000 }],
      1, 'listenbrainz',
    );

    expect(trackRow('import:a').durationMs).toBe(266_000);
    await enrichImportTrackDurations();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('enrichImportTrackIdentity, fase de isrc', () => {
  const lookup = 'mbid-de-prueba';

  it('un 503 deja el isrc en NULL para reintentarlo, no lo sella como consultado', async () => {
    seedTrack('import:a', 'Tomorrow', 200_000, { mbid: lookup });
    respondWith(unavailable, unavailable);

    await enrichImportTrackIdentity();

    expect(trackRow('import:a').isrc).toBeNull();
  });

  it('un 404 sí es una respuesta y sella el centinela', async () => {
    seedTrack('import:a', 'Tomorrow', 200_000, { mbid: lookup });
    respondWith(() => new Response('', { status: 404 }));

    await enrichImportTrackIdentity();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trackRow('import:a').isrc).toBe('');
  });

  it('guarda el isrc de una respuesta real', async () => {
    seedTrack('import:a', 'Tomorrow', 200_000, { mbid: lookup });
    respondWith(() => Response.json({ isrcs: ['AUSM00000001'] }));

    await enrichImportTrackIdentity();

    expect(trackRow('import:a').isrc).toBe('AUSM00000001');
  });
});

describe('enrichLocalAlbumCovers', () => {
  const ALBUM = 'import:album';
  const release = () => Response.json({ releases: [{ id: 'release-1', score: 100 }] });
  const imageUrl = () => (db.get(sql`SELECT image_url AS imageUrl FROM albums WHERE spotify_id = ${ALBUM}`) as { imageUrl: string | null }).imageUrl;

  function seedAlbum() {
    db.run(sql`INSERT INTO albums (spotify_id, name) VALUES (${ALBUM}, 'Neon Ballroom')`);
    seedTrack('import:t', 'Anthem', 200_000);
    db.run(sql`UPDATE tracks SET album_id = ${ALBUM} WHERE spotify_id = 'import:t'`);
  }

  it('un álbum sin temas acreditados no entra en la cola ni repite el aviso', async () => {
    db.run(sql`INSERT INTO albums (spotify_id, name) VALUES (${ALBUM}, 'Orphan')`);

    await enrichLocalAlbumCovers();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(imageUrl()).toBeNull();
  });

  it('un 503 de musicbrainz deja el álbum en NULL para reintentarlo', async () => {
    seedAlbum();
    respondWith(unavailable, unavailable);

    await enrichLocalAlbumCovers();

    expect(imageUrl()).toBeNull();
  });

  it('una búsqueda sin release sella el centinela', async () => {
    seedAlbum();
    respondWith(() => Response.json({ releases: [] }));

    await enrichLocalAlbumCovers();

    expect(imageUrl()).toBe('');
  });

  it('un 404 de cover art archive sella el centinela; un 503 no', async () => {
    seedAlbum();
    respondWith(release, unavailable);
    await enrichLocalAlbumCovers();
    expect(imageUrl()).toBeNull();

    respondWith(release, () => new Response('', { status: 404 }));
    await enrichLocalAlbumCovers();
    expect(imageUrl()).toBe('');
  });
});
