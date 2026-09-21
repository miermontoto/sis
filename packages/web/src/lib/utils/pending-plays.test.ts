import { describe, it, expect } from 'vitest';
import { mergePendingPlays } from './pending-plays';
import type { HistoryItem } from '$lib/api';

function play(id: number, trackId: string, playedAt: string, pending = false): HistoryItem {
  return {
    id,
    playedAt,
    contextType: null,
    track: { id: trackId, name: trackId, durationMs: 200_000, album: null, artists: [] },
    ...(pending ? { pending: true } : {}),
  };
}

describe('mergePendingPlays', () => {
  it('antepone un pendiente que todavía no tiene fila', () => {
    const items = [play(2, 'b', '2026-09-21T08:50:13.480Z')];
    const pending = [play(0, 'a', '2026-09-21T08:55:12.000Z', true)];
    const merged = mergePendingPlays(pending, items);
    expect(merged.map(i => i.track!.id)).toEqual(['a', 'b']);
  });

  it('descarta el pendiente cuyo play ya ha aterrizado con otra marca', () => {
    // el poller vio el corte a las 08:55:12; spotify guardó played_at 08:55:09.909
    const items = [play(3, 'a', '2026-09-21T08:55:09.909Z')];
    const pending = [play(0, 'a', '2026-09-21T08:55:12.000Z', true)];
    expect(mergePendingPlays(pending, items)).toBe(items);
  });

  it('no confunde dos escuchas distintas del mismo track', () => {
    const items = [play(3, 'a', '2026-09-21T08:10:00.000Z')];
    const pending = [play(0, 'a', '2026-09-21T08:55:12.000Z', true)];
    expect(mergePendingPlays(pending, items)).toHaveLength(2);
  });

  it('devuelve la misma lista cuando no hay pendientes', () => {
    const items = [play(1, 'a', '2026-09-21T08:50:13.480Z')];
    expect(mergePendingPlays([], items)).toBe(items);
  });
});
