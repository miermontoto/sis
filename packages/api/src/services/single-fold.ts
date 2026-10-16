// plegado automático de singles de adelanto en su álbum (ajuste autoMergeSingles, opt-out).
//
// spotify publica cada single como un álbum propio, así que sin esto el single y su disco
// compiten en los rankings de álbumes y el tracklist del disco pierde los temas que vivían
// en el single (sus gemelos isrc se pliegan en el track del single, ver
// resolveDuplicateTrackId). El usuario lo arreglaba a mano mergeando el single en el
// álbum; esto lo hace solo en cuanto el álbum entra en la biblioteca.
//
// Qué se pliega lo decide planSingleFolds (pool de lectura) con pickSingleFold (shared):
// el single entero va al álbum como merge de álbum y, de sus temas, sólo los que son la
// MISMA grabación se mergean además como track. Aquí se rellenan los tracklists a medias
// que el plan pide y se escriben los merges, con su fila en single_folds para que un
// unmerge del usuario no se deshaga en la pasada siguiente.
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { dbReadBackground } from '../db/read-pool.js';
import { mergeRules, singleFolds } from '../db/schema.js';
import { validateMergeRule } from '../routes/admin/_shared.js';
import { invalidateRankingCache } from '../routes/admin/impact.js';
import { ensureFullAlbumTracks } from './ingestion/enrichment.js';
import { getStoredTokens } from './token-manager.js';
import { getAllActiveUsersWithTokens } from './user-manager.js';
import { createLogger } from './logger.js';
import { SINGLE_FOLD_TRACKLIST_FETCH_MAX } from '../constants.js';
import type { SingleFoldPlan } from '../db/queries/index.js';

const log = createLogger('single-fold');

export const AUTO_MERGE_SINGLES_KEY = 'autoMergeSingles';

type Db = ReturnType<typeof getDb>;
type Fold = SingleFoldPlan['folds'][number];

// una pasada en vuelo por usuario: el tick horario, el arranque diferido y activar el
// ajuste pueden coincidir, y dos pasadas sobre el mismo plan escribirían dos veces
const inFlight = new Map<number, Promise<void>>();

// opt-out: está activado todo el que no lo haya apagado. sin fila en user_settings vale
// el default de routes/settings.ts ('true'), así que se mira la ausencia de un 'false'
const enabledUserIds = (): number[] => (getDb().all(sql`
  SELECT u.id FROM users u
  WHERE u.is_active = 1
    AND NOT EXISTS (SELECT 1 FROM user_settings s
      WHERE s.user_id = u.spotify_id AND s.key = ${AUTO_MERGE_SINGLES_KEY} AND s.value = 'false')
`) as { id: number }[]).map(r => r.id);

const isEnabled = (userId: number) => enabledUserIds().includes(userId);

// el tracklist es catálogo: vale el token de cualquiera si el usuario no tiene (cuentas
// sólo last.fm), igual que el resto de operaciones globales del polling
const tokenUserFor = (userId: number): number | null =>
  getStoredTokens(userId) ? userId : getAllActiveUsersWithTokens()[0]?.userId ?? null;

const exists = (db: Db, table: 'albums' | 'tracks', id: string) =>
  !!db.get(sql`SELECT 1 FROM ${sql.raw(table)} WHERE spotify_id = ${id}`);

// el plan se armó en otro hilo (y con awaits de por medio): lo que el usuario haya
// mergeado entretanto, o lo que un dedup físico haya borrado, manda sobre él
function applyFold(db: Db, userId: number, fold: Fold): boolean {
  if (!exists(db, 'albums', fold.singleId) || !exists(db, 'albums', fold.albumId)) return false;
  if (!validateMergeRule(db, userId, 'album', fold.singleId, fold.albumId).ok) return false;

  db.insert(mergeRules).values({ userId, entityType: 'album', sourceId: fold.singleId, targetId: fold.albumId }).run();
  fold.trackPairs
    .filter(p => exists(db, 'tracks', p.sourceTrackId) && exists(db, 'tracks', p.targetTrackId)
      && validateMergeRule(db, userId, 'track', p.sourceTrackId, p.targetTrackId).ok)
    .forEach(p => db.insert(mergeRules).values({ userId, entityType: 'track', sourceId: p.sourceTrackId, targetId: p.targetTrackId }).run());
  db.insert(singleFolds).values({ userId, singleId: fold.singleId, albumId: fold.albumId }).onConflictDoNothing().run();
  return true;
}

function applyFolds(userId: number, folds: Fold[]): void {
  if (folds.length === 0) return;
  const db = getDb();
  const applied = db.transaction(() => folds.filter(f => applyFold(db, userId, f)));
  if (applied.length === 0) return;

  invalidateRankingCache(userId);
  const ulog = log.child(userId);
  applied.forEach(f => ulog.info(`"${f.singleName}" plegado en "${f.albumName}" (+${f.trackPairs.length} tracks)`));
}

async function runFold(userId: number): Promise<void> {
  const tag = `single-fold:${userId}`;
  const plan = await dbReadBackground(tag, 'planSingleFolds', userId);

  // un álbum con el tracklist a medias puede no tener fila para el tema del single:
  // rellenarlo (ensureFullAlbumTracks lo sella 30 días) y volver a planear con él
  const tokenUser = tokenUserFor(userId);
  const fetches = tokenUser === null ? [] : plan.pendingTracklists.slice(0, SINGLE_FOLD_TRACKLIST_FETCH_MAX);
  for (const { albumId, totalTracks } of fetches) {
    // en serie a propósito: son llamadas a spotify y comparten su rate limit
    await ensureFullAlbumTracks(albumId, totalTracks, tokenUser!)
      .catch(err => log.child(userId).warn(`tracklist de ${albumId}:`, err));
  }

  applyFolds(userId, fetches.length > 0 ? (await dbReadBackground(tag, 'planSingleFolds', userId)).folds : plan.folds);
}

/** Una pasada del plegado para un usuario. No comprueba el ajuste: eso es cosa de quien
 *  la lanza (foldSinglesIfEnabled / foldSinglesForAllUsers). */
export function foldSinglesForUser(userId: number): Promise<void> {
  const running = inFlight.get(userId);
  if (running) return running;
  const run = runFold(userId).finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

/** Arranque diferido y PUT /settings: sólo si el usuario tiene el ajuste activado. */
export function foldSinglesIfEnabled(userId: number): Promise<void> {
  return isEnabled(userId) ? foldSinglesForUser(userId) : Promise.resolve();
}

/** Tick horario del polling sobre todos los usuarios con el ajuste activado. */
export async function foldSinglesForAllUsers(): Promise<void> {
  for (const userId of enabledUserIds()) {
    await foldSinglesForUser(userId).catch(err => log.child(userId).error('error:', err));
  }
}
