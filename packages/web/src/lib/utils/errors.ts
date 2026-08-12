// Helpers para los `catch`. Con `strict` la variable capturada es `unknown`, así que
// leer .name/.message obliga a estrechar el tipo; anotarla `: any` sólo para acceder a
// una propiedad tapa el resto del bloque. Estos dos casos cubren todos los catch del
// paquete: detectar la cancelación de un fetch y sacar el mensaje para enseñarlo.

// fetch rechaza con un DOMException llamado 'AbortError', pero algún origen puede
// lanzar un Error normal con ese mismo name; se aceptan los dos sin castear.
export function isAbortError(e: unknown): boolean {
  return (e instanceof DOMException || e instanceof Error) && isAbortError(e);
}

/** Mensaje del error, o `fallback` si no es un Error o viene vacío. */
export function errorMessage(e: unknown, fallback = 'Error inesperado'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
