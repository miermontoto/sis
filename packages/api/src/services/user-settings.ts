// lectura de ajustes de un usuario por su id numérico. user_settings va por el SPOTIFY
// id (TEXT), así que leerlo con el numérico no casa con ninguna fila y devuelve
// siempre el default sin avisar: pasaba en la generación de playlists, que nunca vio
// el ajuste plays/time (hasta 2026-10-26)
import { sql } from 'drizzle-orm';
import { resolveTimeZone } from '@sis/shared';
import type { Db } from '../db/queries/helpers.js';

export const TIME_ZONE_SETTING = 'timeZone';

/** Valor guardado de un ajuste del usuario, o undefined si no lo ha tocado (vale el default). */
export function storedSetting(db: Db, userId: number, key: string): string | undefined {
  const row = db.get(sql`
    SELECT us.value FROM user_settings us JOIN users u ON u.spotify_id = us.user_id
    WHERE u.id = ${userId} AND us.key = ${key}
  `) as { value: string } | undefined;
  return row?.value;
}

/** Zona del calendario del usuario (ajuste `timeZone`, IANA): la que fija el cliente
 *  con la del dispositivo la primera vez y se cambia en Settings → General. Cortan con
 *  ella los horneados (records, reports, pushes de cierre) y los requests que no la
 *  mandan (apks publicados). UTC si ningún cliente la ha fijado todavía. */
export function storedTimeZone(db: Db, userId: number): string {
  return resolveTimeZone(storedSetting(db, userId, TIME_ZONE_SETTING));
}
