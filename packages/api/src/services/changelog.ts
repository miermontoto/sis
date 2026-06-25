// changelog de sis sobre el servicio compartido de @platform/changelog. las
// entradas (fuente de verdad) viven en changelog-data.ts y se siembran al boot;
// el corte de lectura se guarda por usuario (id integer) en changelog_seen.
import { createChangelogService } from '@platform/changelog';
import { getDb } from '../db/connection.js';
import { changelogEntry, changelogSeen } from '../db/schema.js';
import { CHANGELOG } from '../changelog-data.js';

const service = createChangelogService({
  getDb,
  entryTable: changelogEntry,
  seenTable: changelogSeen,
  entries: CHANGELOG,
});

export const seedChangelog = service.seed;
export const getChangelogState = service.getState;
export const markChangelogSeen = service.markSeen;
