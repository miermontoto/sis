import type { Context } from 'hono';
import { dbRead } from '../../db/read-pool.js';
import { ensureFullAlbumTracks } from '../../services/ingestion.js';
import { isSyntheticId } from '../../services/ids.js';
import { hydrateConcerts } from '../../services/concerts.js';
import { getRangeStart } from '../../db/queries/index.js';
import type { MergeInfo, RelatedArtistRow, EntityType } from '../../db/queries/index.js';
import type { EntityCard, EntityRelation } from '@sis/shared';
import { parseCollectionKey } from '@sis/shared';
import type { TimeRange } from '../../constants.js';
import { TIME_RANGES, HOVER_CARD_SERIES_RANGE, HOVER_CARD_SERIES_BUCKET_DAYS, SERIES_BATCH_LIMIT } from '../../constants.js';
import { statsRouter, parseParams } from './_shared.js';

const detail = statsRouter();

// Merges (hard) + relaciones soft del artista en una sola lista, con las escuchas de
// cada punta. Las pinta la misma sección del detalle, así que se resuelven juntas: una
// query de stats para todas las filas en vez de una por fila.
async function buildRelations(
  type: EntityType,
  info: MergeInfo,
  userId: number,
  related: RelatedArtistRow[] = [],
): Promise<EntityRelation[]> {
  // el orden es el de la sección: primero dónde vive esta página, luego lo que absorbe,
  // luego lo declarado a mano
  const links = [
    ...(info.mergedInto
      ? [{ kind: 'alias' as const, id: info.mergedInto.target_id, name: info.mergedInto.name, imageUrl: info.mergedInto.image_url, ruleIds: [info.mergedInto.rule_id] }]
      : []),
    ...info.mergedFrom.map(r => ({ kind: 'absorbed' as const, id: r.source_id, name: r.name, imageUrl: r.image_url, ruleIds: [r.rule_id] })),
    // ruleIds viene como group_concat: una misma relación puede resolver a este artista
    // por varias filas (aliases mergeados a posteriori) y deshacerla las borra todas
    ...related.map(r => ({ kind: 'related' as const, id: r.artist_id, name: r.name, imageUrl: r.image_url, ruleIds: String(r.rule_ids).split(',').map(Number) })),
  ];
  if (links.length === 0) return [];

  const stats = await dbRead('getRelationStats', type, links.map(l => l.id), userId);
  const byId = new Map(stats.map(row => [row.entity_id, row]));
  return links.map(l => ({
    ...l,
    playCount: byId.get(l.id)?.play_count ?? 0,
    totalMs: byId.get(l.id)?.total_ms ?? 0,
  }));
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
  const [statsRow, series, topTracksRaw, topAlbumsRaw, recentRaw, playlists, mergeInfo, releasesRaw, relatedRaw, imagesRaw, concertRows] = await Promise.all([
    dbRead('getEntityStats', 'artist', id, rangeStart, rangeEnd, artistIds, userId),
    dbRead('getEntitySeries', 'artist', id, rangeStart, rangeKey, artistIds, rangeEnd, customDays, userId),
    dbRead('getArtistTopTracks', id, rangeStart, sort, trackLimit, rangeEnd, userId, artistIds),
    dbRead('getArtistTopAlbums', id, rangeStart, sort, albumLimit, rangeEnd, userId, artistIds),
    dbRead('getRecentPlays', 'artist', id, 10, artistIds, userId),
    dbRead('getArtistPlaylistPresence', id, userId),
    dbRead('getEntityMergeInfo', 'artist', id, userId),
    dbRead('getArtistReleases', id, artistIds),
    dbRead('getArtistRelations', id, userId),
    dbRead('getArtistImages', id),
    // conciertos del grupo de merge: doblan como marcadores de las gráficas,
    // igual que los releases, así que viajan con el detalle en vez de en una
    // segunda petición
    dbRead('getConcerts', userId, artistIds),
  ]);

  // colecciones del grupo de merge: son del artista, como los conciertos, y su
  // sección vive en el mismo detalle
  const collections = await dbRead('getArtistCollections', artistIds, userId);

  const [topTracks, topAlbums, recentPlays, concerts, relations] = await Promise.all([
    dbRead('formatArtistTrackRows', topTracksRaw),
    Promise.all(topAlbumsRaw.map((row) => dbRead('formatArtistAlbumRow', row))),
    dbRead('formatRecentPlays', recentRaw),
    hydrateConcerts(userId, concertRows),
    buildRelations('artist', mergeInfo, userId, relatedRaw),
  ]);

  return c.json({
    artist: { id: artist.spotify_id, name: artist.name, imageUrl: artist.image_url, backgroundUrl: artist.background_url, genres: artist.genres },
    images: imagesRaw.map((r) => ({ id: r.id, imageUrl: r.image_url, source: r.source, observedAt: r.observed_at })),
    stats: statsRow,
    series,
    releases: releasesRaw.map((r) => ({ id: r.id, name: r.name, date: r.date, albumType: r.album_type, imageUrl: r.image_url })),
    topTracks,
    topAlbums,
    recentPlays,
    relations,
    playlists,
    concerts,
    collections,
  });
});

// listas top de la página de artista servidas aparte: el botón "show all" solo cambia
// su propia sección, y refrescar el detalle entero rehacía stats/series/relaciones y
// devolvía una `series` nueva que repintaba las gráficas desde cero.
detail.get('/artist/:id/top/:kind', async (c) => {
  const id = c.req.param('id');
  const kind = c.req.param('kind');
  if (kind !== 'tracks' && kind !== 'albums') return c.json({ error: 'Invalid kind' }, 400);

  const { limit, rangeStart, rangeEnd, sort } = parseParams(c);
  const userId = c.get('userId');
  const artistIds = await dbRead('resolveEntityIds', 'artist', id, userId);

  if (kind === 'tracks') {
    const rows = await dbRead('getArtistTopTracks', id, rangeStart, sort, limit, rangeEnd, userId, artistIds);
    return c.json(await dbRead('formatArtistTrackRows', rows));
  }
  const rows = await dbRead('getArtistTopAlbums', id, rangeStart, sort, limit, rangeEnd, userId, artistIds);
  return c.json(await Promise.all(rows.map((row) => dbRead('formatArtistAlbumRow', row))));
});

// Detalle de una colección con la MISMA forma que el de un álbum (AlbumDetail): la
// página es la misma, y así hereda portada, color, valoración, secciones y ajustes sin
// una vista paralela. Sólo cambia el origen de las cifras — el alcance de sus miembros —
// y el añadido de `members`.
async function albumDetailForCollection(
  c: Context,
  collectionId: number,
  album: { spotify_id: string; name: string; image_url: string | null; release_date: string | null; total_tracks: number | null; album_type: string | null; color: string | null },
  userId: number,
) {
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;

  const [summary, members, statsRow, series, collectionTracks, recentRaw, coversRaw, ratingRow] = await Promise.all([
    dbRead('getCollectionSummary', collectionId, userId),
    dbRead('getCollectionMembers', collectionId, userId),
    dbRead('getCollectionStats', collectionId, rangeStart, rangeEnd, userId),
    dbRead('getCollectionSeries', collectionId, rangeStart, rangeKey, rangeEnd, customDays, userId),
    dbRead('getCollectionTracks', collectionId, rangeStart, sort, rangeEnd, userId),
    dbRead('getCollectionRecentPlays', collectionId, 10, userId),
    dbRead('getAlbumCovers', album.spotify_id),
    dbRead('getAlbumRating', [album.spotify_id], userId),
  ]);
  if (!summary) return c.json({ error: 'Album not found' }, 404);

  // los temas vienen de varios álbumes, así que cada fila necesita su carátula y sus
  // créditos propios: enrichTracksBatch los resuelve en dos queries para todo el lote
  const [recentPlays, trackMap] = await Promise.all([
    dbRead('formatRecentPlays', recentRaw),
    dbRead('enrichTracksBatch', collectionTracks.map((r) => r.track_id)),
  ]);

  return c.json({
    album: {
      id: album.spotify_id, name: album.name, imageUrl: album.image_url,
      releaseDate: album.release_date, totalTracks: album.total_tracks, albumType: album.album_type,
      color: album.color,
    },
    artists: [{ id: summary.artistId, name: summary.artistName, imageUrl: null }],
    stats: statsRow,
    series,
    tracks: collectionTracks.map((row) => ({
      trackId: row.track_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      track: trackMap.get(row.track_id) ?? null,
    })),
    // una colección no tiene singles de adelanto ni merges: no es un lanzamiento
    relatedSingles: [],
    recentPlays,
    relations: [],
    playlists: [],
    covers: coversRaw.map((r) => ({ id: r.id, imageUrl: r.image_url, source: r.source, observedAt: r.observed_at })),
    rating: ratingRow ? { rating: ratingRow.rating, review: ratingRow.review, updatedAt: ratingRow.updated_at } : null,
    collection: null,
    members,
    notes: summary.notes,
  });
}

detail.get('/album/:id', async (c) => {
  const id = c.req.param('id');
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const userId = c.get('userId');

  const album = await dbRead('lookupAlbumById', id);
  if (!album) return c.json({ error: 'Album not found' }, 404);

  // un álbum lógico tiene su fila en `albums` como cualquier otro, así que llega hasta
  // aquí y se sirve con la misma forma: lo único que cambia es de dónde salen los plays
  // (de sus miembros, que él no tiene temas) y que lleva la lista de miembros
  const collectionId = parseCollectionKey(id);
  if (collectionId !== null) return albumDetailForCollection(c, collectionId, album, userId);

  // completar el tracklist siempre, no solo en orden natural: el emparejamiento de singles
  // compara contra los nombres de los tracks del álbum, así que un tracklist incompleto (los
  // temas que nunca sonaron desde esta edición no se ingestan) pierde singles de adelanto.
  // ensureFullAlbumTracks sale por un count indexado si ya está completo: sin coste extra.
  try { await ensureFullAlbumTracks(id, album.total_tracks, userId); } catch {}

  const albumIds = await dbRead('resolveEntityIds', 'album', id, userId);

  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;
  const [albumArtistRows, statsRow, series, albumTracks, recentRaw, playlists, mergeInfo, coversRaw, ratingRow, singlesRaw] = await Promise.all([
    dbRead('getAlbumArtists', id, albumIds),
    dbRead('getEntityStats', 'album', id, rangeStart, rangeEnd, albumIds, userId),
    dbRead('getEntitySeries', 'album', id, rangeStart, rangeKey, albumIds, rangeEnd, customDays, userId),
    dbRead('getAlbumTracks', id, rangeStart, sort, albumIds, rangeEnd, userId),
    dbRead('getRecentPlays', 'album', id, 10, albumIds, userId),
    dbRead('getAlbumPlaylistPresence', id, userId),
    dbRead('getEntityMergeInfo', 'album', id, userId),
    dbRead('getAlbumCovers', id),
    dbRead('getAlbumRating', albumIds, userId),
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
  const [recentPlays, trackArtistMap, relations, collectionRefs] = await Promise.all([
    dbRead('formatRecentPlays', recentRaw),
    dbRead('enrichTracksBatch', albumTracks.map((r) => r.track_id)),
    buildRelations('album', mergeInfo, userId),
    // el álbum puede estar dentro de una colección, que es quien lo representa en los
    // rankings: la página lo dice y apaga sus badges de ranking (ver el cliente)
    dbRead('getCollectionRefs', 'album', albumIds, userId),
  ]);
  const collection = albumIds.map(aid => collectionRefs.get(aid)).find(Boolean) ?? null;

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
        album: { id: album.spotify_id, name: album.name, imageUrl: album.image_url, color: album.color },
        artists: trackArtists && trackArtists.length > 0 ? trackArtists : albumArtists,
      },
    };
  });

  return c.json({
    album: {
      id: album.spotify_id, name: album.name, imageUrl: album.image_url,
      releaseDate: album.release_date, totalTracks: album.total_tracks, albumType: album.album_type,
      color: album.color,
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
    relations,
    playlists,
    covers: coversRaw.map((r) => ({ id: r.id, imageUrl: r.image_url, source: r.source, observedAt: r.observed_at })),
    rating: ratingRow ? { rating: ratingRow.rating, review: ratingRow.review, updatedAt: ratingRow.updated_at } : null,
    collection,
  });
});

// Detalle de una colección ("álbum lógico"): las mismas secciones que un álbum, pero
// el alcance son sus miembros. El id es numérico y la ruta va restringida (`[0-9]+`)
// para no solaparse con nada: las claves `collection:N` sólo viven en el espacio de ids
// de álbum de los rankings, nunca en la URL.
detail.get('/collection/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const { range, rangeStart, rangeEnd, sort, customDays } = parseParams(c);
  const userId = c.get('userId');

  const collection = await dbRead('getCollectionSummary', id, userId);
  if (!collection) return c.json({ error: 'Collection not found' }, 404);

  const rangeKey = range === 'custom' ? 'all' : range as TimeRange;
  const [members, statsRow, series, collectionTracks, recentRaw] = await Promise.all([
    dbRead('getCollectionMembers', id, userId),
    dbRead('getCollectionStats', id, rangeStart, rangeEnd, userId),
    dbRead('getCollectionSeries', id, rangeStart, rangeKey, rangeEnd, customDays, userId),
    dbRead('getCollectionTracks', id, rangeStart, sort, rangeEnd, userId),
    dbRead('getCollectionRecentPlays', id, 10, userId),
  ]);

  // los temas vienen de varios álbumes, así que cada fila necesita su propia carátula
  // y sus créditos: enrichTracksBatch los resuelve en dos queries para todo el lote
  const [recentPlays, trackMap] = await Promise.all([
    dbRead('formatRecentPlays', recentRaw),
    dbRead('enrichTracksBatch', collectionTracks.map((r) => r.track_id)),
  ]);

  return c.json({
    collection,
    members,
    stats: statsRow,
    series,
    tracks: collectionTracks.map((row) => ({
      trackId: row.track_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      track: trackMap.get(row.track_id) ?? null,
    })),
    recentPlays,
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
  const [albumRaw, arts, statsRow, series, recentRaw, albumBreakdownRaw, playlists, mergeInfo, versions, liveConcertRows] = await Promise.all([
    track.album_id ? dbRead('lookupAlbumById', track.album_id) : Promise.resolve(null),
    dbRead('getTrackArtists', id),
    dbRead('getEntityStats', 'track', id, rangeStart, rangeEnd, trackIds, userId),
    dbRead('getEntitySeries', 'track', id, rangeStart, rangeKey, trackIds, rangeEnd, customDays, userId),
    dbRead('getRecentPlays', 'track', id, 10, trackIds, userId),
    dbRead('getTrackAlbumBreakdown', id, rangeStart, rangeEnd, userId, trackIds),
    dbRead('getTrackPlaylistPresence', id, userId),
    dbRead('getEntityMergeInfo', 'track', id, userId),
    dbRead('getTrackVersions', id, userId),
    // conciertos donde este tema sonó: alimenta el badge de "escuchado en directo"
    dbRead('getTrackLiveConcerts', userId, trackIds),
  ]);

  const [recentPlays, albumBreakdowns, relations, collectionRefs] = await Promise.all([
    dbRead('formatRecentPlays', recentRaw),
    Promise.all(albumBreakdownRaw.map((row) => dbRead('lookupAlbum', row.album_id).then(ab => ({
      albumId: row.album_id,
      playCount: row.play_count,
      totalMs: row.total_ms,
      album: ab ? { id: row.album_id, ...ab } : null,
    })))),
    buildRelations('track', mergeInfo, userId),
    dbRead('getCollectionRefs', 'track', trackIds, userId),
  ]);
  const collection = trackIds.map(tid => collectionRefs.get(tid)).find(Boolean) ?? null;

  return c.json({
    track: {
      id: track.spotify_id, name: track.name, durationMs: track.duration_ms,
      trackNumber: track.track_number, explicit: track.explicit,
      album: albumRaw ? { id: albumRaw.spotify_id, name: albumRaw.name, imageUrl: albumRaw.image_url, releaseDate: albumRaw.release_date, albumType: albumRaw.album_type, color: albumRaw.color } : null,
      artists: arts.map((a) => ({ id: a.spotify_id, name: a.name, imageUrl: a.image_url })),
    },
    stats: statsRow,
    series,
    dailySeries: series.map((s) => ({ day: s.period, play_count: s.play_count, total_ms: s.total_ms })),
    albumBreakdown: albumBreakdowns.filter((r) => r.album),
    recentPlays,
    relations,
    playlists,
    versions,
    liveConcerts: liveConcertRows.map((r) => ({
      id: r.id,
      artistId: r.artist_id,
      artistName: r.artist_name,
      date: r.concert_date,
      venue: r.venue,
      city: r.city,
    })),
    collection,
  });
});

// Campos propios de cada tipo de la tarjeta de hover. `entityIds` viene resuelto
// para que los créditos de un álbum mergeado salgan del grupo entero, igual que
// en su página de detalle.
async function cardMeta(type: EntityCard['type'], id: string, entityIds: string[]) {
  if (type === 'artist') {
    // lookupArtist va por el query builder de drizzle, que sí parsea la columna
    // json de géneros (el lookup por sql crudo la devolvería como texto)
    const artist = await dbRead('lookupArtist', id);
    return artist && { name: artist.name, imageUrl: artist.imageUrl, genres: artist.genres };
  }

  if (type === 'album') {
    const album = await dbRead('lookupAlbumById', id);
    if (!album) return null;
    const artists = await dbRead('getAlbumArtists', id, entityIds);
    return {
      name: album.name,
      imageUrl: album.image_url,
      artists: artists.map((a) => a.name),
      releaseDate: album.release_date,
      totalTracks: album.total_tracks,
    };
  }

  const track = await dbRead('lookupTrackById', id);
  if (!track) return null;
  const [artists, album] = await Promise.all([
    dbRead('getTrackArtists', id),
    track.album_id ? dbRead('lookupAlbumById', track.album_id) : Promise.resolve(undefined),
  ]);
  return {
    name: track.name,
    imageUrl: album?.image_url ?? null,
    artists: artists.map((a) => a.name),
    albumName: album?.name ?? null,
    durationMs: track.duration_ms,
  };
}

// Tarjeta compacta que se abre al pasar el ratón por cualquier enlace de entidad.
// Deliberadamente barata: metadata + stats + serie, todo indexado por entidad. El
// rank NO va aquí — es un scan del historial y vive en /stats/rankings/:type/:id,
// que la tarjeta pide aparte para no bloquear lo demás detrás de él.
detail.get('/card/:type/:id', async (c) => {
  const type = c.req.param('type') as EntityCard['type'];
  if (type !== 'track' && type !== 'album' && type !== 'artist') return c.json({ error: 'Invalid type' }, 400);
  const id = c.req.param('id');
  const userId = c.get('userId');

  const seriesStart = getRangeStart(HOVER_CARD_SERIES_RANGE);

  // una colección viaja por el eje álbum, así que llega aquí como `collection:N` desde
  // cualquier fila de ranking. Sin esta rama el lookup no encontraba fila en `albums` y
  // la tarjeta salía 404: un hueco en blanco justo en las listas donde más se asoma
  const collectionId = parseCollectionKey(id);
  if (type === 'album' && collectionId !== null) {
    const [summary, stats, series] = await Promise.all([
      dbRead('getCollectionSummary', collectionId, userId),
      dbRead('getCollectionStats', collectionId, null, null, userId),
      dbRead('getCollectionSeries', collectionId, seriesStart, HOVER_CARD_SERIES_RANGE, null, HOVER_CARD_SERIES_BUCKET_DAYS, userId),
    ]);
    if (!summary) return c.json({ error: 'Not found' }, 404);
    const card: EntityCard = {
      type, id,
      name: summary.name,
      imageUrl: summary.imageUrl,
      artists: summary.artistName ? [summary.artistName] : [],
      genres: [], albumName: null, durationMs: null,
      releaseDate: null,
      // "pistas" de una colección son sus miembros: es la cifra que la describe
      totalTracks: summary.albumCount + summary.trackCount,
      playCount: stats.play_count,
      totalMs: stats.total_ms,
      firstPlayed: stats.first_played,
      lastPlayed: stats.last_played,
      series: series.map((s) => ({ day: s.period, playCount: s.play_count, totalMs: s.total_ms })),
      seriesDays: TIME_RANGES[HOVER_CARD_SERIES_RANGE],
    };
    return c.json(card);
  }

  const entityIds = await dbRead('resolveEntityIds', type, id, userId);
  const [meta, stats, series] = await Promise.all([
    cardMeta(type, id, entityIds),
    dbRead('getEntityStats', type, id, null, null, entityIds, userId),
    dbRead('getEntitySeries', type, id, seriesStart, HOVER_CARD_SERIES_RANGE, entityIds, null, HOVER_CARD_SERIES_BUCKET_DAYS, userId),
  ]);
  if (!meta) return c.json({ error: 'Not found' }, 404);

  const card: EntityCard = {
    type,
    id,
    // los campos que no aplican al tipo quedan en su valor neutro: cardMeta sólo
    // pisa los suyos al desparramarse encima
    artists: [],
    genres: [],
    albumName: null,
    durationMs: null,
    releaseDate: null,
    totalTracks: null,
    ...meta,
    playCount: stats.play_count,
    totalMs: stats.total_ms,
    firstPlayed: stats.first_played,
    lastPlayed: stats.last_played,
    series: series.map((s) => ({ day: s.period, playCount: s.play_count, totalMs: s.total_ms })),
    seriesDays: TIME_RANGES[HOVER_CARD_SERIES_RANGE],
  };
  return c.json(card);
});

detail.get('/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2) return c.json({ error: 'query too short' }, 400);

  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 20);
  const term = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const userId = c.get('userId');

  return c.json(await dbRead('searchEntities', term, limit, userId));
});

// series de un lote de entidades del mismo tipo (velocity chart de las listas top):
// una petición por lote en vez de N detalles, con los mismos params de rango que
// el resto de /stats. Respuesta: id → serie, con el id tal cual se pidió
detail.get('/series-batch', async (c) => {
  const type = c.req.query('type');
  if (type !== 'track' && type !== 'album' && type !== 'artist') return c.json({ error: 'invalid type' }, 400);
  const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean).slice(0, SERIES_BATCH_LIMIT);
  if (ids.length === 0) return c.json({});
  const { range, rangeStart, rangeEnd, customDays } = parseParams(c);
  const rangeKey = range === 'custom' ? 'all' : range;
  return c.json(await dbRead('getEntitySeriesBatch', type, ids, rangeStart, rangeKey, rangeEnd, customDays, c.get('userId')));
});

export default detail;
