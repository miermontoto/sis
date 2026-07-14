import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NowPlayingResponse } from '$lib/api';

// mock del cliente api: controla las respuestas de spotify sin red
const mocks = vi.hoisted(() => ({
  playbackPlayContext: vi.fn(),
  nowPlayingLive: vi.fn(),
  nowPlaying: vi.fn(),
  checkTrackLiked: vi.fn(async () => ({ isLiked: false })),
  trackPlaylists: vi.fn(async () => ({ playlists: [] })),
}));

vi.mock('$lib/api', () => ({ api: mocks }));

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
