import { describe, it, expect } from 'vitest';
import { isTransientStatus, retryWaitMs } from './http-retry.js';

const FALLBACK_MS = 3_000;
const MAX_MS = 30_000;
const waitFor = (retryAfter?: string) =>
  retryWaitMs(new Response(null, { status: 503, headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter } }), FALLBACK_MS, MAX_MS);

describe('retryWaitMs', () => {
  // medido en musicbrainz el 2026-11-06: leerlo literal es reintentar al instante
  it('Retry-After: 0 cae al respaldo en vez de reintentar ya', () => {
    expect(waitFor('0')).toBe(FALLBACK_MS);
  });

  it('sin cabecera, o con la forma de fecha http, cae al respaldo', () => {
    expect(waitFor()).toBe(FALLBACK_MS);
    expect(waitFor('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(FALLBACK_MS);
  });

  it('respeta una espera real, acotada por el tope', () => {
    expect(waitFor('5')).toBe(5_000);
    expect(waitFor('3600')).toBe(MAX_MS);
  });
});

describe('isTransientStatus', () => {
  it.each([429, 500, 502, 503, 504])('%i se reintenta', (status) => {
    expect(isTransientStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404])('%i es definitivo', (status) => {
    expect(isTransientStatus(status)).toBe(false);
  });
});
