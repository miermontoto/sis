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

  // columnas adicionales no gestionadas por drizzle
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN verified_album INTEGER'); } catch {}
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN verified_artists INTEGER'); } catch {}

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
