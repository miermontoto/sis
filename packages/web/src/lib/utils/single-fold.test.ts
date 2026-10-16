import { describe, it, expect } from 'vitest';
import { inFoldWindow, pickSingleFold, type FoldRelease, type FoldTrack } from '@sis/shared';

const DAY_MS = 24 * 60 * 60_000;
const OPTS = { maxLeadMs: 730 * DAY_MS, durationToleranceMs: 5_000 };

const track = (id: string, key: string, durationMs: number, isrc: string | null = null, locked = false): FoldTrack =>
  ({ id, key, durationMs, isrc, locked });
const release = (id: string, releaseDate: string, tracks: FoldTrack[]): FoldRelease => ({ id, releaseDate, tracks });

// hurry up tomorrow y sus singles reales (fechas de spotify)
const hut = release('hut', '2025-01-31', [
  track('hut-1', 'wake me up', 307_763, 'USUG1'),
  track('hut-dance', 'dancing in the flames', 220_036, 'USUG2'),
  track('hut-sp', 'sao paulo', 301_623, 'USUG3'),
  track('hut-oh', 'open hearts', 234_923, 'USUG4'),
]);

describe('inFoldWindow', () => {
  it('acepta el álbum posterior dentro de la ventana', () => {
    expect(inFoldWindow(release('s', '2024-09-13', []), hut, OPTS.maxLeadMs)).toBe(true);
  });

  it('rechaza un álbum anterior al single', () => {
    expect(inFoldWindow(release('s', '2025-03-01', []), hut, OPTS.maxLeadMs)).toBe(false);
  });

  it('rechaza un álbum fuera de la ventana de adelanto', () => {
    expect(inFoldWindow(release('s', '2021-02-26', []), hut, OPTS.maxLeadMs)).toBe(false);
  });

  it('es indulgente con la precisión: un álbum con sólo el año no queda antes del single', () => {
    expect(inFoldWindow(release('s', '2024-09-13', []), release('a', '2024', []), OPTS.maxLeadMs)).toBe(true);
    expect(inFoldWindow(release('s', '2024-09', []), release('a', '2024-09-01', []), OPTS.maxLeadMs)).toBe(true);
  });

  it('una fecha ilegible no entra', () => {
    expect(inFoldWindow(release('s', '', []), hut, OPTS.maxLeadMs)).toBe(false);
  });
});

describe('pickSingleFold', () => {
  it('pliega el single y empareja el tema que es la misma grabación', () => {
    const single = release('dance', '2024-09-13', [track('s-dance', 'dancing in the flames', 220_036, 'USUG2')]);
    expect(pickSingleFold(single, [hut], OPTS)).toEqual({
      albumId: 'hut',
      trackPairs: [{ sourceTrackId: 's-dance', targetTrackId: 'hut-dance' }],
    });
  });

  it('una versión distinta pliega el single pero no el track', () => {
    // mismo título, otra grabación: el single de 5:39 frente al corte de 9:07
    const runaway = release('runaway-single', '2010-10-04', [track('s-run', 'runaway', 339_000, 'USUM71024424')]);
    const mbdtf = release('mbdtf', '2010-11-22', [track('a-run', 'runaway', 547_000, 'USUM71027402')]);
    expect(pickSingleFold(runaway, [mbdtf], OPTS)).toEqual({ albumId: 'mbdtf', trackPairs: [] });
  });

  it('dos isrc distintos no son la misma grabación aunque duren lo mismo', () => {
    const single = release('s', '2024-09-13', [track('s-dance', 'dancing in the flames', 220_036, 'OTHER')]);
    expect(pickSingleFold(single, [hut], OPTS)?.trackPairs).toEqual([]);
  });

  it('una duración desconocida no se empareja a ciegas', () => {
    const single = release('s', '2024-09-13', [track('s-dance', 'dancing in the flames', 0)]);
    expect(pickSingleFold(single, [hut], OPTS)?.trackPairs).toEqual([]);
  });

  it('un B-side que el álbum no lleva deja el single como lanzamiento propio', () => {
    const single = release('s', '2024-09-13', [
      track('s-dance', 'dancing in the flames', 220_036),
      track('s-inst', 'dancing in the flames instrumental', 219_000),
    ]);
    expect(pickSingleFold(single, [hut], OPTS)).toBeNull();
  });

  it('un single vacío no se pliega en nada', () => {
    expect(pickSingleFold(release('s', '2024-09-13', []), [hut], OPTS)).toBeNull();
  });

  it('gana el primer álbum en salir, no la deluxe posterior', () => {
    const deluxe = release('deluxe', '2025-06-01', [...hut.tracks.map(t => ({ ...t, id: `dx-${t.id}` })), track('dx-bonus', 'bonus', 200_000)]);
    const single = release('s', '2024-09-13', [track('s-dance', 'dancing in the flames', 220_036)]);
    expect(pickSingleFold(single, [deluxe, hut], OPTS)?.albumId).toBe('hut');
  });

  it('un track ya mergeado cuenta para pertenecer pero no entra en un merge nuevo', () => {
    const single = release('s', '2024-09-13', [track('s-dance', 'dancing in the flames', 220_036, null, true)]);
    expect(pickSingleFold(single, [hut], OPTS)).toEqual({ albumId: 'hut', trackPairs: [] });
  });

  it('el destino bloqueado tampoco se usa', () => {
    const album = release('a', '2025-01-31', [track('a-dance', 'dancing in the flames', 220_036, null, true)]);
    const single = release('s', '2024-09-13', [track('s-dance', 'dancing in the flames', 220_036)]);
    expect(pickSingleFold(single, [album], OPTS)).toEqual({ albumId: 'a', trackPairs: [] });
  });

  it('cada tema del álbum recibe como mucho un merge, el de duración más cercana', () => {
    const album = release('a', '2025-01-31', [track('a-1', 'song', 200_000), track('a-2', 'song', 203_000)]);
    const single = release('s', '2024-09-13', [track('s-1', 'song', 203_500), track('s-2', 'song', 199_000)]);
    expect(pickSingleFold(single, [album], OPTS)?.trackPairs).toEqual([
      { sourceTrackId: 's-1', targetTrackId: 'a-2' },
      { sourceTrackId: 's-2', targetTrackId: 'a-1' },
    ]);
  });
});
