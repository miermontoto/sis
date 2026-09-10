// Puente entre "un track ha terminado" y las vistas que pintan agregados
// (tops, charts, detalles). Emite DOS señales deliberadamente distintas, porque
// resuelven problemas distintos:
//
//   - optimistic: se emite en cuanto el cliente ve cambiar el track sonando.
//     Las vistas de ranking suman el play a sus filas y reordenan sin tocar la
//     red. Es una aproximación: no conoce merges de artista, entidades que
//     entran al top desde fuera de la página cargada, ni plays que Spotify
//     acabe descartando.
//
//   - confirmed: son los plays que el SERVIDOR dice que ya están en
//     listening_history (los manda /now-playing en `landedPlays`, ver
//     readHistoryTail). Sólo entonces una relectura devuelve la verdad;
//     invalidar antes recachearía el estado ANTERIOR durante todo el TTL del
//     endpoint (hasta una hora en los detalles), que es exactamente el fallo
//     que se quiere evitar, de ahí que no valga un simple setTimeout.
//
// Que la confirmación venga del servidor y no de correlacionar con lo emitido
// aquí es lo que hace que el refresco no dependa de haber VISTO el corte. Antes
// un play sólo se confirmaba si el cliente había emitido antes su señal
// optimista, así que todo lo que no pasa por la tarjeta —repeat-one, la app en
// segundo plano, otro dispositivo, un scrobble de last.fm o listenbrainz, un
// import— aterrizaba sin que ninguna vista se enterara.
//
// El reparto de trabajo entre las dos: los rankings (caros, muchas variantes de
// rango cacheadas) se quedan en la señal optimista y dejan que el TTL normal
// los reconcilie; los detalles de una entidad concreta (clave de cache
// estrecha, un solo request) se releen con la confirmada. Ningún consumidor
// SUMA sobre la confirmada —todos relen—, así que un play que llegue por las
// dos señales no se cuenta dos veces.

import type { LandedPlay } from '@sis/shared';

export interface PlayUpdate {
  // secuencia monótona: los consumidores deduplican con ella, porque un $effect
  // puede reejecutarse por dependencias ajenas al propio update
  seq: number;
  trackId: string;
  albumId: string | null;
  artistIds: string[];
  // ms escuchados, capados a la duración del track: es la misma cifra que el
  // servidor acabará guardando en duration_played_ms, así que el parche
  // optimista suma lo mismo que sumará la relectura
  playedMs: number;
  playedAt: string;
}

export interface ConfirmedBatch {
  seq: number;
  updates: PlayUpdate[];
}

let _seq = 0;
let _optimistic = $state<PlayUpdate | null>(null);
let _confirmed = $state<ConfirmedBatch | null>(null);

let _watermark: string | null = null;

export function emitOptimistic(input: Omit<PlayUpdate, 'seq'>): void {
  _optimistic = { ...input, seq: ++_seq };
}

// Aplica la cola de historial que trae cada lectura de now-playing: la marca de
// agua conocida (que viaja de vuelta como `?since=` en el siguiente poll) y los
// plays registrados por encima de ella.
//
// Las marcas son ISO-8601 UTC generadas por el servidor, así que comparar como
// strings equivale a comparar instantes y no mete el reloj del cliente en medio.
export function applyHistoryTail(watermark: string | null | undefined, landed?: LandedPlay[]): void {
  if (watermark === undefined) return;

  // dos respuestas en vuelo a la vez (el poll del límite del track y el tick de
  // 10s se solapan) pidieron el mismo `since` y traen los mismos plays: la
  // segunda se filtra contra la marca que ya avanzó la primera
  const fresh = (landed ?? []).filter(p => _watermark === null || p.playedAt > _watermark);

  if (watermark !== null && (_watermark === null || watermark > _watermark)) _watermark = watermark;
  if (fresh.length === 0) return;

  const updates = fresh.map(p => ({ ...p, seq: ++_seq }));
  _confirmed = { seq: ++_seq, updates };
}

// ids que un play toca para un tipo de entidad. Un track en colaboración cuenta
// para TODOS sus artistas (top-artists agrega por track_artists), no sólo el
// principal
export function targetIdsFor(update: PlayUpdate, type: 'tracks' | 'artists' | 'albums'): string[] {
  if (type === 'tracks') return [update.trackId];
  if (type === 'albums') return update.albumId ? [update.albumId] : [];
  return update.artistIds;
}

export function batchTouches(updates: PlayUpdate[], type: 'tracks' | 'artists' | 'albums', id: string): boolean {
  return updates.some(u => targetIdsFor(u, type).includes(id));
}

export const playUpdatesStore = {
  get optimistic() { return _optimistic; },
  get confirmed() { return _confirmed; },
  // lo que el cliente ya sabe registrado: viaja como `?since=` para que el
  // servidor sólo mande el delta
  get watermark() { return _watermark; },
  emitOptimistic,
  applyHistoryTail,
};
