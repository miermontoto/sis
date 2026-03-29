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
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id)'); } catch {}
  try { sqlite.exec('ALTER TABLE polling_state ADD COLUMN is_playing INTEGER DEFAULT 0'); } catch {}

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

  // multi-user: unique en user_id para auth_tokens y polling_state
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id)'); } catch {}
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_polling_state_user_id ON polling_state(user_id)'); } catch {}

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
