import type { TrackInfo } from './entities.js';

export interface NowPlayingResponse {
  playing: boolean;
  isPlaying: boolean;
  // false para usuarios solo-last.fm: sin token de spotify no hay controles de
  // reproducción (la tarjeta se muestra read-only). ausente/true = controlable
  controllable?: boolean;
  // progreso del track en el momento de updatedAt; el cliente extrapola
  progressMs?: number | null;
  volumePercent?: number | null;
  track?: TrackInfo;
  updatedAt?: string;
  // marca de agua del historial: el played_at más reciente del usuario en
  // listening_history. avanza SOLO cuando el servidor ya ha volcado un play
  // (el volcado va en escalera de 8/25/75s tras el corte, ver
  // scheduleHistoryFlush), así que el cliente la usa para saber cuándo sus
  // agregados son releíbles. null = el usuario no tiene historial todavía
  historyWatermark?: string | null;
  // plays que han aterrizado en listening_history por encima de la marca que
  // mandó el cliente (?since=). Es la respuesta a "¿qué se ha registrado
  // mientras no miraba?": el cliente NO puede deducirlo observando la tarjeta,
  // porque un repeat-one, la app en segundo plano, otro dispositivo o un
  // scrobble de last.fm/listenbrainz no cambian el track sonando. Sin `since`
  // viene vacío: esa lectura es la línea base, no un delta
  landedPlays?: LandedPlay[];
  // plays que el poller YA ha medido y que spotify todavía no ha confirmado en
  // recently-played. Son la otra mitad de landedPlays: uno dice lo que se ha
  // registrado y el otro lo que está en camino, y entre los dos no queda hueco
  // en el que un play parezca perdido. El corte lo detecta currently-playing al
  // instante, pero recently-played puede tardar minutos en exponerlo (medido:
  // un play tardó 6,5 min en aparecer), así que sin esta lista el historial
  // enseña un agujero y quien mira concluye que se ha perdido un scrobble
  pendingPlays?: PendingPlay[];
}

// un play ya registrado, con las entidades que toca. Mismos ids crudos que
// pinta el resto de la app (spotify_id), para que una vista pueda preguntar
// "¿me toca esto?" sin resolver merges
export interface LandedPlay {
  trackId: string;
  albumId: string | null;
  artistIds: string[];
  playedAt: string;
  playedMs: number;
}

// un play medido por currently-playing que aún no tiene fila en
// listening_history. NO es una promesa: spotify puede acabar descartándolo (una
// escucha corta nunca entra en recently-played) y entonces caduca solo por TTL,
// así que quien lo pinta tiene que marcarlo como pendiente, nunca como un hecho.
// `playedAt` es el instante del corte según NUESTRO reloj, no el de spotify: los
// dos difieren en unos segundos y el bueno es el que acabe guardando la fila
export interface PendingPlay {
  trackId: string;
  playedAt: string;
  playedMs: number;
  track: TrackInfo;
}

// referencia a una entidad de la cola. `known` = el id existe en la biblioteca:
// los PK de la app son spotify ids, pero un tema que el usuario no ha escuchado
// nunca no tiene fila, y su ficha respondería 404. Sin fila se pinta el nombre
// sin enlace, como los temas sin atribuir de un setlist
export interface PlaybackQueueRef {
  id: string;
  name: string;
  known: boolean;
}

// entrada de la cola de reproducción
export interface PlaybackQueueItem extends PlaybackQueueRef {
  artists: PlaybackQueueRef[];
  album: (PlaybackQueueRef & { imageUrl: string | null }) | null;
}

export interface PlaybackQueueResponse {
  queue: PlaybackQueueItem[];
}

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

export interface DevicesResponse {
  devices: SpotifyDevice[];
}

export interface PlayContextRequest {
  context_uri?: string;
  uris?: string[];
  device_id?: string;
}

export interface PlayContextResponse {
  success: boolean;
  error?: string;
}

export interface FriendActivity {
  spotifyId: string;
  displayName: string | null;
  imageUrl: string | null;
  isPlaying: boolean;
  track: { name: string; artists: string; albumImageUrl: string | null } | null;
  updatedAt: string | null;
}

export type FriendsActivityResponse = FriendActivity[];
