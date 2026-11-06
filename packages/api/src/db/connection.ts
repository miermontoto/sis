// conexión sqlite de sis sobre la factoría compartida de @platform/db. el esquema vive en
// base-schema.ts y legacy-ddl.ts: sin migraciones de drizzle, cuyo journal apunta a .sql
// borrados. migrate() siempre lanzaba y se registraba como "sin migraciones pendientes".
import { createSqliteDb, type SqliteDbHandle } from '@platform/db';
import * as schema from './schema.js';
import { applyLegacyDdl } from './legacy-ddl.js';
import { isMainThread } from 'worker_threads';

let handle: SqliteDbHandle<typeof schema> | null = null;

export function getDb() {
  if (handle) return handle.db;
  handle = createSqliteDb({
    schema,
    defaultPath: './data/sis.db',
    // sólo el main thread toca el esquema: abre antes de crear el pool (index.ts), y los
    // workers leen. con cada uno aplicando el ddl al abrir, competían por el lock de escritura
    // en cada arranque
    afterOpen: isMainThread ? applyLegacyDdl : undefined,
  });
  return handle.db;
}

export function closeDb() {
  handle?.close();
  handle = null;
}
