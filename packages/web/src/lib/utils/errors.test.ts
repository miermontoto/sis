import { describe, it, expect } from 'vitest';
import { isAbortError, errorMessage } from './errors';

// bug: al extraer estos helpers, la migración automática reescribió
// `e?.name === 'AbortError'` por `isAbortError(e)` también DENTRO de la propia
// definición, dejando la función llamándose a sí misma. tsc y svelte-check no ven
// una recursión infinita y el build pasaba, así que el fallo solo aparecía en
// runtime: cada fetch abortado —createFetchController aborta el anterior en cada
// recarga— reventaba con RangeError en el catch, en ~20 call sites.
//
// de ahí que estos tests llamen de verdad a las funciones: el gate de tipos no
// distingue un guard correcto de uno que no termina.

describe('isAbortError', () => {
  it('reconoce el DOMException con el que fetch rechaza al abortar', async () => {
    const ac = new AbortController();
    const pending = fetch('http://127.0.0.1:1/nada', { signal: ac.signal }).catch(e => e);
    ac.abort();
    expect(isAbortError(await pending)).toBe(true);
  });

  it('reconoce el reason de un signal abortado', () => {
    const ac = new AbortController();
    ac.abort();
    expect(isAbortError(ac.signal.reason)).toBe(true);
  });

  // duck typing deliberado: el guard decide entre tragarse el error y relanzarlo,
  // y mantiene la semántica del `e?.name === 'AbortError'` original. También cubre
  // los abort que cruzan realms (iframe/worker), donde instanceof fallaría.
  it('acepta cualquier objeto que se identifique como AbortError', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
  });

  it('no confunde otros errores ni valores sueltos', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});

describe('errorMessage', () => {
  it('devuelve el mensaje del Error (apiMutate propaga aquí el error del server)', () => {
    expect(errorMessage(new Error('missing_scopes'))).toBe('missing_scopes');
  });

  it('cae al fallback con mensaje vacío, como hacía el `err.message || ...` original', () => {
    expect(errorMessage(new Error(''), 'Import failed')).toBe('Import failed');
  });

  // a diferencia del guard, esto acaba en pantalla: un objeto suelto no debe
  // renderizar su .message
  it('cae al fallback si lo lanzado no es un Error', () => {
    expect(errorMessage({ message: 'de un objeto plano' })).toBe('Error inesperado');
  });
});
