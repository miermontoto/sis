import { describe, it, expect, beforeEach, vi } from 'vitest';

// el store guarda estado a nivel de módulo (la marca de agua conocida), así que
// cada caso arranca con una instancia limpia
let mod: typeof import('./play-updates.svelte');

beforeEach(async () => {
  vi.resetModules();
  mod = await import('./play-updates.svelte');
});

const PLAY = {
  trackId: 'track-a',
  albumId: 'album-a',
  artistIds: ['artist-a', 'artist-b'],
  playedMs: 180_000,
  playedAt: '2026-06-05T10:00:00.000Z',
};

describe('playUpdatesStore: señal optimista', () => {
  it('emite el play con secuencia creciente', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.emitOptimistic(PLAY);
    const first = playUpdatesStore.optimistic!;
    expect(first.trackId).toBe('track-a');

    playUpdatesStore.emitOptimistic({ ...PLAY, trackId: 'track-b' });
    expect(playUpdatesStore.optimistic!.seq).toBeGreaterThan(first.seq);
  });
});

describe('playUpdatesStore: cola de historial', () => {
  it('la primera lectura es sólo línea base: marca sin plays no confirma nada', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.applyHistoryTail('2026-06-05T09:59:00.000Z', []);
    expect(playUpdatesStore.confirmed).toBeNull();
    expect(playUpdatesStore.watermark).toBe('2026-06-05T09:59:00.000Z');
  });

  it('confirma los plays que reporta el servidor', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.applyHistoryTail('2026-06-05T09:59:00.000Z', []);
    playUpdatesStore.applyHistoryTail('2026-06-05T10:00:03.000Z', [{ ...PLAY, playedAt: '2026-06-05T10:00:03.000Z' }]);

    const batch = playUpdatesStore.confirmed!;
    expect(batch.updates).toHaveLength(1);
    expect(batch.updates[0].trackId).toBe('track-a');
  });

  it('confirma sin señal optimista previa: el play no tiene por qué haberse visto', () => {
    const { playUpdatesStore } = mod;
    // repeat-one, app en segundo plano, otro dispositivo o un scrobble externo:
    // el servidor registra el play sin que la tarjeta de now-playing cambie
    playUpdatesStore.applyHistoryTail('2026-06-05T09:59:00.000Z', []);
    playUpdatesStore.applyHistoryTail('2026-06-05T10:00:03.000Z', [{ ...PLAY, playedAt: '2026-06-05T10:00:03.000Z' }]);
    expect(playUpdatesStore.confirmed!.updates).toHaveLength(1);
  });

  it('confirma en un solo lote los plays de una ráfaga', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.applyHistoryTail('2026-06-05T09:59:00.000Z', []);
    playUpdatesStore.applyHistoryTail('2026-06-05T10:00:06.000Z', [
      { ...PLAY, playedAt: '2026-06-05T10:00:03.000Z' },
      { ...PLAY, trackId: 'track-b', playedAt: '2026-06-05T10:00:06.000Z' },
    ]);

    expect(playUpdatesStore.confirmed!.updates.map(u => u.trackId)).toEqual(['track-a', 'track-b']);
  });

  it('no reemite los plays de una respuesta en vuelo con el mismo `since`', () => {
    const { playUpdatesStore } = mod;
    // el poll del límite del track y el tick de 10s se solapan: los dos piden
    // el mismo delta y el servidor devuelve las mismas filas dos veces
    const landed = [{ ...PLAY, playedAt: '2026-06-05T10:00:03.000Z' }];
    playUpdatesStore.applyHistoryTail('2026-06-05T09:59:00.000Z', []);
    playUpdatesStore.applyHistoryTail('2026-06-05T10:00:03.000Z', landed);
    const first = playUpdatesStore.confirmed!;

    playUpdatesStore.applyHistoryTail('2026-06-05T10:00:03.000Z', landed);
    expect(playUpdatesStore.confirmed).toBe(first);
  });

  it('ignora una respuesta sin el campo (marca undefined)', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.applyHistoryTail('2026-06-05T09:59:00.000Z', []);
    playUpdatesStore.applyHistoryTail(undefined, undefined);
    expect(playUpdatesStore.confirmed).toBeNull();
    expect(playUpdatesStore.watermark).toBe('2026-06-05T09:59:00.000Z');
  });

  it('un usuario sin historial previo se confirma con su primer play', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.applyHistoryTail(null, []);
    playUpdatesStore.applyHistoryTail('2026-06-05T10:00:03.000Z', [{ ...PLAY, playedAt: '2026-06-05T10:00:03.000Z' }]);

    expect(playUpdatesStore.confirmed!.updates).toHaveLength(1);
  });
});

describe('targetIdsFor', () => {
  it('reparte el play entre TODOS los artistas del track', () => {
    const { targetIdsFor } = mod;
    const update = { ...PLAY, seq: 1 };
    // top-artists agrega por track_artists, así que una colaboración suma a los
    // dos artistas, no sólo al principal
    expect(targetIdsFor(update, 'artists')).toEqual(['artist-a', 'artist-b']);
    expect(targetIdsFor(update, 'tracks')).toEqual(['track-a']);
    expect(targetIdsFor(update, 'albums')).toEqual(['album-a']);
  });

  it('no devuelve target de álbum para un track sin álbum', () => {
    const { targetIdsFor } = mod;
    expect(targetIdsFor({ ...PLAY, seq: 1, albumId: null }, 'albums')).toEqual([]);
  });
});
