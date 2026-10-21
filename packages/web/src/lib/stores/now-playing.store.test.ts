import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NowPlayingResponse } from '$lib/api';

// mock del cliente api: controla las respuestas de spotify sin red
const mocks = vi.hoisted(() => ({
  playbackPlayContext: vi.fn(),
  nowPlayingLive: vi.fn(),
  nowPlaying: vi.fn(),
  playbackSeek: vi.fn(async () => ({ success: true })),
  trackPlaylists: vi.fn(async () => ({})),
  trackLiked: vi.fn(async () => ({ liked: [] })),
}));

// el store también importa los accessors del ajuste de "up next": el mock del
// módulo tiene que traerlos o la importación entera revienta. Apagado, checkQueue
// no pide la cola, que es lo que interesa aquí
vi.mock('$lib/api', () => ({
  api: mocks,
  getNowPlayingUpNext: () => false,
  onNowPlayingUpNextChange: () => () => {},
}));

import { nowPlayingStore } from './now-playing.svelte';

function makeResponse(trackId: string, name: string): NowPlayingResponse {
  return {
    playing: true,
    isPlaying: true,
    track: {
      id: trackId,
      name,
      durationMs: 200_000,
      album: { id: 'album-1', name: 'Album', imageUrl: null },
      artists: [{ id: 'artist-1', name: 'Artist' }],
    },
    updatedAt: new Date().toISOString(),
  };
}

describe('nowPlayingStore.playContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.playbackPlayContext.mockReset().mockResolvedValue({ success: true });
    mocks.nowPlayingLive.mockReset();
    mocks.nowPlaying.mockReset();
  });

  it('actualiza el now playing aunque spotify tarde en reflejar el nuevo estado', async () => {
    // estado inicial: sonando track A
    nowPlayingStore.data = makeResponse('track-a', 'Old Song');

    // spotify es eventualmente consistente: la primera lectura tras el play
    // todavía devuelve el track anterior; las siguientes ya devuelven el nuevo
    const stale = makeResponse('track-a', 'Old Song');
    const fresh = makeResponse('track-b', 'New Song');
    mocks.nowPlayingLive.mockImplementation(async () =>
      mocks.nowPlayingLive.mock.calls.length <= 1 ? stale : fresh
    );
    // el estado cacheado del backend (poll de 30s) sigue obsoleto todo el rato
    mocks.nowPlaying.mockResolvedValue(stale);

    const result = await nowPlayingStore.playContext({ context_uri: 'spotify:album:album-2' });
    expect(result?.success).toBe(true);

    // margen de sobra para cualquier reintento razonable (10s virtuales)
    await vi.advanceTimersByTimeAsync(10_000);

    expect(nowPlayingStore.data?.track?.id).toBe('track-b');
  });
});

describe('nowPlayingStore: frescura del estado cacheado', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.nowPlayingLive.mockReset();
    mocks.nowPlaying.mockReset();
  });

  it('aplica el cacheado en cuanto el servidor tiene información más nueva que la lectura en vivo', async () => {
    const t0 = Date.now();
    mocks.nowPlayingLive.mockResolvedValue({ ...makeResponse('track-g', 'Song'), progressMs: 0, updatedAt: new Date(t0).toISOString() });
    await nowPlayingStore.pollLive();
    expect(nowPlayingStore.data?.track?.id).toBe('track-g');

    // el servidor re-pollea tras la acción y ya ve el siguiente track: se
    // aplica sin esperar a que expire ninguna ventana fija
    mocks.nowPlaying.mockResolvedValue({ ...makeResponse('track-h', 'Next'), progressMs: 0, updatedAt: new Date(t0 + 1_000).toISOString() });
    nowPlayingStore.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    nowPlayingStore.stopPolling();

    expect(nowPlayingStore.data?.track?.id).toBe('track-h');
  });

  it('descarta el cacheado medido antes de la lectura en vivo', async () => {
    const t0 = Date.now();
    mocks.nowPlayingLive.mockResolvedValue({ ...makeResponse('track-i', 'Song'), progressMs: 0, updatedAt: new Date(t0).toISOString() });
    await nowPlayingStore.pollLive();

    // snapshot del servidor anterior a la acción: devolvería el track viejo
    mocks.nowPlaying.mockResolvedValue({ ...makeResponse('track-old', 'Old'), progressMs: 0, updatedAt: new Date(t0 - 5_000).toISOString() });
    nowPlayingStore.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    nowPlayingStore.stopPolling();

    expect(nowPlayingStore.data?.track?.id).toBe('track-i');
  });
});

describe('nowPlayingStore: refresco en el límite del track', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.nowPlayingLive.mockReset();
    mocks.nowPlaying.mockReset();
  });

  it('detecta el cambio al acabar el track sin esperar al tick de 10s', async () => {
    const t0 = Date.now();
    // lectura en vivo a 1s del final (duración 200s)
    mocks.nowPlayingLive.mockResolvedValue({ ...makeResponse('track-j', 'Song'), progressMs: 199_000, updatedAt: new Date(t0).toISOString() });
    await nowPlayingStore.pollLive();

    mocks.nowPlaying.mockResolvedValue({ ...makeResponse('track-j', 'Song'), progressMs: 199_000, updatedAt: new Date(t0 + 1).toISOString() });
    nowPlayingStore.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(nowPlayingStore.data?.track?.id).toBe('track-j');

    // el servidor ya tiene el siguiente track (su poll apunta al final + buffer)
    mocks.nowPlaying.mockResolvedValue({ ...makeResponse('track-k', 'Next'), progressMs: 0, updatedAt: new Date(t0 + 3_000).toISOString() });

    // 1s restante + margen: muy por debajo del tick de 10s
    await vi.advanceTimersByTimeAsync(3_000);
    nowPlayingStore.stopPolling();

    expect(nowPlayingStore.data?.track?.id).toBe('track-k');
  });
});

describe('nowPlayingStore.progressMsAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.nowPlayingLive.mockReset();
  });

  it('extrapola el progreso mientras suena y lo congela al pausar', async () => {
    mocks.nowPlayingLive.mockResolvedValue({ ...makeResponse('track-c', 'Song'), progressMs: 10_000 });
    await nowPlayingStore.pollLive();

    expect(nowPlayingStore.progressMsAt(Date.now())).toBe(10_000);

    // sonando: el progreso avanza con el reloj
    await vi.advanceTimersByTimeAsync(5_000);
    expect(nowPlayingStore.progressMsAt(Date.now())).toBe(15_000);

    // pausa local (spread con progressMs obsoleto): congela el valor extrapolado
    nowPlayingStore.data = { ...nowPlayingStore.data!, isPlaying: false };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(nowPlayingStore.progressMsAt(Date.now())).toBe(15_000);

    // nunca supera la duración del track
    nowPlayingStore.data = { ...nowPlayingStore.data!, isPlaying: true };
    await vi.advanceTimersByTimeAsync(600_000);
    expect(nowPlayingStore.progressMsAt(Date.now())).toBe(200_000);
  });

  it('el seek es optimista y las lecturas cacheadas previas no lo retroceden', async () => {
    const preSeek = { ...makeResponse('track-d', 'Song'), progressMs: 30_000 };
    mocks.nowPlayingLive.mockResolvedValue(preSeek);
    await nowPlayingStore.pollLive();

    nowPlayingStore.seek(120_000);
    expect(nowPlayingStore.progressMsAt(Date.now())).toBe(120_000);

    // la llamada real sale tras el debounce
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.playbackSeek).toHaveBeenCalledWith(120_000);

    // un poll cacheado con el snapshot anterior al seek no debe aplicar
    mocks.nowPlaying.mockResolvedValue(preSeek);
    nowPlayingStore.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    nowPlayingStore.stopPolling();
    expect(nowPlayingStore.progressMsAt(Date.now())).toBe(121_000);
  });
});

describe('nowPlayingStore.isLive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const liveIds = {
    track: ['track-canonical'],
    album: ['album-canonical', 'collection:3'],
    artist: ['artist-added', 'artist-canonical'],
  };

  it('enciende el tema y el álbum crudos más sus canónicos y su colección', () => {
    nowPlayingStore.data = { ...makeResponse('track-e', 'Song'), liveIds };
    expect(nowPlayingStore.isLive('track', 'track-e')).toBe(true);
    expect(nowPlayingStore.isLive('track', 'track-canonical')).toBe(true);
    expect(nowPlayingStore.isLive('album', 'album-1')).toBe(true);
    expect(nowPlayingStore.isLive('album', 'collection:3')).toBe(true);
    expect(nowPlayingStore.isLive('album', 'album-other')).toBe(false);
    expect(nowPlayingStore.isLive('album', null)).toBe(false);
  });

  it('en artistas manda la lista del usuario: un crédito quitado no se enciende', () => {
    nowPlayingStore.data = { ...makeResponse('track-f', 'Song'), liveIds };
    expect(nowPlayingStore.isLive('artist', 'artist-added')).toBe(true);
    expect(nowPlayingStore.isLive('artist', 'artist-canonical')).toBe(true);
    // artist-1 es el crédito de spotify que el usuario sacó de la lista
    expect(nowPlayingStore.isLive('artist', 'artist-1')).toBe(false);
  });

  it('sin liveIds (api anterior o tema fuera de la biblioteca) casan los crudos', () => {
    nowPlayingStore.data = makeResponse('track-g', 'Song');
    expect(nowPlayingStore.isLive('track', 'track-g')).toBe(true);
    expect(nowPlayingStore.isLive('album', 'album-1')).toBe(true);
    expect(nowPlayingStore.isLive('artist', 'artist-1')).toBe(true);
    expect(nowPlayingStore.isLive('album', 'collection:3')).toBe(false);
  });

  it('en pausa no enciende nada', () => {
    nowPlayingStore.data = { ...makeResponse('track-h', 'Song'), isPlaying: false, liveIds };
    expect(nowPlayingStore.isLive('track', 'track-h')).toBe(false);
    expect(nowPlayingStore.isLive('album', 'collection:3')).toBe(false);
    expect(nowPlayingStore.isLive('artist', 'artist-added')).toBe(false);
  });
});

describe('nowPlayingStore.refreshIfStale', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.nowPlayingLive.mockReset();
    mocks.nowPlaying.mockReset();
  });

  it('relee spotify en vivo al volver si lo pintado se midió hace rato, una vez por ráfaga', async () => {
    mocks.nowPlayingLive.mockResolvedValue({ ...makeResponse('track-l', 'Song'), progressMs: 0 });
    await nowPlayingStore.pollLive();
    // el poller del servidor no ha vuelto a leer desde entonces
    mocks.nowPlaying.mockResolvedValue({ ...makeResponse('track-l', 'Song'), progressMs: 0, updatedAt: new Date(Date.now() - 1_000).toISOString() });
    nowPlayingStore.startPolling();
    await vi.advanceTimersByTimeAsync(0);

    // recién leído: volver a la app no gasta otra llamada a spotify
    nowPlayingStore.refreshIfStale();
    expect(mocks.nowPlayingLive).toHaveBeenCalledTimes(1);

    // un rato después se salta de tema desde otro dispositivo
    await vi.advanceTimersByTimeAsync(20_000);
    mocks.nowPlayingLive.mockResolvedValue({ ...makeResponse('track-m', 'Next'), progressMs: 0 });
    // visibilitychange y focus llegan juntos: una sola lectura
    nowPlayingStore.refreshIfStale();
    nowPlayingStore.refreshIfStale();
    await vi.advanceTimersByTimeAsync(0);
    nowPlayingStore.stopPolling();

    expect(mocks.nowPlayingLive).toHaveBeenCalledTimes(2);
    expect(nowPlayingStore.data?.track?.id).toBe('track-m');
  });

  it('sin token de spotify (solo-last.fm) relee el cacheado: no hay lectura en vivo', async () => {
    // nada sonando: desarma el guard de la lectura en vivo de los tests anteriores
    mocks.nowPlayingLive.mockResolvedValue({ playing: false, isPlaying: false });
    await nowPlayingStore.pollLive();
    mocks.nowPlaying.mockResolvedValue({ ...makeResponse('track-n', 'Song'), controllable: false, progressMs: 0, updatedAt: new Date(Date.now() - 60_000).toISOString() });
    nowPlayingStore.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(nowPlayingStore.data?.track?.id).toBe('track-n');

    nowPlayingStore.refreshIfStale();
    await vi.advanceTimersByTimeAsync(0);
    nowPlayingStore.stopPolling();

    expect(mocks.nowPlayingLive).toHaveBeenCalledTimes(1);
    expect(mocks.nowPlaying).toHaveBeenCalledTimes(2);
  });

  it('sin el polling en marcha (antes del gate de login) no pide nada', () => {
    nowPlayingStore.refreshIfStale();
    expect(mocks.nowPlayingLive).not.toHaveBeenCalled();
    expect(mocks.nowPlaying).not.toHaveBeenCalled();
  });
});
