// zona horaria del calendario de cada usuario (ajuste `timeZone`, IANA). la fija el
// cliente con la del dispositivo la primera vez y se cambia en Settings → General. es
// la que cortan los periodos de los horneados (records, reports, pushes de cierre) y
// la de los requests que no la mandan (apks publicados)
import { sql } from 'drizzle-orm';
import { resolveTimeZone } from '@sis/shared';
import type { Db } from '../db/queries/helpers.js';

export const TIME_ZONE_SETTING = 'timeZone';

/** Zona guardada del usuario, o UTC si ningún cliente la ha fijado todavía. */
export function storedTimeZone(db: Db, userId: number): string {
  const row = db.get(sql`
    SELECT us.value FROM user_settings us JOIN users u ON u.spotify_id = us.user_id
    WHERE u.id = ${userId} AND us.key = ${TIME_ZONE_SETTING}
  `) as { value: string } | undefined;
  return resolveTimeZone(row?.value);
}
