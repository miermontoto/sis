// Helpers para los `catch`. Con `strict` la variable capturada es `unknown`, así que
// leer .name/.message obliga a estrechar el tipo; anotarla `: any` sólo para acceder a
// una propiedad tapa el resto del bloque. Estos dos casos cubren todos los catch del
// paquete: detectar la cancelación de un fetch y sacar el mensaje para enseñarlo.

// Duck typing a propósito, no `instanceof`. Este guard decide entre tragarse el error
// y relanzarlo, así que conserva la semántica exacta del `e?.name === 'AbortError'`
// que había antes: cuenta cualquier cosa que se identifique como AbortError.
// `instanceof` además falla entre realms (iframe, worker), donde el DOMException
// viene de otro constructor y el abort acabaría relanzado como error real.
export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

// Aquí sí se exige Error: a diferencia del guard, esto acaba en pantalla, y todo lo
// que lanza el paquete (apiFetch/apiMutate, PublicShareError) es Error. Un objeto
// suelto cae al fallback en vez de renderizar el .message de cualquier cosa.
export function errorMessage(e: unknown, fallback = 'Error inesperado'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
