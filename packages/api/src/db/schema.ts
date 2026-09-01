import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { defineSessionTable } from '@platform/auth';

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

// mbid/isrc: IDs externos estables (musicbrainz / industria) como evidencia de
// identidad multi-fuente. NULL = no consultado, '' = consultado sin resultado.
export const artists = sqliteTable('artists', {
  spotifyId: text('spotify_id').primaryKey(),
  name: text('name').notNull(),
  genres: text('genres', { mode: 'json' }).$type<string[]>().default([]),
  imageUrl: text('image_url'),
  popularity: integer('popularity'),
  mbid: text('mbid'),
  // barrido de fotos: NULL = nunca comprobado. imagePinned marca la elección manual
  // del usuario para que el barrido periódico no la sobrescriba (ver artist_images)
  imageCheckedAt: text('image_checked_at'),
  imagePinned: integer('image_pinned', { mode: 'boolean' }).notNull().default(false),
  // imagen de fondo del detalle, elegida a mano del pool de artist_images.
  // NULL = sin elección: el fondo cae a imageUrl
  backgroundUrl: text('background_url'),
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
  mbid: text('mbid'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const tracks = sqliteTable('tracks', {
  spotifyId: text('spotify_id').primaryKey(),
  name: text('name').notNull(),
  albumId: text('album_id').references(() => albums.spotifyId),
  durationMs: integer('duration_ms').notNull(),
  trackNumber: integer('track_number'),
  discNumber: integer('disc_number'),
  explicit: integer('explicit', { mode: 'boolean' }).default(false),
  popularity: integer('popularity'),
  verifiedAlbum: integer('verified_album'),
  verifiedArtists: integer('verified_artists'),
  isrc: text('isrc'),
  mbid: text('mbid'),
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
  // procedencia: 'spotify' | 'lastfm' | 'import' | clientes futuros. NULL = fila
  // anterior a la columna (fuente no comprobable)
  source: text('source'),
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

// relación "soft" entre dos artistas: enlace simétrico y sin tipo que NO altera el
// tracking (a diferencia de un merge, la relación "hard": ahí un artista se absorbe
// dentro de otro). Sirve para dejar constancia de vínculos como "Julian Casablancas
// ←→ The Strokes", que son el mismo mundo pero no el mismo artista.
// El par se guarda normalizado (artist_a < artist_b) para que el UNIQUE deduplique
// las dos direcciones con un solo índice.
export const artistRelations = sqliteTable('artist_relations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  artistA: text('artist_a').notNull().references(() => artists.spotifyId),
  artistB: text('artist_b').notNull().references(() => artists.spotifyId),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('idx_artist_relations_pair').on(table.userId, table.artistA, table.artistB),
  index('idx_artist_relations_b').on(table.userId, table.artistB),
]);

// valoraciones de álbum por usuario: estrellas enteras (0-5, sin medias) + texto
// opcional. una fila por (user, album); el texto vive en la misma fila porque no
// existe review sin valoración. la lectura resuelve el grupo de merge entero.
export const albumRatings = sqliteTable('album_ratings', {
  userId: integer('user_id').notNull().references(() => users.id),
  albumId: text('album_id').notNull().references(() => albums.spotifyId),
  rating: integer('rating').notNull(),
  review: text('review'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  primaryKey({ columns: [table.userId, table.albumId] }),
]);

// conciertos asistidos por usuario. una fila por (user, artista, fecha); el
// setlist vive en concert_songs. la lectura resuelve el grupo de merge del
// artista, igual que las valoraciones de álbum.
export const concerts = sqliteTable('concerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  artistId: text('artist_id').notNull().references(() => artists.spotifyId),
  concertDate: text('concert_date').notNull(),
  venue: text('venue'),
  city: text('city'),
  country: text('country'),
  tour: text('tour'),
  notes: text('notes'),
  setlistfmId: text('setlistfm_id'),
  setlistfmUrl: text('setlistfm_url'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('idx_concerts_unique').on(table.userId, table.artistId, table.concertDate),
  index('idx_concerts_user_date').on(table.userId, table.concertDate),
  index('idx_concerts_user_artist').on(table.userId, table.artistId),
]);

// canciones del setlist en orden de interpretación. trackId es la resolución
// contra la librería (NULL = el usuario no tiene esa canción): evidencia del
// matching, nunca una clave — de ahí que no lleve FK con cascada.
export const concertSongs = sqliteTable('concert_songs', {
  concertId: integer('concert_id').notNull().references(() => concerts.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  trackId: text('track_id'),
  info: text('info'),
  isEncore: integer('is_encore').notNull().default(0),
  coverArtist: text('cover_artist'),
}, (table) => [
  primaryKey({ columns: [table.concertId, table.position] }),
]);

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
  // auto-regeneración programada: si autoRegenerate, el scheduler reejecuta la
  // estrategia cada regenerateIntervalMs (daily/weekly/monthly). lastRegeneratedAt
  // ancla el cálculo de "próxima ejecución" (fallback a createdAt si null)
  autoRegenerate: integer('auto_regenerate', { mode: 'boolean' }).notNull().default(false),
  regenerateIntervalMs: integer('regenerate_interval_ms'),
  lastRegeneratedAt: text('last_regenerated_at'),
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

// playlists sincronizadas de spotify (biblioteca del usuario)
export const spotifyPlaylists = sqliteTable('spotify_playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  spotifyId: text('spotify_id').notNull(),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
  ownerName: text('owner_name'),
  isOwned: integer('is_owned', { mode: 'boolean' }).default(false),
  isAlgorithmic: integer('is_algorithmic', { mode: 'boolean' }).default(false),
  trackCount: integer('track_count').default(0),
  snapshotId: text('snapshot_id'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('idx_spotify_playlists_user_spotify').on(table.userId, table.spotifyId),
]);

export const spotifyPlaylistTracks = sqliteTable('spotify_playlist_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').notNull().references(() => spotifyPlaylists.id),
  trackId: text('track_id').notNull().references(() => tracks.spotifyId),
  position: integer('position').notNull(),
  addedAt: text('added_at'),
}, (table) => [
  index('idx_spt_playlist_id').on(table.playlistId),
  uniqueIndex('idx_spt_playlist_track').on(table.playlistId, table.trackId),
]);

// tabla canónica de sesiones de la plataforma (@platform/auth). reemplaza a la
// tabla `sessions` legacy (denormalizaba spotifyId/isAdmin); la física vieja queda
// huérfana hasta una migración de limpieza.
export const authSessions = defineSessionTable(() => users.id);

// cuentas last.fm vinculadas (sso + fuente de scrobbles). el cursor y el estado
// de backfill viven aquí y no en polling_state: la integración es opcional por
// usuario y se borra entera al desvincular.
export const lastfmAccounts = sqliteTable('lastfm_accounts', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  username: text('username').notNull().unique(),
  sessionKey: text('session_key'),
  lastScrobbleUts: integer('last_scrobble_uts'),
  backfillDone: integer('backfill_done', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// tokens de scrobbling (API compatible listenbrainz): un token por usuario,
// regenerable. los clientes push (pano scrobbler, web scrobbler…) lo mandan en
// Authorization: Token <x>
export const listenTokens = sqliteTable('listen_tokens', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  lastUsedAt: text('last_used_at'),
});

// cuentas id.mier.info vinculadas (sso propio, oidc). solo identidad: el sub
// es el identificador estable del issuer; username es informativo (ui/logs)
export const mieridAccounts = sqliteTable('mierid_accounts', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  sub: text('sub').notNull().unique(),
  username: text('username'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const pollingState = sqliteTable('polling_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id).unique(),
  lastRecentlyPlayedCursor: text('last_recently_played_cursor'),
  lastPollAt: text('last_poll_at'),
  lastCurrentlyPlayingTrackId: text('last_currently_playing_track_id'),
  lastCurrentlyPlayingAt: text('last_currently_playing_at'),
});

// relación social dirigida (follower → followed), par único
export const follows = sqliteTable('follows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  followerId: integer('follower_id').notNull().references(() => users.id),
  followedId: integer('followed_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('idx_follows_pair').on(table.followerId, table.followedId),
  index('idx_follows_follower').on(table.followerId),
  index('idx_follows_followed').on(table.followedId),
]);

// notificaciones push: tokens de dispositivo (FCM android/ios, PushSubscription web)
// para web el token = JSON.stringify(PushSubscription). FK a users.id (INTEGER).
export const deviceTokens = sqliteTable('device_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  platform: text('platform').notNull(), // 'android' | 'ios' | 'web'
  userAgent: text('user_agent'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  lastActiveAt: text('last_active_at'),
}, (table) => [
  index('idx_device_tokens_user_active').on(table.userId, table.isActive),
]);

// notificaciones push: dedup de envíos. entity_id/period usan '' NOT NULL (no NULL)
// para que el UNIQUE deduplique (SQLite trata los NULL como distintos).
export const sentNotifications = sqliteTable('sent_notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  notificationType: text('notification_type').notNull(),
  entityId: text('entity_id').notNull().default(''),
  period: text('period').notNull().default(''),
  rank: integer('rank'),
  // formato 'YYYY-MM-DD HH:MM:SS' UTC igual que datetime('now') del DDL, para que la
  // comparación de string del throttle (sent_at >= datetime('now','-1 day')) sea correcta
  // aunque se inserte vía drizzle (el runtime usa raw SQL y el default del DDL)
  sentAt: text('sent_at').notNull().$defaultFn(() => new Date().toISOString().slice(0, 19).replace('T', ' ')),
}, (table) => [
  uniqueIndex('idx_sent_notifications_dedup').on(table.userId, table.notificationType, table.entityId, table.period),
]);

// notificaciones push: último periodo procesado por usuario y granularidad, para
// detectar cierres de chart ('week') y el cambio de día de los eventos diarios
// ('day') en el tick de polling sin refirar.
export const notificationPeriodState = sqliteTable('notification_period_state', {
  userId: integer('user_id').notNull(),
  granularity: text('granularity').notNull(), // 'week' | 'day' (extensible a 'month'|'year')
  lastPeriod: text('last_period').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.granularity] }),
]);

// tokens públicos revocables que exponen un snapshot de perfil sin sesión
export const shareLinks = sqliteTable('share_links', {
  token: text('token').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  kind: text('kind').notNull(), // 'profile' (extensible en el futuro)
  range: text('range'), // TimeRange congelado del enlace; null = lo elige el visitante
  label: text('label'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  revokedAt: text('revoked_at'), // soft-revoke; null = activo
  lastAccessedAt: text('last_accessed_at'),
}, (table) => [
  index('idx_share_links_user').on(table.userId),
]);
