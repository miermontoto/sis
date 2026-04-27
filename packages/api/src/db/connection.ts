import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqlite: Database.Database | null = null;

export function getDb() {
  if (db) return db;

  // resolver ruta de la db relativa a cwd (monorepo root tanto en dev como docker)
  const rawPath = process.env.DATABASE_PATH || './data/sis.db';
  const dbPath = resolve(process.cwd(), rawPath);
  mkdirSync(dirname(dbPath), { recursive: true });
  sqlite = new Database(dbPath);

  // habilitar WAL para lecturas concurrentes con escrituras
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  // performance: cache grande, temp tables en memoria, menos fsync (seguro con WAL)
  sqlite.pragma('cache_size = -64000');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('synchronous = NORMAL');

  // función personalizada para búsquedas sin acentos
  sqlite.function('unaccent', (s: unknown) =>
    typeof s === 'string' ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : s
  );

  db = drizzle(sqlite, { schema });

  // buscar migraciones en dev (src/db/migrations) o prod (dist/db/migrations)
  const candidates = [
    resolve(__dirname, 'migrations'),
    resolve(__dirname, 'db/migrations'),
  ];
  const migrationsFolder = candidates.find(existsSync);
  if (migrationsFolder) {
    try {
      migrate(db, { migrationsFolder });
      console.log('[db] migraciones ejecutadas correctamente');
    } catch (err) {
      console.log('[db] sin migraciones pendientes');
    }
  }

  // columnas e índices adicionales no gestionados por drizzle
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN verified_album INTEGER'); } catch {}
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN verified_artists INTEGER'); } catch {}
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN disc_number INTEGER'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_track_artists_track_id ON track_artists(track_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_track_artists_artist_id ON track_artists(artist_id)'); } catch {}
  // composite para aggregaciones: GROUP BY track_id filtrado por user_id + rango temporal
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_lh_user_track ON listening_history(user_id, track_id)'); } catch {}
  // merge_rules: JOIN en queries de álbumes
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_merge_rules_lookup ON merge_rules(entity_type, source_id, user_id)'); } catch {}
  try { sqlite.exec('ALTER TABLE polling_state ADD COLUMN is_playing INTEGER DEFAULT 0'); } catch {}
  try { sqlite.exec('ALTER TABLE albums ADD COLUMN artist_ids TEXT'); } catch {}

  // multi-user: tabla de usuarios
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spotify_id TEXT NOT NULL UNIQUE,
      display_name TEXT,
      image_url TEXT,
      is_admin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}

  // multi-user: userId en tablas existentes
  try { sqlite.exec('ALTER TABLE auth_tokens ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}
  try { sqlite.exec('ALTER TABLE polling_state ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}
  try { sqlite.exec('ALTER TABLE listening_history ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}
  try { sqlite.exec('ALTER TABLE merge_rules ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}

  // multi-user: reemplazar unique en played_at por composite (user_id, played_at)
  try { sqlite.exec('DROP INDEX IF EXISTS listening_history_played_at_unique'); } catch {}
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_history_user_played_at ON listening_history(user_id, played_at)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_listening_history_user_id ON listening_history(user_id)'); } catch {}

  // album covers: historial de portadas observadas + uploads
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS album_covers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'spotify',
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(album_id, image_url)
    )`);
  } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_album_covers_album_id ON album_covers(album_id)'); } catch {}

  // multi-user: unique en user_id para auth_tokens y polling_state
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id)'); } catch {}
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_polling_state_user_id ON polling_state(user_id)'); } catch {}

  // FTS5: índice de búsqueda full-text para artistas, álbumes y tracks
  try {
    sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      entity_id UNINDEXED,
      entity_type UNINDEXED,
      name,
      extra_text,
      tokenize='unicode61 remove_diacritics 2'
    )`);

    sqlite.exec('BEGIN');
    sqlite.exec('DELETE FROM search_index');
    sqlite.exec(`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
      SELECT spotify_id, 'artist', name, '' FROM artists WHERE spotify_id NOT LIKE 'import:%'`);
    sqlite.exec(`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
      SELECT spotify_id, 'album', name, '' FROM albums WHERE spotify_id NOT LIKE 'import:%'`);
    sqlite.exec(`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
      SELECT t.spotify_id, 'track', t.name, COALESCE(ar.name, '')
      FROM tracks t
      LEFT JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
      LEFT JOIN artists ar ON ar.spotify_id = ta.artist_id
      WHERE t.spotify_id NOT LIKE 'import:%'`);
    sqlite.exec('COMMIT');

    // triggers para mantener el índice sincronizado con inserts/updates
    for (const trigger of [
      'fts_artists_ai',
      'fts_artists_au',
      'fts_albums_ai',
      'fts_albums_au',
      'fts_tracks_ai',
      'fts_tracks_au',
      'fts_track_artists_ai',
      'fts_track_artists_au',
      'fts_track_artists_ad',
    ]) {
      sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_artists_ai AFTER INSERT ON artists
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'artist';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (NEW.spotify_id, 'artist', NEW.name, '');
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_artists_au AFTER UPDATE OF name ON artists
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'artist';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (NEW.spotify_id, 'artist', NEW.name, '');
        DELETE FROM search_index
        WHERE entity_type = 'track'
          AND entity_id IN (
            SELECT ta.track_id FROM track_artists ta WHERE ta.artist_id = NEW.spotify_id AND ta.position = 0
          );
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        SELECT t.spotify_id, 'track', t.name, NEW.name
        FROM tracks t
        JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.artist_id = NEW.spotify_id AND ta.position = 0
        WHERE t.spotify_id NOT LIKE 'import:%';
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_albums_ai AFTER INSERT ON albums
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'album';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (NEW.spotify_id, 'album', NEW.name, '');
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_albums_au AFTER UPDATE OF name ON albums
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'album';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (NEW.spotify_id, 'album', NEW.name, '');
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_tracks_ai AFTER INSERT ON tracks
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (
          NEW.spotify_id,
          'track',
          NEW.name,
          COALESCE((
            SELECT a.name
            FROM track_artists ta
            JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = NEW.spotify_id AND ta.position = 0
            LIMIT 1
          ), '')
        );
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_tracks_au AFTER UPDATE OF name ON tracks
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (
          NEW.spotify_id,
          'track',
          NEW.name,
          COALESCE((
            SELECT a.name
            FROM track_artists ta
            JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = NEW.spotify_id AND ta.position = 0
            LIMIT 1
          ), '')
        );
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_track_artists_ai AFTER INSERT ON track_artists
      WHEN NEW.position = 0 BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.track_id AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        SELECT t.spotify_id, 'track', t.name, COALESCE(a.name, '')
        FROM tracks t
        LEFT JOIN artists a ON a.spotify_id = NEW.artist_id
        WHERE t.spotify_id = NEW.track_id AND t.spotify_id NOT LIKE 'import:%';
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_track_artists_au AFTER UPDATE OF artist_id, position ON track_artists
      BEGIN
        DELETE FROM search_index WHERE entity_id IN (OLD.track_id, NEW.track_id) AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        SELECT t.spotify_id, 'track', t.name, COALESCE(a.name, '')
        FROM tracks t
        LEFT JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
        LEFT JOIN artists a ON a.spotify_id = ta.artist_id
        WHERE t.spotify_id IN (OLD.track_id, NEW.track_id) AND t.spotify_id NOT LIKE 'import:%';
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_track_artists_ad AFTER DELETE ON track_artists
      WHEN OLD.position = 0 BEGIN
        DELETE FROM search_index WHERE entity_id = OLD.track_id AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        SELECT t.spotify_id, 'track', t.name, COALESCE(a.name, '')
        FROM tracks t
        LEFT JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
        LEFT JOIN artists a ON a.spotify_id = ta.artist_id
        WHERE t.spotify_id = OLD.track_id AND t.spotify_id NOT LIKE 'import:%';
      END`);

    console.log('[db] índice FTS5 creado y poblado');
  } catch (err) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    console.error('[db] error creando índice FTS5:', err);
  }

  console.log(`[db] conectado a ${dbPath} (WAL mode)`);
  return db;
}

export function closeDb() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
    console.log('[db] conexión cerrada');
  }
}
