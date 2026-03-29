import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spotifyId: text('spotify_id').notNull().unique(),
  displayName: text('display_name'),
  imageUrl: text('image_url'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

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
  artistIds: text('artist_ids', { mode: 'json' }).$type<string[]>(),
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
  playedAt: text('played_at').notNull(),
  userId: integer('user_id').references(() => users.id),
  contextType: text('context_type'),
  contextUri: text('context_uri'),
  durationPlayedMs: integer('duration_played_ms'),
}, (table) => [
  uniqueIndex('idx_listening_history_user_played_at').on(table.userId, table.playedAt),
  index('idx_listening_history_played_at').on(table.playedAt),
  index('idx_listening_history_track_id').on(table.trackId),
  index('idx_listening_history_user_id').on(table.userId),
]);

export const authTokens = sqliteTable('auth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id).unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: text('expires_at').notNull(),
  scope: text('scope'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const mergeRules = sqliteTable('merge_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  entityType: text('entity_type').notNull(), // 'album' (extensible a 'track' en el futuro)
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.userId, table.key] }),
]);

// playlists generadas por el usuario
export const generatedPlaylists = sqliteTable('generated_playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  spotifyPlaylistId: text('spotify_playlist_id'),
  name: text('name').notNull(),
  strategy: text('strategy').notNull(), // 'top_tracks' | 'deep_cuts' | 'time_vibes' | 'rediscovery'
  params: text('params', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  trackCount: integer('track_count').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('idx_generated_playlists_user_id').on(table.userId),
]);

export const generatedPlaylistTracks = sqliteTable('generated_playlist_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').notNull().references(() => generatedPlaylists.id),
  trackId: text('track_id').notNull().references(() => tracks.spotifyId),
  position: integer('position').notNull(),
}, (table) => [
  index('idx_gpt_playlist_id').on(table.playlistId),
]);

export const pollingState = sqliteTable('polling_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id).unique(),
  lastRecentlyPlayedCursor: text('last_recently_played_cursor'),
  lastPollAt: text('last_poll_at'),
  lastCurrentlyPlayingTrackId: text('last_currently_playing_track_id'),
  lastCurrentlyPlayingAt: text('last_currently_playing_at'),
});
