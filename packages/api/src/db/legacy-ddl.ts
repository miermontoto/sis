// ddl legacy de sis fuera de drizzle: columnas/índices añadidos ad-hoc, tablas
// multi-user/social, fts5 y la tabla canónica de sesiones de la plataforma.
// se ejecuta en cada boot (idempotente) tras las migraciones de drizzle.
import type Database from 'better-sqlite3';
import { ALBUM_RATING_MIN, ALBUM_RATING_MAX } from '@sis/shared';
import { createLogger } from '../services/logger.js';

const log = createLogger('db');
export function applyLegacyDdl(sqlite: Database.Database): void {
  // columnas e índices adicionales no gestionados por drizzle
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN verified_album INTEGER'); } catch {}
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN verified_artists INTEGER'); } catch {}
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN disc_number INTEGER'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_track_artists_track_id ON track_artists(track_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_track_artists_artist_id ON track_artists(artist_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_lh_user_track ON listening_history(user_id, track_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_lh_user_track_played_at ON listening_history(user_id, track_id, played_at)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_merge_rules_lookup ON merge_rules(entity_type, source_id, user_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_merge_rules_target ON merge_rules(user_id, entity_type, target_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_ta_artist_position ON track_artists(artist_id, position)'); } catch {}
  // identidad multi-fuente: IDs externos estables como EVIDENCIA de resolución, no
  // como claves. isrc viene de spotify (external_ids del track), mbid de last.fm /
  // musicbrainz. convención de centinela: NULL = no consultado, '' = consultado sin
  // resultado (misma que image_url en enrichment).
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN isrc TEXT'); } catch {}
  try { sqlite.exec('ALTER TABLE tracks ADD COLUMN mbid TEXT'); } catch {}
  try { sqlite.exec('ALTER TABLE artists ADD COLUMN mbid TEXT'); } catch {}
  try { sqlite.exec('ALTER TABLE albums ADD COLUMN mbid TEXT'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tracks_isrc ON tracks(isrc)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tracks_mbid ON tracks(mbid)'); } catch {}

  // procedencia del play: 'spotify' (polling) | 'lastfm' (sync de scrobbles) |
  // 'import' (ficheros de export) | futuros clientes de scrobbling. el backfill corre
  // solo cuando el ALTER acaba de crear la columna (si ya existía, lanza y salta al
  // catch): heurística best-effort — tracks sintéticos vinieron de imports/scrobbles;
  // el resto queda NULL (= anterior a la columna, fuente no comprobable).
  try {
    sqlite.exec('ALTER TABLE listening_history ADD COLUMN source TEXT');
    sqlite.exec(`UPDATE listening_history SET source = 'import'
      WHERE track_id LIKE 'import:%' OR track_id LIKE 'local:%'`);
  } catch {}

  try { sqlite.exec('ALTER TABLE polling_state ADD COLUMN is_playing INTEGER DEFAULT 0'); } catch {}
  try { sqlite.exec('ALTER TABLE polling_state ADD COLUMN session_started_at TEXT'); } catch {}
  try { sqlite.exec('ALTER TABLE polling_state ADD COLUMN progress_ms INTEGER'); } catch {}
  try { sqlite.exec('ALTER TABLE albums ADD COLUMN artist_ids TEXT'); } catch {}

  // auto-regeneración de playlists generadas (scheduler reejecuta la estrategia)
  try { sqlite.exec('ALTER TABLE generated_playlists ADD COLUMN auto_regenerate INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { sqlite.exec('ALTER TABLE generated_playlists ADD COLUMN regenerate_interval_ms INTEGER'); } catch {}
  try { sqlite.exec('ALTER TABLE generated_playlists ADD COLUMN last_regenerated_at TEXT'); } catch {}

  // multi-user: tabla de usuarios
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spotify_id TEXT NOT NULL UNIQUE,
      display_name TEXT,
      image_url TEXT,
      is_admin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}

  // multi-user: userId en tablas existentes
  try { sqlite.exec('ALTER TABLE auth_tokens ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}
  try { sqlite.exec('ALTER TABLE polling_state ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}
  try { sqlite.exec('ALTER TABLE listening_history ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}
  try { sqlite.exec('ALTER TABLE merge_rules ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch {}

  // multi-user: reemplazar unique en played_at por composite (user_id, played_at)
  try { sqlite.exec('DROP INDEX IF EXISTS listening_history_played_at_unique'); } catch {}
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_history_user_played_at ON listening_history(user_id, played_at)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_listening_history_user_id ON listening_history(user_id)'); } catch {}

  // album covers: historial de portadas observadas + uploads
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS album_covers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'spotify',
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(album_id, image_url)
    )`);
  } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_album_covers_album_id ON album_covers(album_id)'); } catch {}

  // artist images: historial de fotos observadas + uploads (espejo de album_covers).
  // a diferencia de las portadas —reobservadas en cada play ingerido— las fotos de
  // artista solo llegan por /v1/artists, así que quien alimenta el historial es el
  // barrido periódico de enrichArtistMetadata (ver image_checked_at abajo)
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS artist_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'spotify',
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(artist_id, image_url)
    )`);
    // sembrar el historial con la foto actual de cada artista: el catálogo ya enriquecido
    // nunca se repide entero, así que sin esto el picker saldría vacío para siempre.
    // solo la primera vez (tabla vacía): en cada boot sería un scan de artists inútil
    if (!sqlite.prepare('SELECT 1 FROM artist_images LIMIT 1').get()) {
      sqlite.exec(`INSERT OR IGNORE INTO artist_images (artist_id, image_url, source)
        SELECT spotify_id, image_url, 'spotify' FROM artists
        WHERE image_url IS NOT NULL AND image_url != ''`);
    }
  } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_artist_images_artist_id ON artist_images(artist_id)'); } catch {}

  // barrido round-robin de fotos de artista: NULL = nunca comprobado (va primero).
  // columna propia y no artists.updated_at porque cada play ingerido refresca esa,
  // con lo que los artistas más escuchados jamás llegarían a la cabeza de la cola
  try { sqlite.exec('ALTER TABLE artists ADD COLUMN image_checked_at TEXT'); } catch {}
  // foto elegida a mano (upload o pick en el picker): el barrido no la pisa
  try { sqlite.exec('ALTER TABLE artists ADD COLUMN image_pinned INTEGER NOT NULL DEFAULT 0'); } catch {}
  // imagen de fondo del detalle: pick independiente de la foto redonda. NULL = sin
  // elección, el fondo cae a image_url (barrido de spotify). sale del mismo pool de
  // artist_images, así que no necesita historial propio
  try { sqlite.exec('ALTER TABLE artists ADD COLUMN background_url TEXT'); } catch {}

  // multi-user: unique en user_id para auth_tokens y polling_state
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id)'); } catch {}
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_polling_state_user_id ON polling_state(user_id)'); } catch {}

  // social: follows (relación dirigida follower → followed)
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL REFERENCES users(id),
      followed_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_pair ON follows(follower_id, followed_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id)'); } catch {}

  // social: share links (tokens públicos revocables)
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS share_links (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      range TEXT,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      last_accessed_at TEXT
    )`);
  } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_share_links_user ON share_links(user_id)'); } catch {}

  // FTS5: índice de búsqueda full-text para artistas, álbumes y tracks
  try {
    sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      entity_id UNINDEXED,
      entity_type UNINDEXED,
      name,
      extra_text,
      tokenize='unicode61 remove_diacritics 2'
    )`);

    sqlite.exec('BEGIN');
    sqlite.exec('DELETE FROM search_index');
    sqlite.exec(`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
      SELECT spotify_id, 'artist', name, '' FROM artists WHERE spotify_id NOT LIKE 'import:%'`);
    sqlite.exec(`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
      SELECT spotify_id, 'album', name, '' FROM albums WHERE spotify_id NOT LIKE 'import:%'`);
    sqlite.exec(`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
      SELECT t.spotify_id, 'track', t.name, COALESCE(ar.name, '')
      FROM tracks t
      LEFT JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
      LEFT JOIN artists ar ON ar.spotify_id = ta.artist_id
      WHERE t.spotify_id NOT LIKE 'import:%'`);
    sqlite.exec(`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
      SELECT CAST(id AS TEXT), 'playlist_library', name, COALESCE(owner_name, '') FROM spotify_playlists`);
    sqlite.exec(`INSERT INTO search_index (entity_id, entity_type, name, extra_text)
      SELECT CAST(id AS TEXT), 'playlist_generated', name, strategy FROM generated_playlists`);
    sqlite.exec('COMMIT');

    // triggers para mantener el índice sincronizado con inserts/updates
    for (const trigger of [
      'fts_artists_ai',
      'fts_artists_au',
      'fts_albums_ai',
      'fts_albums_au',
      'fts_tracks_ai',
      'fts_tracks_au',
      'fts_track_artists_ai',
      'fts_track_artists_au',
      'fts_track_artists_ad',
    ]) {
      sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_artists_ai AFTER INSERT ON artists
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'artist';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (NEW.spotify_id, 'artist', NEW.name, '');
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_artists_au AFTER UPDATE OF name ON artists
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'artist';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (NEW.spotify_id, 'artist', NEW.name, '');
        DELETE FROM search_index
        WHERE entity_type = 'track'
          AND entity_id IN (
            SELECT ta.track_id FROM track_artists ta WHERE ta.artist_id = NEW.spotify_id AND ta.position = 0
          );
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        SELECT t.spotify_id, 'track', t.name, NEW.name
        FROM tracks t
        JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.artist_id = NEW.spotify_id AND ta.position = 0
        WHERE t.spotify_id NOT LIKE 'import:%';
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_albums_ai AFTER INSERT ON albums
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'album';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (NEW.spotify_id, 'album', NEW.name, '');
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_albums_au AFTER UPDATE OF name ON albums
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'album';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (NEW.spotify_id, 'album', NEW.name, '');
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_tracks_ai AFTER INSERT ON tracks
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (
          NEW.spotify_id,
          'track',
          NEW.name,
          COALESCE((
            SELECT a.name
            FROM track_artists ta
            JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = NEW.spotify_id AND ta.position = 0
            LIMIT 1
          ), '')
        );
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_tracks_au AFTER UPDATE OF name ON tracks
      WHEN NEW.spotify_id NOT LIKE 'import:%' BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.spotify_id AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        VALUES (
          NEW.spotify_id,
          'track',
          NEW.name,
          COALESCE((
            SELECT a.name
            FROM track_artists ta
            JOIN artists a ON a.spotify_id = ta.artist_id
            WHERE ta.track_id = NEW.spotify_id AND ta.position = 0
            LIMIT 1
          ), '')
        );
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_track_artists_ai AFTER INSERT ON track_artists
      WHEN NEW.position = 0 BEGIN
        DELETE FROM search_index WHERE entity_id = NEW.track_id AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        SELECT t.spotify_id, 'track', t.name, COALESCE(a.name, '')
        FROM tracks t
        LEFT JOIN artists a ON a.spotify_id = NEW.artist_id
        WHERE t.spotify_id = NEW.track_id AND t.spotify_id NOT LIKE 'import:%';
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_track_artists_au AFTER UPDATE OF artist_id, position ON track_artists
      BEGIN
        DELETE FROM search_index WHERE entity_id IN (OLD.track_id, NEW.track_id) AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        SELECT t.spotify_id, 'track', t.name, COALESCE(a.name, '')
        FROM tracks t
        LEFT JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
        LEFT JOIN artists a ON a.spotify_id = ta.artist_id
        WHERE t.spotify_id IN (OLD.track_id, NEW.track_id) AND t.spotify_id NOT LIKE 'import:%';
      END`);
    sqlite.exec(`CREATE TRIGGER IF NOT EXISTS fts_track_artists_ad AFTER DELETE ON track_artists
      WHEN OLD.position = 0 BEGIN
        DELETE FROM search_index WHERE entity_id = OLD.track_id AND entity_type = 'track';
        INSERT INTO search_index(entity_id, entity_type, name, extra_text)
        SELECT t.spotify_id, 'track', t.name, COALESCE(a.name, '')
        FROM tracks t
        LEFT JOIN track_artists ta ON ta.track_id = t.spotify_id AND ta.position = 0
        LEFT JOIN artists a ON a.spotify_id = ta.artist_id
        WHERE t.spotify_id = OLD.track_id AND t.spotify_id NOT LIKE 'import:%';
      END`);

    log.info('índice FTS5 creado y poblado');
  } catch (err) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    log.error('error creando índice FTS5:', err);
  }

  // tabla canónica de sesiones de la plataforma (@platform/auth). ddl ad-hoc en vez
  // de migración drizzle: el journal de sis no está saneado (migrate corre en modo warn).
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS auth_session (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT
    )`);
  } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_session_expires ON auth_session(expires_at)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_session_user ON auth_session(user_id)'); } catch {}

  // el changelog ya no existe en la app. limpieza de las tablas que sembraban las
  // versiones anteriores (contenido derivado, nada que conservar); se mantiene el
  // drop para las bases de datos que aún las arrastren.
  try { sqlite.exec('DROP TABLE IF EXISTS changelog_entry'); } catch {}
  try { sqlite.exec('DROP TABLE IF EXISTS changelog_seen'); } catch {}

  // notificaciones push: tokens de dispositivo (FCM android/ios, PushSubscription web).
  // ddl ad-hoc (path garantizado en runtime); drizzle migrate corre en modo warn.
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS device_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL,
      user_agent TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT
    )`);
  } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_device_tokens_user_active ON device_tokens(user_id, is_active)'); } catch {}

  // notificaciones push: dedup de envíos. entity_id/period usan '' NOT NULL (no NULL)
  // para que el UNIQUE deduplique (SQLite trata los NULL como distintos).
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS sent_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      notification_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      period TEXT NOT NULL DEFAULT '',
      rank INTEGER,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, notification_type, entity_id, period)
    )`);
  } catch {}

  // notificaciones push: último periodo (chart) procesado por usuario y granularidad
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS notification_period_state (
      user_id INTEGER NOT NULL,
      granularity TEXT NOT NULL,
      last_period TEXT NOT NULL,
      PRIMARY KEY(user_id, granularity)
    )`);
  } catch {}

  // relaciones "soft" entre artistas (par simétrico normalizado a < b). el UNIQUE
  // sobre (user_id, artist_a, artist_b) es el que deduplica las dos direcciones.
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS artist_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      artist_a TEXT NOT NULL REFERENCES artists(spotify_id),
      artist_b TEXT NOT NULL REFERENCES artists(spotify_id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try { sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_relations_pair ON artist_relations(user_id, artist_a, artist_b)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_artist_relations_b ON artist_relations(user_id, artist_b)'); } catch {}

  // last.fm: cuentas vinculadas (sso + sync de scrobbles). ddl ad-hoc como el
  // resto: drizzle migrate corre en modo warn.
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS lastfm_accounts (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      username TEXT NOT NULL UNIQUE,
      session_key TEXT,
      last_scrobble_uts INTEGER,
      backfill_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}

  // tokens de scrobbling (API compatible listenbrainz): un token por usuario,
  // regenerable; los clientes (pano scrobbler, web scrobbler, navidrome…) lo
  // mandan en Authorization: Token <x> hacia /1/submit-listens
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS listen_tokens (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    )`);
  } catch {}

  // valoraciones de álbum (estrellas enteras + texto opcional). el CHECK duplica el
  // rango validado en la ruta como red de seguridad ante escrituras fuera de la api
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS album_ratings (
      user_id INTEGER NOT NULL REFERENCES users(id),
      album_id TEXT NOT NULL REFERENCES albums(spotify_id),
      rating INTEGER NOT NULL CHECK (rating BETWEEN ${ALBUM_RATING_MIN} AND ${ALBUM_RATING_MAX}),
      review TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, album_id)
    )`);
  } catch {}

  // conciertos asistidos: anotación por usuario sobre un artista, con setlist
  // opcional importado de setlist.fm. el UNIQUE impide reimportar el mismo bolo
  // (un usuario no ve dos veces al mismo artista el mismo día)
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS concerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      artist_id TEXT NOT NULL REFERENCES artists(spotify_id),
      concert_date TEXT NOT NULL,
      venue TEXT,
      city TEXT,
      country TEXT,
      tour TEXT,
      notes TEXT,
      setlistfm_id TEXT,
      setlistfm_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, artist_id, concert_date)
    )`);
  } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_concerts_user_date ON concerts(user_id, concert_date)'); } catch {}
  try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_concerts_user_artist ON concerts(user_id, artist_id)'); } catch {}

  // canciones del setlist. track_id es la resolución contra la librería del
  // usuario: NULL = no la tiene. la FK va sin cascada a propósito — un track
  // puede desaparecer en un merge/dedup y eso no debe borrar la canción del
  // setlist, que es un hecho del bolo, no una referencia al catálogo.
  // el ON DELETE CASCADE de concert_id sí es real: la plataforma abre la
  // conexión con foreign_keys = ON.
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS concert_songs (
      concert_id INTEGER NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      track_id TEXT,
      info TEXT,
      is_encore INTEGER NOT NULL DEFAULT 0,
      cover_artist TEXT,
      PRIMARY KEY (concert_id, position)
    )`);
  } catch {}

  // id.mier.info: cuentas vinculadas (sso propio, oidc)
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS mierid_accounts (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      sub TEXT NOT NULL UNIQUE,
      username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
}
