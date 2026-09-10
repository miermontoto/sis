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
//   - confirmed: se emite cuando la marca de agua del historial (el played_at
//     más reciente del servidor, ver readHistoryWatermark) supera a la que
//     había al detectar el corte. Sólo entonces el play está en
//     listening_history y una relectura devuelve la verdad. Invalidar antes
//     recachearía el estado ANTERIOR durante todo el TTL del endpoint (hasta
//     una hora en los detalles), que es exactamente el fallo que se quiere
//     evitar; de ahí que no valga un simple setTimeout.
//
// El reparto de trabajo entre las dos: los rankings (caros, muchas variantes de
// rango cacheadas) se quedan en la señal optimista y dejan que el TTL normal
// los reconcilie; los detalles de una entidad concreta (clave de cache
// estrecha, un solo request) se releen con la confirmada.

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

// un play que el servidor nunca llegue a registrar (demasiado corto para que
// Spotify lo exponga) no puede quedarse esperando confirmación para siempre:
// caducaría confirmándose con el avance de marca de OTRO play posterior
const PENDING_TTL_MS = 5 * 60_000;

let _seq = 0;
let _optimistic = $state<PlayUpdate | null>(null);
let _confirmed = $state<ConfirmedBatch | null>(null);

let _watermark: string | null = null;
let _watermarkSeen = false;
let _pending: { update: PlayUpdate; watermarkAtEmit: string | null; emittedAt: number }[] = [];

export function emitOptimistic(input: Omit<PlayUpdate, 'seq'>): void {
  const update: PlayUpdate = { ...input, seq: ++_seq };
  _optimistic = update;
  // sin ninguna lectura de marca todavía no hay contra qué comparar: el play se
  // queda pendiente y la primera marca que llegue hace de línea base
  _pending.push({ update, watermarkAtEmit: _watermarkSeen ? _watermark : null, emittedAt: Date.now() });
}

// las marcas son ISO-8601 UTC generadas por el servidor, así que comparar como
// strings equivale a comparar instantes y no mete el reloj del cliente en medio
export function setWatermark(next: string | null | undefined): void {
  if (next === undefined) return;

  if (!_watermarkSeen) {
    _watermarkSeen = true;
    _watermark = next;
    // los pendientes emitidos antes de conocer marca alguna toman ésta como
    // línea base en vez de confirmarse en falso con la primera lectura
    _pending = _pending.map(p => (p.watermarkAtEmit === null ? { ...p, watermarkAtEmit: next } : p));
    return;
  }

  if (next !== null && (_watermark === null || next > _watermark)) _watermark = next;
  if (_pending.length === 0) return;

  const cutoff = Date.now() - PENDING_TTL_MS;
  const confirmed: PlayUpdate[] = [];
  _pending = _pending.filter(p => {
    const landed = next !== null && (p.watermarkAtEmit === null || next > p.watermarkAtEmit);
    if (landed) confirmed.push(p.update);
    return !landed && p.emittedAt >= cutoff;
  });

  if (confirmed.length > 0) _confirmed = { seq: ++_seq, updates: confirmed };
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
  emitOptimistic,
  setWatermark,
};
