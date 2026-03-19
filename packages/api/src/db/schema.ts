import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const artists = sqliteTable('artists', {
  spotifyId: text('spotify_id').primaryKey(),
  name: text('name').notNull(),
  genres: text('genres', { mode: 'json' }).$type<string[]>().default([]),
  imageUrl: text('image_url'),
  popularity: integer('popularity'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const albums = sqliteTable('albums', {
  spotifyId: text('spotify_id').primaryKey(),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
  releaseDate: text('release_date'),
  totalTracks: integer('total_tracks'),
  albumType: text('album_type'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const tracks = sqliteTable('tracks', {
  spotifyId: text('spotify_id').primaryKey(),
  name: text('name').notNull(),
  albumId: text('album_id').references(() => albums.spotifyId),
  durationMs: integer('duration_ms').notNull(),
  trackNumber: integer('track_number'),
  explicit: integer('explicit', { mode: 'boolean' }).default(false),
  popularity: integer('popularity'),
  verifiedAlbum: integer('verified_album'),
  verifiedArtists: integer('verified_artists'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const trackArtists = sqliteTable('track_artists', {
  trackId: text('track_id').notNull().references(() => tracks.spotifyId),
  artistId: text('artist_id').notNull().references(() => artists.spotifyId),
  position: integer('position').notNull(),
}, (table) => [
  primaryKey({ columns: [table.trackId, table.artistId] }),
]);

export const listeningHistory = sqliteTable('listening_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trackId: text('track_id').notNull().references(() => tracks.spotifyId),
  playedAt: text('played_at').notNull().unique(),
  contextType: text('context_type'),
  contextUri: text('context_uri'),
  durationPlayedMs: integer('duration_played_ms'),
}, (table) => [
  index('idx_listening_history_played_at').on(table.playedAt),
  index('idx_listening_history_track_id').on(table.trackId),
]);

export const authTokens = sqliteTable('auth_tokens', {
  id: integer('id').primaryKey().default(1),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: text('expires_at').notNull(),
  scope: text('scope'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const pollingState = sqliteTable('polling_state', {
  id: integer('id').primaryKey().default(1),
  lastRecentlyPlayedCursor: text('last_recently_played_cursor'),
  lastPollAt: text('last_poll_at'),
  lastCurrentlyPlayingTrackId: text('last_currently_playing_track_id'),
  lastCurrentlyPlayingAt: text('last_currently_playing_at'),
});
