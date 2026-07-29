// lógica de auto-merge de tracks compartida por el preview de un álbum suelto y el
// barrido masivo del top N. El contexto (reglas existentes, play counts, sources por
// álbum) se carga UNA vez y se reutiliza: el barrido toca cientos de álbumes y repetir
// esas agregaciones por álbum era el grueso del coste.
import { sql } from 'drizzle-orm';
import { autoMatchTracks, autoDedupTracks, type DedupCandidate } from './_shared.js';
import type { getDb } from '../../db/connection.js';
import type { AlbumMergeTrack, RemergePreviewPair } from '@sis/shared';

type Db = ReturnType<typeof getDb>;

export interface RemergeContext {
  // tracks que ya son source de una regla: quedan fuera del pool, ya están fusionados
  mergedTrackIds: Set<string>;
  // tracks que ya son target: pueden recibir merges pero no convertirse en source
  mergeTargetIds: Set<string>;
  playCounts: Map<string, number>;
  // álbumes source por álbum target, para el pass cruzado
  albumSources: Map<string, { id: string; name: string }[]>;
}

export function loadRemergeContext(db: Db, userId: number): RemergeContext {
  const trackRules = db.all(sql`
    SELECT source_id, target_id FROM merge_rules
    WHERE entity_type = 'track' AND user_id = ${userId}
  `) as { source_id: string; target_id: string }[];

  const plays = db.all(sql`
    SELECT track_id, COUNT(*) as play_count FROM listening_history
    WHERE user_id = ${userId} GROUP BY track_id
  `) as { track_id: string; play_count: number }[];

  const albumRules = db.all(sql`
    SELECT mr.target_id, mr.source_id, a.name
    FROM merge_rules mr
    JOIN albums a ON a.spotify_id = mr.source_id
    WHERE mr.entity_type = 'album' AND mr.user_id = ${userId}
  `) as { target_id: string; source_id: string; name: string }[];

  const albumSources = new Map<string, { id: string; name: string }[]>();
  for (const r of albumRules) {
    albumSources.set(r.target_id, [...(albumSources.get(r.target_id) ?? []), { id: r.source_id, name: r.name }]);
  }

  return {
    mergedTrackIds: new Set(trackRules.map(r => r.source_id)),
    mergeTargetIds: new Set(trackRules.map(r => r.target_id)),
    playCounts: new Map(plays.map(p => [p.track_id, p.play_count])),
    albumSources,
  };
}

const albumTracks = (db: Db, albumId: string, albumName: string, ctx: RemergeContext): DedupCandidate[] =>
  (db.all(sql`
    SELECT t.spotify_id as id, t.name, t.track_number, t.disc_number, t.duration_ms
    FROM tracks t WHERE t.album_id = ${albumId}
    ORDER BY COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 9999) ASC, t.name ASC
  `) as { id: string; name: string; track_number: number | null; disc_number: number | null; duration_ms: number }[])
    .filter(t => !ctx.mergedTrackIds.has(t.id))
    .map(t => ({
      id: t.id, name: t.name, trackNumber: t.track_number, discNumber: t.disc_number,
      durationMs: t.duration_ms, albumId, albumName,
      playCount: ctx.playCounts.get(t.id) ?? 0,
      isMergeTarget: ctx.mergeTargetIds.has(t.id),
    }));

const asMergeTrack = (t: DedupCandidate): AlbumMergeTrack =>
  ({ id: t.id, name: t.name, trackNumber: t.trackNumber, discNumber: t.discNumber, durationMs: t.durationMs });

/** Candidatos de merge para un álbum: pass cruzado contra sus álbumes ya fusionados
 *  (posición / similitud de nombre) + pass de dedup sobre todo el grupo, que además
 *  compara entre sí las pistas de un mismo álbum. */
export function buildAlbumRemerge(db: Db, albumId: string, albumName: string, ctx: RemergeContext) {
  const sourceRows = ctx.albumSources.get(albumId) ?? [];
  const targetTracks = albumTracks(db, albumId, albumName, ctx);
  const sourceAlbums = sourceRows.map(sa => ({ ...sa, tracks: albumTracks(db, sa.id, sa.name, ctx) }));

  const pairs: RemergePreviewPair[] = [];
  const usedTargetIds = new Set<string>();
  const usedSourceIds = new Set<string>();

  // pass 1: emparejar cada álbum source con el target por posición / similitud de nombre.
  // Un track que ya es target de otra regla no puede proponerse como source: batch-merge
  // lo rechazaría con source_is_target, así que se descarta antes de ofrecerlo.
  for (const sa of sourceAlbums) {
    const availableSources = sa.tracks.filter(t => !t.isMergeTarget);
    const availableTargets = targetTracks.filter(t => !usedTargetIds.has(t.id));
    const matches = autoMatchTracks(availableSources, availableTargets);

    for (const m of matches) {
      const st = availableSources.find(t => t.id === m.sourceTrackId)!;
      const tt = targetTracks.find(t => t.id === m.targetTrackId)!;
      pairs.push({ sourceTrack: asMergeTrack(st), targetTrack: asMergeTrack(tt), sourceAlbumName: sa.name, confidence: m.confidence });
      usedTargetIds.add(m.targetTrackId);
      usedSourceIds.add(m.sourceTrackId);
    }
  }

  // pass 2: dedup sobre todo el grupo (target + sources). Se excluyen los ya emparejados
  // arriba y los targets del pass 1 se marcan como isMergeTarget para que no acaben siendo
  // source de un merge encadenado.
  const dedupPool = [...targetTracks, ...sourceAlbums.flatMap(sa => sa.tracks)]
    .filter(t => !usedSourceIds.has(t.id))
    .map(t => ({ ...t, isMergeTarget: t.isMergeTarget || usedTargetIds.has(t.id) }));

  for (const { source, target } of autoDedupTracks(dedupPool, albumId)) {
    pairs.push({
      sourceTrack: asMergeTrack(source),
      targetTrack: asMergeTrack(target),
      sourceAlbumName: source.albumName,
      confidence: 'duplicate',
    });
  }

  return { pairs, sourceAlbums: sourceRows.map(r => ({ id: r.id, name: r.name })) };
}
