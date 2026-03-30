import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { spotifyPlaylists, spotifyPlaylistTracks } from '../db/schema.js';
import { spotifyFetch } from './spotify-client.js';
import { upsertTrack } from './ingestion.js';
import { getAllActiveUsersWithTokens } from './user-manager.js';
import type { SpotifyPlaylistsResponse, SpotifyPlaylistTracksResponse } from '../types/spotify.js';

function isAlgorithmic(ownerId: string): boolean {
  return ownerId === 'spotify';
}

async function syncPlaylistTracks(userId: number, spotifyPlaylistId: string, dbPlaylistId: number): Promise<number> {
  const collected: { trackId: string; position: number; addedAt: string | null }[] = [];
  let offset = 0;

  // paginar todos los tracks
  while (true) {
    const res = await spotifyFetch<SpotifyPlaylistTracksResponse>(
      `/playlists/${spotifyPlaylistId}/tracks`,
      { userId, params: { limit: '100', offset: String(offset) } },
    );
    if (!res || res.items.length === 0) break;

    for (const item of res.items) {
      if (!item.track || item.is_local) continue;
      // upsert track/album/artists en nuestra DB
      upsertTrack(item.track);
      collected.push({
        trackId: item.track.id,
        position: collected.length,
        addedAt: item.added_at || null,
      });
    }

    offset += res.items.length;
    if (!res.next) break;
  }

  // reemplazar todos los tracks de esta playlist
  const db = getDb();
  db.run(sql`DELETE FROM spotify_playlist_tracks WHERE playlist_id = ${dbPlaylistId}`);
  for (const t of collected) {
    db.run(sql`
      INSERT OR IGNORE INTO spotify_playlist_tracks (playlist_id, track_id, position, added_at)
      VALUES (${dbPlaylistId}, ${t.trackId}, ${t.position}, ${t.addedAt})
    `);
  }

  return collected.length;
}

export async function syncUserPlaylists(userId: number): Promise<void> {
  const db = getDb();
  const seenSpotifyIds = new Set<string>();
  let offset = 0;

  console.log(`[playlist-sync] sincronizando playlists para usuario ${userId}...`);

  // paginar todas las playlists del usuario
  while (true) {
    const res = await spotifyFetch<SpotifyPlaylistsResponse>(
      '/me/playlists',
      { userId, params: { limit: '50', offset: String(offset) } },
    );
    if (!res || res.items.length === 0) break;

    for (const pl of res.items) {
      seenSpotifyIds.add(pl.id);

      // ignorar playlists sin tracks
      if (pl.tracks.total === 0) continue;

      const now = new Date().toISOString();

      // buscar en DB
      const existing = db.all(sql`
        SELECT id, snapshot_id FROM spotify_playlists
        WHERE user_id = ${userId} AND spotify_id = ${pl.id}
      `)[0] as { id: number; snapshot_id: string | null } | undefined;

      if (!existing) {
        // nueva playlist — insertar y sincronizar tracks
        const row = db.insert(spotifyPlaylists).values({
          userId,
          spotifyId: pl.id,
          name: pl.name,
          imageUrl: pl.images?.[0]?.url ?? null,
          ownerName: pl.owner.display_name,
          isOwned: pl.owner.id !== 'spotify' && pl.tracks.total > 0, // heuristic: si no es de spotify
          isAlgorithmic: isAlgorithmic(pl.owner.id),
          trackCount: pl.tracks.total,
          snapshotId: pl.snapshot_id,
          lastSyncedAt: now,
        }).returning().get();

        const count = await syncPlaylistTracks(userId, pl.id, row.id);
        if (count === 0) {
          // solo tenía tracks locales — eliminar
          db.run(sql`DELETE FROM spotify_playlist_tracks WHERE playlist_id = ${row.id}`);
          db.run(sql`DELETE FROM spotify_playlists WHERE id = ${row.id}`);
          continue;
        }
        console.log(`[playlist-sync] + ${pl.name} (${count} tracks)`);
      } else if (existing.snapshot_id !== pl.snapshot_id) {
        // snapshot cambió — actualizar metadata y re-sincronizar tracks
        db.run(sql`
          UPDATE spotify_playlists SET
            name = ${pl.name},
            image_url = ${pl.images?.[0]?.url ?? null},
            owner_name = ${pl.owner.display_name},
            is_algorithmic = ${isAlgorithmic(pl.owner.id) ? 1 : 0},
            track_count = ${pl.tracks.total},
            snapshot_id = ${pl.snapshot_id},
            last_synced_at = ${now},
            updated_at = ${now}
          WHERE id = ${existing.id}
        `);

        const count = await syncPlaylistTracks(userId, pl.id, existing.id);
        console.log(`[playlist-sync] ~ ${pl.name} (${count} tracks, snapshot changed)`);
      } else {
        // sin cambios — solo actualizar timestamp
        db.run(sql`UPDATE spotify_playlists SET last_synced_at = ${now} WHERE id = ${existing.id}`);
      }
    }

    offset += res.items.length;
    if (!res.next) break;
  }

  // eliminar playlists que ya no están en spotify
  const dbPlaylists = db.all(sql`
    SELECT id, spotify_id, name FROM spotify_playlists WHERE user_id = ${userId}
  `) as { id: number; spotify_id: string; name: string }[];

  for (const dbPl of dbPlaylists) {
    if (!seenSpotifyIds.has(dbPl.spotify_id)) {
      db.run(sql`DELETE FROM spotify_playlist_tracks WHERE playlist_id = ${dbPl.id}`);
      db.run(sql`DELETE FROM spotify_playlists WHERE id = ${dbPl.id}`);
      console.log(`[playlist-sync] - ${dbPl.name} (removed)`);
    }
  }

  console.log(`[playlist-sync] usuario ${userId}: ${seenSpotifyIds.size} playlists sincronizadas`);
}

export async function syncAllUsersPlaylists(): Promise<void> {
  const users = getAllActiveUsersWithTokens();
  for (const { userId } of users) {
    try {
      await syncUserPlaylists(userId);
    } catch (err) {
      console.error(`[playlist-sync] error usuario ${userId}:`, err);
    }
  }
}
