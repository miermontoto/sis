import { describe, it, expect } from 'vitest';
import { isNoCache, getConfig } from './config';

describe('isNoCache', () => {
  it('casa las rutas exactas del set', () => {
    expect(isNoCache('/settings')).toBe(true);
    expect(isNoCache('/lastfm')).toBe(true);
    expect(isNoCache('/now-playing')).toBe(true);
    expect(isNoCache('/stats/top-tracks')).toBe(false);
  });

  // la búsqueda de setlist.fm lleva `configured`, una capacidad del servidor que
  // ninguna mutación invalida: cacheada dejaba la pestaña deshabilitada durante
  // horas después de configurar la API key
  it('casa por prefijo las rutas con id variable que no se pueden enumerar', () => {
    expect(isNoCache('/concerts/setlistfm/3YQKmKGau1PzlVlkL1iodx')).toBe(true);
    expect(isNoCache('/concerts/setlistfm/otro-artista')).toBe(true);
  });

  it('no arrastra al resto del registro de conciertos, que sí se cachea', () => {
    expect(isNoCache('/concerts')).toBe(false);
    expect(isNoCache('/concerts/artist/3YQKmKGau1PzlVlkL1iodx')).toBe(false);
    expect(getConfig('/concerts').ttl).toBeGreaterThan(0);
  });
});
