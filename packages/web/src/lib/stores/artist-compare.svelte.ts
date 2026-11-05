// buscador global de "comparar con…": una instancia de <SearchModal> en modo pick vive en el
// layout raíz y se abre desde el menú del hero de un artista, desde el menú contextual de
// cualquier fila de artista y desde la propia comparación, para cambiar a uno de los dos.
import type { VersusSide } from '$lib/utils/artist-versus';

export interface ArtistCompareTarget {
  id: string;
  name: string;
  // lado en el que se queda el artista conservado: elegir rival no lo mueve de sitio
  side: VersusSide;
}

let target = $state<ArtistCompareTarget | null>(null);

export const artistCompare = {
  get target() { return target; },
  open(artist: { id: string; name: string }, side: VersusSide = 'a') { target = { ...artist, side }; },
  close() { target = null; },
};
