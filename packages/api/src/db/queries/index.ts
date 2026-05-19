// tipos y helpers
export type { Db, EntityType, Sort, StatsRow, AggregateRow, SeriesRow, RecentPlayRow } from './helpers.js';
export { getRangeStart, getPreviousPeriodRange, getPreviousPeriodRangeCustom, getLookbackPreviousPeriodRange, getDateTrunc, getDateTruncForDays, albumIdIn } from './helpers.js';

// queries genéricas de entidad
export { getEntityStats, getTopEntities, getPrevPeriodEntities, getEntitySeries, getGlobalSeries, getRecentPlays, getHistoryPage, deleteHistoryEntries } from './entity.js';

// rankings
export { computeRankings, computeProjectedRankings, computeProjectedRankingsBatch, getRankingHistory, getRankingHistoryWithCrossovers } from './rankings.js';

// queries específicas
export { getArtistTopTracks, getArtistTopAlbums } from './artist.js';
export { getAlbumArtists, getAlbumTracks } from './album.js';
export { enrichTrack, enrichTracksBatch, getTrackAlbumBreakdown } from './track.js';
export { getRecords } from './records.js';
export type { EntityTypeFilter } from './records.js';
export { getChart, getChartPeaks, getAvailablePeriods, getEntityChartHistory } from './charts.js';

// merge (genérico para albums / artists / tracks)
export { resolveEntityIds, getEntityMergeInfo, getEntityMergeGroup } from './merge.js';
export type { MergeInfo } from './merge.js';

// entity formatters
export { lookupArtist, lookupAlbum, formatTopTrackRow, formatTopTrackRows, formatTopArtistRow, formatTopAlbumRow, formatRecentPlay, formatRecentPlays, formatArtistTrackRow, formatArtistTrackRows, formatArtistAlbumRow } from './formatters.js';

// playlist library analytics
export { getLibraryPlaylists, getPlaylistTrackStats, getPlaylistGenres, getPlaylistSeries, getTrackPlaylistPresence, getArtistPlaylistPresence, getAlbumPlaylistPresence } from './playlist-library.js';

// inline queries extraídas de stats.ts
export { getTopGenres, getHeatmap, getMonthlyDistribution, getStreakDays, getDiscoverySeries, searchEntities, lookupArtistById, lookupAlbumById, lookupTrackById, getTrackArtists, getAlbumCovers, setAlbumCover, insertAlbumCover, rebuildPlaylistSearchIndex } from './inline.js';

// playlist strategies
export { strategyTopRange, strategyTopArtist, strategyTopGenre, strategyDeepCuts, strategyTimeVibes, strategyRediscovery, strategyTop, strategyChart, resolveEntitiesToTracks } from './playlists.js';
export type { TopRangeParams, TopArtistParams, TopGenreParams, DeepCutsParams, TimeVibesParams, RediscoveryParams, TopParams, ChartParams } from './playlists.js';
