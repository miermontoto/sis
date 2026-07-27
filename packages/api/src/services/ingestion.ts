// Barrel re-export del módulo de ingestión, split en sub-archivos por concern:
// - upsert.ts: upsert de track/artist/album + inserción de plays
// - enrichment.ts: enriquecimiento desde Spotify API + MusicBrainz
// - imports.ts: limpieza y resolución de entidades importadas desde Spotify Extended
// - dedup.ts: deduplicación de tracks/álbumes/plays

export { resolveLocalFileIds, upsertTrack, insertLocalPlay, insertPlay, DEDUP_WINDOW_S } from './ingestion/upsert.js';
export { ensureFullAlbumTracks, enrichArtistMetadata, enrichAlbumMetadata, enrichLocalAlbumCovers, enrichImportTrackDurations } from './ingestion/enrichment.js';
export {
  cleanOrphanImports, cleanNonMusicImports,
  resolveImportArtists, resolveImportAlbums,
  fixTrackAlbumAssignments, fixTrackArtistAssociations,
  mergeImportTracks,
} from './ingestion/imports.js';
export { deduplicateTracks, deduplicateAlbums, deduplicateAlbumShells, deduplicateLocalAlbums, cleanDuplicatePlays, cleanBasicExtendedDuplicates } from './ingestion/dedup.js';
