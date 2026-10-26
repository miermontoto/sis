import { describe, it, expect } from 'vitest';
import { isNoCache, getConfig, HISTORY_BOUND_PREFIXES } from './config';

// la invalidación casa por prefijo contra la clave entera (path + query)
const hitsHistoryBound = (key: string) => HISTORY_BOUND_PREFIXES.some(p => key.startsWith(p));

// se purgan con CADA play confirmado: un prefijo demasiado ancho tiraría caches
// caras de los detalles cada tres minutos
describe('HISTORY_BOUND_PREFIXES', () => {
  it('cubre la tarjeta de hover y sus ranks', () => {
    expect(hitsHistoryBound('/stats/card/track/08ir631EiCA7xIms7JDp15')).toBe(true);
    expect(hitsHistoryBound('/stats/card/album/collection:3')).toBe(true);
    expect(hitsHistoryBound('/stats/rankings/artist/7dGJo4pcD2V6oG8kP0tJRR?sort=time')).toBe(true);
  });

  it('no arrastra a los rankings por lote ni al historial de ranking del detalle', () => {
    expect(hitsHistoryBound('/stats/rankings-batch?ids=a,b&sort=time&type=track')).toBe(false);
    expect(hitsHistoryBound('/stats/ranking-history/track/abc?crossovers=true')).toBe(false);
    expect(hitsHistoryBound('/stats/track/08ir631EiCA7xIms7JDp15')).toBe(false);
  });

  it('son cacheables: el punto es invalidarlos, no saltarse la cache', () => {
    expect(HISTORY_BOUND_PREFIXES.every(p => !isNoCache(p))).toBe(true);
  });
});

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
