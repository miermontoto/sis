import { sql } from 'drizzle-orm';
import type { Db } from './helpers.js';
import { trackArtistsWhere } from './helpers.js';

export type ExportFormat = 'json' | 'csv';

const CSV_HEADER = 'played_at,track_name,artist_names,album_name,duration_ms,context_type';

// rfc 4180: las comillas de dentro se doblan. sin eso, un título como "Heroes" descuadraba
// la fila entera al abrirla en una hoja de cálculo. sin valor = campo vacío, no "null"
const csvField = (value: string | null) => `"${(value ?? '').replace(/"/g, '""')}"`;

interface ExportTrack {
  id: string;
  track_name: string;
  duration_ms: number;
  album_name: string | null;
  artist_names: string | null;
}

/** El historial entero del usuario ya serializado. Devuelve bytes y no filas ni texto para
 *  que el main thread no toque nada: 350k objetos tardan en clonarse y en convertirse a
 *  json, y un string aún hay que codificarlo; un Uint8Array se copia de una vez.
 *
 *  Metadata por tema una sola vez y los plays aparte, cruzados en js: con un join de
 *  créditos por play más GROUP BY, los mismos datos se recalculan cada vez que suena el
 *  tema (~2.1s frente a ~0.6s con 350k plays y 25k temas). */
export function getExportBody(db: Db, userId: number, format: ExportFormat): Uint8Array<ArrayBuffer> {
  const tracks = new Map((db.all(sql`
    SELECT t.spotify_id AS id, t.name AS track_name, t.duration_ms, a.name AS album_name,
           (SELECT GROUP_CONCAT(ar.name, ', ' ORDER BY ta.position, ta.artist_id)
            FROM ${trackArtistsWhere(userId, col => sql`${col('track_id')} = t.spotify_id`)} ta
            JOIN artists ar ON ar.spotify_id = ta.artist_id) AS artist_names
    FROM tracks t
    LEFT JOIN albums a ON a.spotify_id = t.album_id
    WHERE t.spotify_id IN (SELECT track_id FROM listening_history WHERE user_id = ${userId})
  `) as ExportTrack[]).map(t => [t.id, t]));

  const plays = db.all(sql`
    SELECT played_at, track_id, context_type FROM listening_history
    WHERE user_id = ${userId}
    ORDER BY played_at DESC
  `) as { played_at: string; track_id: string; context_type: string | null }[];

  const rows = plays.flatMap(({ played_at, track_id, context_type }) => {
    const track = tracks.get(track_id);
    return track ? [{
      played_at,
      track_name: track.track_name,
      duration_ms: track.duration_ms,
      album_name: track.album_name,
      artist_names: track.artist_names,
      context_type,
    }] : [];
  });

  const text = format === 'csv'
    ? [CSV_HEADER, ...rows.map(r =>
        [r.played_at, csvField(r.track_name), csvField(r.artist_names), csvField(r.album_name), r.duration_ms, r.context_type || ''].join(','),
      )].join('\n')
    : JSON.stringify(rows);
  return new TextEncoder().encode(text);
}
