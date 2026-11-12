// recuerdos de una fecha: lo que sonó tal día como hoy en años anteriores y los
// aniversarios del día (primera escucha de un artista, publicación de un álbum).
// Los aniversarios son los mismos que avisa la push diaria (notification-events),
// que llama a estas funciones: el widget y la notificación no pueden discrepar
import { sql } from 'drizzle-orm';
import { fromWallTime, type MemoriesResponse, type MemoryAnniversary } from '@sis/shared';
import type { Db, AggregateRow } from './helpers.js';
import { trackArtistPairs, playDuration } from './helpers.js';
import { getTopEntities } from './entity.js';
import { fetchEntityMetadata } from './charts.js';
import { formatTopTrackRows } from './formatters.js';
import { ANNIVERSARY_MIN_PLAYS } from '../../constants.js';

const DAY_MS = 86_400_000;

export interface OnThisDayYear {
  year: number;
  plays: number;
  totalMs: number;
  // tema más escuchado ese día (filas de top-*, para formatTopTrackRows)
  top: AggregateRow[];
}

// fecha de calendario 'YYYY-MM-DD' → año, mes (1-12) y día
function splitDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

/** Tal día como `date` (fecha local del usuario) en cada año anterior con plays: un
 *  rango indexado por año (la medianoche local de ese día y la del siguiente, en su
 *  zona) en vez de comparar el mes-día de cada play del historial. Del más reciente al
 *  más antiguo; un 29 de febrero sólo existe en los bisiestos. */
export function getOnThisDay(db: Db, userId: number, date: string, timeZone: string, topLimit: number): OnThisDayYear[] {
  const [year, month, day] = splitDate(date);
  const first = db.get(sql`SELECT min(played_at) AS first FROM listening_history WHERE user_id = ${userId}`) as { first: string | null } | undefined;
  if (!first?.first) return [];
  const firstYear = Number(first.first.slice(0, 4));

  const out: OnThisDayYear[] = [];
  for (let y = year - 1; y >= firstYear; y--) {
    const wallStart = Date.UTC(y, month - 1, day);
    // Date.UTC desborda un 29-F de año no bisiesto al 1 de marzo: ese día no existe
    if (new Date(wallStart).getUTCDate() !== day) continue;
    const start = new Date(fromWallTime(timeZone, wallStart)).toISOString();
    // rangeWhere cierra con `<=`: el último instante antes de la medianoche siguiente
    const end = new Date(fromWallTime(timeZone, wallStart + DAY_MS) - 1).toISOString();
    const totals = db.get(sql`
      SELECT count(*) AS plays, coalesce(sum(${playDuration()}), 0) AS ms
      FROM listening_history lh
      JOIN tracks t ON t.spotify_id = lh.track_id
      WHERE lh.user_id = ${userId} AND lh.played_at >= ${start} AND lh.played_at <= ${end}
    `) as { plays: number; ms: number };
    if (totals.plays === 0) continue;
    out.push({ year: y, plays: totals.plays, totalMs: totals.ms, top: getTopEntities(db, 'track', start, 'plays', topLimit, end, userId) });
  }
  return out;
}

export interface AnniversaryRow { id: string; date: string; plays: number }

// 'YYYY-MM-DD' → año y 'MM-DD'
const yearAndDay = (date: string) => ({ year: Number(date.slice(0, 4)), mmdd: date.slice(5) });

/** Álbumes publicados tal día como `date` hace al menos un año (release_date completo),
 *  con ANNIVERSARY_MIN_PLAYS plays del usuario sobre su grupo de merge. Parte de los
 *  pocos álbumes con esa fecha y cuenta los plays de sus temas por índice: agrupar el
 *  historial entero por álbum resuelto para quedarse con una docena costaba 1.2-1.7s
 *  (349k plays). Un alias (source de un merge) o un miembro de colección no cumplen
 *  años por su cuenta: sus plays cuentan para su canónico o para la colección */
export function getReleaseAnniversaries(db: Db, userId: number, date: string): AnniversaryRow[] {
  const { year, mmdd } = yearAndDay(date);
  return db.all(sql`
    WITH cand AS (
      SELECT al.spotify_id AS id, al.release_date AS date
      FROM albums al
      WHERE length(al.release_date) = 10
        AND substr(al.release_date, 6) = ${mmdd}
        AND CAST(substr(al.release_date, 1, 4) AS INTEGER) < ${year}
        AND NOT EXISTS (SELECT 1 FROM merge_rules mr WHERE mr.entity_type = 'album' AND mr.user_id = ${userId} AND mr.source_id = al.spotify_id)
        AND NOT EXISTS (SELECT 1 FROM album_collection_members acm WHERE acm.user_id = ${userId} AND acm.member_type = 'album' AND acm.member_id = al.spotify_id)
    ),
    grp AS (
      SELECT c.id, c.id AS member FROM cand c
      UNION ALL
      SELECT c.id, mr.source_id FROM cand c
      JOIN merge_rules mr ON mr.entity_type = 'album' AND mr.user_id = ${userId} AND mr.target_id = c.id
    ),
    -- los temas cuyos plays acaban en el álbum, con la misma resolución que el eje
    -- álbum (resolvedPlayJoins): los suyos salvo los mergeados a otro tema o metidos
    -- sueltos en una colección, más los de fuera mergeados a uno de los suyos
    own AS (
      SELECT g.id, t.spotify_id AS track_id FROM grp g JOIN tracks t ON t.album_id = g.member
    ),
    trk AS (
      SELECT o.id, o.track_id FROM own o
      WHERE NOT EXISTS (SELECT 1 FROM merge_rules mt WHERE mt.entity_type = 'track' AND mt.user_id = ${userId} AND mt.source_id = o.track_id)
        AND NOT EXISTS (SELECT 1 FROM album_collection_members acm WHERE acm.user_id = ${userId} AND acm.member_type = 'track' AND acm.member_id = o.track_id)
      UNION
      SELECT o.id, mt.source_id FROM own o
      JOIN merge_rules mt ON mt.entity_type = 'track' AND mt.user_id = ${userId} AND mt.target_id = o.track_id
    ),
    counted AS (
      SELECT c.id, c.date, (
        SELECT count(*) FROM listening_history lh
        WHERE lh.user_id = ${userId}
          AND lh.track_id IN (SELECT trk.track_id FROM trk WHERE trk.id = c.id)
      ) AS plays
      FROM cand c
    )
    SELECT id, date, plays FROM counted
    WHERE plays >= ${ANNIVERSARY_MIN_PLAYS}
    ORDER BY plays DESC
  `) as AnniversaryRow[];
}

/** Artistas (merges resueltos) cuya primera play fue tal día como `date` hace al menos
 *  un año, con un mínimo de plays. Se agrega por track (primera play y recuento) y se
 *  expande a artista con trackArtistPairs: el DISTINCT por (artista, play) que hacía la
 *  push recorría ~400k filas play × crédito. La fecha de la primera play es la UTC. */
export function getFirstListenAnniversaries(db: Db, userId: number, date: string): AnniversaryRow[] {
  const { year, mmdd } = yearAndDay(date);
  return db.all(sql`
    WITH pt AS (
      SELECT lh.track_id, min(lh.played_at) AS first_at, count(*) AS plays
      FROM listening_history lh
      WHERE lh.user_id = ${userId}
      GROUP BY lh.track_id
    )
    SELECT am.eid AS id, min(pt.first_at) AS date, sum(pt.plays) AS plays
    FROM pt
    JOIN ${trackArtistPairs(userId)} am ON am.track_id = pt.track_id
    GROUP BY am.eid
    -- los agregados escritos enteros: en un HAVING, "plays" sería la columna de pt
    -- (la de un track cualquiera del grupo), no el alias de la suma
    HAVING sum(pt.plays) >= ${ANNIVERSARY_MIN_PLAYS}
      AND substr(min(pt.first_at), 6, 5) = ${mmdd}
      AND CAST(substr(min(pt.first_at), 1, 4) AS INTEGER) < ${year}
    ORDER BY sum(pt.plays) DESC
  `) as AnniversaryRow[];
}

// aniversarios por widget: los más escuchados, que el resto no cabe en un large
const MEMORIES_ANNIVERSARY_LIMIT = 12;

function toAnniversaries(db: Db, type: 'artist' | 'album', rows: AnniversaryRow[], year: number, userId: number): MemoryAnniversary[] {
  const top = rows.slice(0, MEMORIES_ANNIVERSARY_LIMIT);
  const meta = fetchEntityMetadata(db, type, top.map(r => r.id), userId);
  return top.flatMap(r => {
    const m = meta.get(r.id);
    if (!m) return [];
    return [{
      type, id: r.id, name: m.name, imageUrl: m.imageUrl,
      artistId: type === 'album' ? m.artistId : null,
      artistName: type === 'album' ? m.artistName : null,
      date: r.date, years: year - Number(r.date.slice(0, 4)), plays: r.plays,
    }];
  });
}

/** Todo lo que piden los widgets de recuerdos para una fecha local, formateado en una
 *  sola vuelta al worker: los dos widgets comparten la petición (cache del cliente). */
export function getMemories(db: Db, userId: number, date: string, timeZone: string): MemoriesResponse {
  const year = Number(date.slice(0, 4));
  const days = getOnThisDay(db, userId, date, timeZone, 1);
  const tracks = formatTopTrackRows(db, days.flatMap(d => d.top), userId);
  const trackById = new Map(tracks.map(t => [t.trackId, t]));
  return {
    date,
    onThisDay: days.map(d => ({
      year: d.year, yearsAgo: year - d.year, plays: d.plays, totalMs: d.totalMs,
      topTrack: d.top[0] ? trackById.get(d.top[0].entity_id) ?? null : null,
    })),
    firstListens: toAnniversaries(db, 'artist', getFirstListenAnniversaries(db, userId, date), year, userId),
    releases: toAnniversaries(db, 'album', getReleaseAnniversaries(db, userId, date), year, userId),
  };
}
