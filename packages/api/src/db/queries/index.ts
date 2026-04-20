// tipos y helpers
export type { Db, EntityType, Sort, StatsRow, AggregateRow, SeriesRow, RecentPlayRow } from './helpers.js';
export { getRangeStart, getPreviousPeriodRange, getPreviousPeriodRangeCustom, getDateTrunc, getDateTruncForDays, albumIdIn } from './helpers.js';

// queries genéricas de entidad
export { getEntityStats, getTopEntities, getPrevPeriodEntities, getEntitySeries, getGlobalSeries, getRecentPlays, getHistoryPage, deleteHistoryEntries } from './entity.js';

// rankings
export { computeRankings, getRankingHistory } from './rankings.js';

// queries específicas
export { getArtistTopTracks, getArtistTopAlbums } from './artist.js';
export { resolveAlbumIds, getAlbumArtists, getAlbumTracks } from './album.js';
export { enrichTrack, enrichTracksBatch, getTrackAlbumBreakdown } from './track.js';
export { getRecords } from './records.js';
export type { EntityTypeFilter } from './records.js';
export { getChart, getChartPeaks, getAvailablePeriods, getEntityChartHistory } from './charts.js';

// entity formatters
export { lookupArtist, lookupAlbum, formatTopTrackRow, formatTopTrackRows, formatTopArtistRow, formatTopAlbumRow, formatRecentPlay, formatRecentPlays, formatArtistTrackRow, formatArtistTrackRows, formatArtistAlbumRow } from './formatters.js';

// playlist library analytics
export { getLibraryPlaylists, getPlaylistTrackStats, getPlaylistGenres, getPlaylistSeries, getTrackPlaylistPresence, getArtistPlaylistPresence, getAlbumPlaylistPresence } from './playlist-library.js';

// inline queries extraídas de stats.ts
export { getTopGenres, getHeatmap, getStreakDays, searchEntities, getAlbumMergeInfo, lookupArtistById, lookupAlbumById, lookupTrackById, getTrackArtists, getAlbumCovers, setAlbumCover, insertAlbumCover } from './inline.js';

// playlist strategies
export { strategyTopRange, strategyTopArtist, strategyTopGenre, strategyDeepCuts, strategyTimeVibes, strategyRediscovery } from './playlists.js';
export type { TopRangeParams, TopArtistParams, TopGenreParams, DeepCutsParams, TimeVibesParams, RediscoveryParams } from './playlists.js';
