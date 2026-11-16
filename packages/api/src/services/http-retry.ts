// reintentos de las apis externas: qué respuesta merece otro intento y cuánto esperar

// 429 y 5xx pueden cambiar en el siguiente intento; el resto de 4xx son definitivos
export const isTransientStatus = (status: number) => status === 429 || status >= 500;

// Retry-After manda sólo si trae una espera real: musicbrainz lo manda a 0 en sus 503, y
// leerlo literal sería reintentar al instante y volver a chocar con el límite. la forma de
// fecha http da NaN y también cae al respaldo. siempre acotada por el tope de cada api
export function retryWaitMs(res: Response, fallbackMs: number, maxMs: number): number {
  const seconds = Number(res.headers.get('Retry-After'));
  return Math.min(seconds > 0 ? seconds * 1000 : fallbackMs, maxMs);
}
