// scheduler de auto-regeneración de playlists generadas. corre en un timer global
// (ver polling.ts) y regenera las playlists cuya cadencia (regenerate_interval_ms)
// ha vencido desde su última regeneración. cada regen escribe en Spotify, así que
// se procesan en serie; un fallo por playlist se aísla y no corta el resto.
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { getUserById } from './user-manager.js';
import { regeneratePlaylist } from './playlist-generation.js';
import { notifyPlaylistRegenerated } from './notification-events.js';

interface DuePlaylistRow {
  id: number;
  user_id: number;
  regenerate_interval_ms: number;
  last_regenerated_at: string | null;
  created_at: string;
}

export async function runDueRegenerations(): Promise<void> {
  const db = getDb();
  const now = Date.now();

  const rows = db.all(sql`
    SELECT id, user_id, regenerate_interval_ms, last_regenerated_at, created_at
    FROM generated_playlists
    WHERE auto_regenerate = 1
      AND spotify_playlist_id IS NOT NULL
      AND regenerate_interval_ms IS NOT NULL
  `) as DuePlaylistRow[];

  for (const row of rows) {
    // baseline = última regeneración, o la creación si nunca se regeneró
    const baseline = row.last_regenerated_at ?? row.created_at;
    const dueAt = new Date(baseline).getTime() + row.regenerate_interval_ms;
    if (Number.isNaN(dueAt) || dueAt > now) continue;

    try {
      const result = await regeneratePlaylist(row.user_id, row.id);
      if (!result.ok) {
        console.warn(`[auto-regen] playlist ${row.id} no regenerada: ${result.error}`);
        continue;
      }
      console.log(`[auto-regen] regenerada playlist ${row.id} (${result.playlist.trackCount} tracks)`);

      // notificación push (gated por prefs + canal entregable dentro de la función)
      const spotifyId = getUserById(row.user_id)?.spotifyId;
      if (spotifyId) {
        notifyPlaylistRegenerated(row.user_id, spotifyId, result.playlist.name, result.playlist.trackCount);
      }
    } catch (err) {
      console.error(`[auto-regen] error regenerando playlist ${row.id}:`, err);
    }
  }
}
