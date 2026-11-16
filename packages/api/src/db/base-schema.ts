// las tablas base de sis, tal como están en producción. nacieron en migraciones de drizzle
// cuyos .sql se borraron, así que migrate() nunca aplicaba nada y en una bd nueva no existían:
// la instancia arrancaba y escuchaba, pero toda query sobre ellas daba `no such table`.
// CREATE ... IF NOT EXISTS no hace nada en una instancia que ya las tiene.
//
// una columna nueva sigue yendo como ALTER en legacy-ddl.ts, que es lo único que llega a las
// instancias existentes; si además se añade aquí, una instalación nueva nace igual que ellas.
// `sessions` y `__drizzle_migrations` no están a propósito: nada las lee.
export const BASE_TABLES = `
  CREATE TABLE IF NOT EXISTS artists (
    spotify_id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    genres text DEFAULT '[]',
    image_url text,
    popularity integer,
    updated_at text NOT NULL,
    mbid TEXT,
    image_checked_at TEXT,
    image_pinned INTEGER NOT NULL DEFAULT 0,
    background_url TEXT,
    resolve_checked_at TEXT
  );
  CREATE TABLE IF NOT EXISTS albums (
    spotify_id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    image_url text,
    release_date text,
    total_tracks integer,
    album_type text,
    updated_at text NOT NULL,
    artist_ids TEXT,
    mbid TEXT,
    color TEXT,
    tracklist_checked_at TEXT
  );
  CREATE TABLE IF NOT EXISTS tracks (
    spotify_id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    album_id text,
    duration_ms integer NOT NULL,
    track_number integer,
    explicit integer DEFAULT false,
    popularity integer,
    updated_at text NOT NULL,
    verified_album INTEGER,
    verified_artists INTEGER,
    disc_number INTEGER,
    isrc TEXT,
    mbid TEXT,
    FOREIGN KEY (album_id) REFERENCES albums(spotify_id)
  );
  CREATE TABLE IF NOT EXISTS track_artists (
    track_id text NOT NULL,
    artist_id text NOT NULL,
    position integer NOT NULL,
    PRIMARY KEY (track_id, artist_id),
    FOREIGN KEY (track_id) REFERENCES tracks(spotify_id),
    FOREIGN KEY (artist_id) REFERENCES artists(spotify_id)
  );
  CREATE TABLE IF NOT EXISTS listening_history (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    track_id text NOT NULL,
    played_at text NOT NULL,
    context_type text,
    context_uri text,
    duration_played_ms integer,
    user_id INTEGER REFERENCES users(id),
    source TEXT,
    FOREIGN KEY (track_id) REFERENCES tracks(spotify_id)
  );
  CREATE TABLE IF NOT EXISTS auth_tokens (
    id integer PRIMARY KEY DEFAULT 1 NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at text NOT NULL,
    scope text,
    updated_at text NOT NULL,
    user_id INTEGER REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS polling_state (
    id integer PRIMARY KEY DEFAULT 1 NOT NULL,
    last_recently_played_cursor text,
    last_poll_at text,
    last_currently_playing_track_id text,
    last_currently_playing_at text,
    is_playing INTEGER DEFAULT 0,
    user_id INTEGER REFERENCES users(id),
    session_started_at TEXT,
    progress_ms INTEGER
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    updated_at text NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  CREATE TABLE IF NOT EXISTS merge_rules (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    entity_type text NOT NULL,
    source_id text NOT NULL,
    target_id text NOT NULL,
    created_at text NOT NULL,
    user_id INTEGER REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS generated_playlists (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id integer NOT NULL,
    spotify_playlist_id text,
    name text NOT NULL,
    strategy text NOT NULL,
    params text NOT NULL,
    track_count integer DEFAULT 0 NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    auto_regenerate INTEGER NOT NULL DEFAULT 0,
    regenerate_interval_ms INTEGER,
    last_regenerated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS generated_playlist_tracks (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    playlist_id integer NOT NULL,
    track_id text NOT NULL,
    position integer NOT NULL,
    FOREIGN KEY (playlist_id) REFERENCES generated_playlists(id),
    FOREIGN KEY (track_id) REFERENCES tracks(spotify_id)
  );
  CREATE TABLE IF NOT EXISTS spotify_playlists (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id integer NOT NULL,
    spotify_id text NOT NULL,
    name text NOT NULL,
    image_url text,
    owner_name text,
    is_owned integer DEFAULT false,
    is_algorithmic integer DEFAULT false,
    track_count integer DEFAULT 0,
    snapshot_id text,
    last_synced_at text,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS spotify_playlist_tracks (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    playlist_id integer NOT NULL,
    track_id text NOT NULL,
    position integer NOT NULL,
    added_at text,
    FOREIGN KEY (playlist_id) REFERENCES spotify_playlists(id),
    FOREIGN KEY (track_id) REFERENCES tracks(spotify_id)
  );
`;

// los índices de esas tablas que sólo existían en las migraciones borradas (el resto está en
// legacy-ddl.ts). los UNIQUE son funcionales: el sync de playlists hace su upsert contra ellos.
// van uno a uno y sin tumbar el arranque: una instancia antigua sin el índice podría tener
// filas repetidas, y crear un UNIQUE encima fallaría
export const BASE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_listening_history_played_at ON listening_history(played_at)',
  'CREATE INDEX IF NOT EXISTS idx_listening_history_track_id ON listening_history(track_id)',
  'CREATE INDEX IF NOT EXISTS idx_generated_playlists_user_id ON generated_playlists(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_gpt_playlist_id ON generated_playlist_tracks(playlist_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_spotify_playlists_user_spotify ON spotify_playlists(user_id, spotify_id)',
  'CREATE INDEX IF NOT EXISTS idx_spt_playlist_id ON spotify_playlist_tracks(playlist_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_spt_playlist_track ON spotify_playlist_tracks(playlist_id, track_id)',
];
