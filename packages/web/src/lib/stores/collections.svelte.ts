// Índice de las colecciones del usuario, cargado una vez por sesión.
//
// Existe por el menú contextual: la acción "Add to collection" sólo se ofrece si el
// artista de la fila tiene alguna colección, y ese menú se arma de forma SÍNCRONA
// (`entityContextActions` devuelve un array, no una promesa). Preguntar al servidor en
// cada click derecho sería una petición por menú y una entrada que aparece tarde, así
// que la respuesta vive aquí y se invalida al crear o borrar una colección.
//
// El índice es deliberadamente barato (sin cifras, ver getCollectionsIndex): son unas
// pocas filas y sólo hacen falta los ids de artista.
import { api, type CollectionIndexItem } from '$lib/api';

let items = $state<CollectionIndexItem[]>([]);
let loaded = false;
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  try {
    items = await api.collectionsIndex();
    loaded = true;
  } catch {
    // sin índice el menú simplemente no ofrece la acción: nunca es un error que
    // merezca un toast, y el siguiente ensure() lo reintenta
    items = [];
  } finally {
    inflight = null;
  }
}

export const collectionsStore = {
  get items() { return items; },

  /** Carga el índice si hace falta. Idempotente y con deduplicación de vuelos. */
  ensure(): Promise<void> {
    if (loaded) return Promise.resolve();
    inflight ??= load();
    return inflight;
  },

  /** ¿Tiene este artista alguna colección? `artistId` puede ser un alias de merge:
   *  cada fila del índice trae el grupo entero. */
  hasForArtist(artistId: string | undefined | null): boolean {
    if (!artistId) return false;
    return items.some(c => c.artistIds.includes(artistId));
  },

  /** Nombre del artista tal y como lo conoce el índice; '' si no hay colección suya. */
  artistName(artistId: string | undefined | null): string {
    if (!artistId) return '';
    return items.find(c => c.artistIds.includes(artistId))?.artistName ?? '';
  },

  /** Tras crear o borrar una colección. Recarga en el sitio para que el próximo menú
   *  ya la refleje sin esperar a un ensure(). */
  invalidate(): void {
    loaded = false;
    inflight = load();
  },
};
