import { dbRead } from '../../db/read-pool.js';
import { ensureFullAlbumTracks } from '../../services/ingestion.js';
import { isSyntheticId } from '../../services/ids.js';
import type { MergeInfo } from '../../db/queries/index.js';
import type { TimeRange } from '../../constants.js';
import { statsRouter, parseParams } from './_shared.js';

const detail = statsRouter();

// Formatea MergeInfo del worker al shape que consumen las páginas detail.
function formatMerge(info: MergeInfo) {
  return {
    mergedFrom: info.mergedFrom.map(r => ({ id: r.source_id, ruleId: r.rule_id, name: r.name, imageUrl: r.image_url })),
    mergedInto: info.mergedInto
      ? { id: info.mergedInto.target_id, ruleId: info.mergedInto.rule_id, name: info.mergedInto.name, imageUrl: info.mergedInto.image_url }
      : null,
  };
}

detail.get('/artist/:id', async (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const userId = c.get('userId');
  const trackLimit = Math.min(parseInt(c.req.query('trackLimit') || '10'), 200);
  const albumLimit = Math.min(parseInt(c.req.query('albumLimit') || '5'), 200);

  const artist = await dbRead('lookupArtistById', id);
  if (!artist) return c.json({ error: 'Artist not found' }, 404);

  const artistIds = await dbRead('resolveEntityIds', 'artist', id, userId);

  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;
  const [statsRow, series, topTracksRaw, topAlbumsRaw, recentRaw, playlists, mergeInfo, releasesRaw, relatedRaw] = await Promise.all([
    dbRead('getEntityStats', 'artist', id, rangeStart, rangeEnd, artistIds, userId),
    dbRead('getEntitySeries', 'artist', id, rangeStart, rangeKey, artistIds, rangeEnd, customDays, userId),
    dbRead('getArtistTopTracks', id, rangeStart, sort, trackLimit, rangeEnd, userId, artistIds),
    dbRead('getArtistTopAlbums', id, rangeStart, sort, albumLimit, rangeEnd, userId, artistIds),
    dbRead('getRecentPlays', 'artist', id, 10, artistIds, userId),
    dbRead('getArtistPlaylistPresence', id, userId),
    dbRead('getEntityMergeInfo', 'artist', id),
    dbRead('getArtistReleases', id, artistIds),
    dbRead('getArtistRelations', id, userId),
  ]);

  const [topTracks, topAlbums, recentPlays] = await Promise.all([
    dbRead('formatArtistTrackRows', topTracksRaw),
    Promise.all(topAlbumsRaw.map((row) => dbRead('formatArtistAlbumRow', row))),
    dbRead('formatRecentPlays', recentRaw),
  ]);

  return c.json({
    artist: { id: artist.spotify_id, name: artist.name, imageUrl: artist.image_url, genres: artist.genres },
    stats: statsRow,
    series,
    releases: releasesRaw.map((r) => ({ id: r.id, name: r.name, date: r.date, albumType: r.album_type, imageUrl: r.image_url })),
    topTracks,
    topAlbums,
    recentPlays,
    ...formatMerge(mergeInfo),
    // relaciones soft: ruleIds viene como group_concat porque una misma relación puede
    // resolver a este artista por varias filas (aliases mergeados a posteriori)
    relatedArtists: relatedRaw.map((r) => ({
      id: r.artist_id,
      ruleIds: String(r.rule_ids).split(',').map(Number),
      name: r.name,
      imageUrl: r.image_url,
    })),
    playlists,
  });
});

detail.get('/album/:id', async (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const userId = c.get('userId');

  const album = await dbRead('lookupAlbumById', id);
  if (!album) return c.json({ error: 'Album not found' }, 404);

  // completar el tracklist siempre, no solo en orden natural: el emparejamiento de singles
  // compara contra los nombres de los tracks del álbum, así que un tracklist incompleto (los
  // temas que nunca sonaron desde esta edición no se ingestan) pierde singles de adelanto.
  // ensureFullAlbumTracks sale por un count indexado si ya está completo: sin coste extra.
  try { await ensureFullAlbumTracks(id, album.total_tracks, userId); } catch {}

  const albumIds = await dbRead('resolveEntityIds', 'album', id, userId);

  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;
  const [albumArtistRows, statsRow, series, albumTracks, recentRaw, playlists, mergeInfo, coversRaw, singlesRaw] = await Promise.all([
    dbRead('getAlbumArtists', id, albumIds),
    dbRead('getEntityStats', 'album', id, rangeStart, rangeEnd, albumIds, userId),
    dbRead('getEntitySeries', 'album', id, rangeStart, rangeKey, albumIds, rangeEnd, customDays, userId),
    dbRead('getAlbumTracks', id, rangeStart, sort, albumIds, rangeEnd, userId),
    dbRead('getRecentPlays', 'album', id, 10, albumIds, userId),
    dbRead('getAlbumPlaylistPresence', id, userId),
    dbRead('getEntityMergeInfo', 'album', id),
    dbRead('getAlbumCovers', id),
    // los "singles de adelanto" son un concepto de álbum: un single no los tiene.
    // sin este guard, dos singles que comparten un track (p.ej. un single de 2 temas
    // que incluye el A-side de otro) se listan mutuamente como single de adelanto.
    // un álbum sintético (local:/import:) tampoco los tiene: no es un lanzamiento del
    // catálogo sino un contenedor del usuario (setlist, bootleg, recopilación) cuyos
    // tracks llevan el título del tema original y se acreditan al artista real, así que
    // cumple de oficio las dos heurísticas del emparejamiento (mismo artista + nombre
    // coincidente) y se le colgaría la discografía de singles entera del artista.
    album.album_type === 'single' || isSyntheticId(id)
      ? Promise.resolve([] as any[])
      : dbRead('getAlbumRelatedSingles', id, albumIds, userId),
  ]);

  // artistas reales por track (incluye secundarios/featured) — el álbum comparte cover pero cada track
  // tiene sus propios artistas; enrichTracksBatch los devuelve ordenados por position (0 = principal)
  const [recentPlays, trackArtistMap] = await Promise.all([
    dbRead('formatRecentPlays', recentRaw),
    dbRead('enrichTracksBatch', albumTracks.map((r) => r.track_id)),
  ]);

  // fallback a los artistas del álbum si un track no tiene artistas propios (data quality)
  const albumArtists = albumArtistRows.map((a) => ({ id: a.artist_id, name: a.name }));

  const tracksResult = albumTracks.map((row) => {
    const trackArtists = trackArtistMap.get(row.track_id)?.artists;
    return {
      trackId: row.track_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      track: {
        name: row.name,
        durationMs: row.duration_ms,
        trackNumber: row.track_number,
        album: { id: album.spotify_id, name: album.name, imageUrl: album.image_url },
        artists: trackArtists && trackArtists.length > 0 ? trackArtists : albumArtists,
      },
    };
  });

  return c.json({
    album: {
      id: album.spotify_id, name: album.name, imageUrl: album.image_url,
      releaseDate: album.release_date, totalTracks: album.total_tracks, albumType: album.album_type,
    },
    artists: albumArtistRows.map((a) => ({ id: a.artist_id, name: a.name, imageUrl: a.image_url })),
    stats: statsRow,
    series,
    tracks: tracksResult,
    relatedSingles: singlesRaw.map((r) => ({
      id: r.id, name: r.name, date: r.date, albumType: 'single', imageUrl: r.image_url,
      playCount: r.play_count, totalMs: r.total_ms,
    })),
    recentPlays,
    ...formatMerge(mergeInfo),
    playlists,
    covers: coversRaw.map((r) => ({ id: r.id, imageUrl: r.image_url, source: r.source, observedAt: r.observed_at })),
  });
});

detail.get('/track/:id', async (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, customDays } = parseParams(c);
  const userId = c.get('userId');

  const track = await dbRead('lookupTrackById', id);
  if (!track) return c.json({ error: 'Track not found' }, 404);

  const trackIds = await dbRead('resolveEntityIds', 'track', id, userId);

  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;
  const [albumRaw, arts, statsRow, series, recentRaw, albumBreakdownRaw, playlists, mergeInfo, versions] = await Promise.all([
    track.album_id ? dbRead('lookupAlbumById', track.album_id) : Promise.resolve(null),
    dbRead('getTrackArtists', id),
    dbRead('getEntityStats', 'track', id, rangeStart, rangeEnd, trackIds, userId),
    dbRead('getEntitySeries', 'track', id, rangeStart, rangeKey, trackIds, rangeEnd, customDays, userId),
    dbRead('getRecentPlays', 'track', id, 10, trackIds, userId),
    dbRead('getTrackAlbumBreakdown', id, rangeStart, rangeEnd, userId, trackIds),
    dbRead('getTrackPlaylistPresence', id, userId),
    dbRead('getEntityMergeInfo', 'track', id),
    dbRead('getTrackVersions', id, userId),
  ]);

  const [recentPlays, albumBreakdowns] = await Promise.all([
    dbRead('formatRecentPlays', recentRaw),
    Promise.all(albumBreakdownRaw.map((row) => dbRead('lookupAlbum', row.album_id).then(ab => ({
      albumId: row.album_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      album: ab ? { id: row.album_id, ...ab } : null,
    })))),
  ]);

  return c.json({
    track: {
      id: track.spotify_id, name: track.name, durationMs: track.duration_ms,
      trackNumber: track.track_number, explicit: track.explicit,
      album: albumRaw ? { id: albumRaw.spotify_id, name: albumRaw.name, imageUrl: albumRaw.image_url, releaseDate: albumRaw.release_date, albumType: albumRaw.album_type } : null,
      artists: arts.map((a) => ({ id: a.spotify_id, name: a.name, imageUrl: a.image_url })),
    },
    stats: statsRow,
    series,
    dailySeries: series.map((s) => ({ day: s.period, play_count: s.play_count, total_ms: s.total_ms })),
    albumBreakdown: albumBreakdowns.filter((r) => r.album),
    recentPlays,
    ...formatMerge(mergeInfo),
    playlists,
    versions,
  });
});

detail.get('/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2) return c.json({ error: 'query too short' }, 400);

  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 20);
  const term = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const userId = c.get('userId');

  return c.json(await dbRead('searchEntities', term, limit, userId));
});

export default detail;
