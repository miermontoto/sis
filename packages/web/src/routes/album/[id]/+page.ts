import { redirect } from '@sveltejs/kit';
import { parseCollectionKey } from '@sis/shared';

export const ssr = false;

// Las colecciones ("álbumes lógicos") viajan por el espacio de ids de álbum, así que
// cualquier fila de ranking, chart o record enlaza a /album/collection:N. En vez de
// enseñarle la clave a los ~28 sitios que construyen enlaces de álbum, la ruta la
// reconoce y manda a la página de la colección: imposible olvidarse en un sitio.
export function load({ params }) {
  const collectionId = parseCollectionKey(params.id);
  if (collectionId !== null) redirect(307, `/collection/${collectionId}`);
}
