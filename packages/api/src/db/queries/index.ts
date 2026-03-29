// tipos y helpers
export type { Db, EntityType, Sort, StatsRow, AggregateRow, SeriesRow, RecentPlayRow } from './helpers.js';
export { getRangeStart, getPreviousPeriodRange, getPreviousPeriodRangeCustom, getDateTrunc, getDateTruncForDays } from './helpers.js';

// queries genéricas de entidad
export { getEntityStats, getTopEntities, getPrevPeriodEntities, getEntitySeries, getGlobalSeries, getRecentPlays } from './entity.js';

// rankings
export { computeRankings, getRankingHistory } from './rankings.js';
export type { RankingHistoryPoint } from './rankings.js';

// queries específicas
export { getArtistTopTracks, getArtistTopAlbums } from './artist.js';
export { resolveAlbumIds, getAlbumArtists, getAlbumTracks } from './album.js';
export { enrichTrack, getTrackAlbumBreakdown } from './track.js';
export { getRecords } from './records.js';
export type { RecordsResponse } from './records.js';
export { getChart, getAvailablePeriods, getEntityChartHistory } from './charts.js';
export type { ChartEntry, ChartResponse, EntityChartHistory } from './charts.js';

// playlist strategies
export { strategyTopRange, strategyTopArtist, strategyTopGenre, strategyDeepCuts, strategyTimeVibes, strategyRediscovery } from './playlists.js';
export type { TopRangeParams, TopArtistParams, TopGenreParams, DeepCutsParams, TimeVibesParams, RediscoveryParams } from './playlists.js';
