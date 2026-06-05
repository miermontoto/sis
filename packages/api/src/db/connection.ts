// conexión sqlite de sis sobre la factoría compartida de @platform/db. el ddl
// legacy (columnas ad-hoc, multi-user, social, fts5) vive en legacy-ddl.ts.
import { createSqliteDb, type SqliteDbHandle } from '@platform/db';
import * as schema from './schema.js';
import { applyLegacyDdl } from './legacy-ddl.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let handle: SqliteDbHandle<typeof schema> | null = null;

export function getDb() {
  if (handle) return handle.db;
  handle = createSqliteDb({
    schema,
    defaultPath: './data/sis.db',
    // migraciones en dev (src/db/migrations) y prod (dist/db/migrations)
    migrationsCandidates: [resolve(__dirname, 'migrations'), resolve(__dirname, 'db/migrations')],
    // el journal de sis no está saneado: un fallo de migrate no debe tirar el boot
    migrationErrorMode: 'warn',
    afterOpen: applyLegacyDdl,
  });
  return handle.db;
}

export function closeDb() {
  handle?.close();
  handle = null;
}
