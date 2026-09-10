import { describe, it, expect, beforeEach, vi } from 'vitest';

// el store guarda estado a nivel de módulo (marca de agua, pendientes), así que
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

describe('playUpdatesStore: confirmación por marca de agua', () => {
  it('no confirma con la primera marca leída: es sólo la línea base', () => {
    const { playUpdatesStore } = mod;
    // el caso real: el corte se detecta antes de que ninguna respuesta de
    // now-playing haya traído marca. Confirmar aquí sería releer ANTES de que
    // el servidor volcase el play, y recachear las cifras viejas
    playUpdatesStore.emitOptimistic(PLAY);
    playUpdatesStore.setWatermark('2026-06-05T09:59:00.000Z');
    expect(playUpdatesStore.confirmed).toBeNull();
  });

  it('no confirma mientras la marca no avance', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.setWatermark('2026-06-05T09:59:00.000Z');
    playUpdatesStore.emitOptimistic(PLAY);

    playUpdatesStore.setWatermark('2026-06-05T09:59:00.000Z');
    expect(playUpdatesStore.confirmed).toBeNull();
  });

  it('confirma cuando la marca supera a la que había al emitir', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.setWatermark('2026-06-05T09:59:00.000Z');
    playUpdatesStore.emitOptimistic(PLAY);
    playUpdatesStore.setWatermark('2026-06-05T10:00:03.000Z');

    const batch = playUpdatesStore.confirmed!;
    expect(batch.updates).toHaveLength(1);
    expect(batch.updates[0].trackId).toBe('track-a');
  });

  it('confirma en un solo lote los plays acumulados de una ráfaga de skips', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.setWatermark('2026-06-05T09:59:00.000Z');
    playUpdatesStore.emitOptimistic(PLAY);
    playUpdatesStore.emitOptimistic({ ...PLAY, trackId: 'track-b' });
    playUpdatesStore.setWatermark('2026-06-05T10:00:03.000Z');

    expect(playUpdatesStore.confirmed!.updates.map(u => u.trackId)).toEqual(['track-a', 'track-b']);
  });

  it('ignora una marca ausente (respuesta sin el campo)', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.setWatermark('2026-06-05T09:59:00.000Z');
    playUpdatesStore.emitOptimistic(PLAY);
    playUpdatesStore.setWatermark(undefined);
    expect(playUpdatesStore.confirmed).toBeNull();
  });

  it('un usuario sin historial previo se confirma con su primer play', () => {
    const { playUpdatesStore } = mod;
    playUpdatesStore.setWatermark(null);
    playUpdatesStore.emitOptimistic(PLAY);
    playUpdatesStore.setWatermark('2026-06-05T10:00:03.000Z');

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
