import { redirect } from '@sveltejs/kit';
import { collectionKey } from '@sis/shared';

export const ssr = false;

// Una colección ES un álbum (su fila vive en `albums` con el id `collection:N`), así
// que su página es la de álbum y no una vista paralela. Esta ruta se queda como la
// URL bonita: los enlaces que la app genera ya apuntan al id, y los que se
// compartieron antes siguen funcionando.
export function load({ params }) {
  redirect(307, `/album/${collectionKey(Number(params.id))}`);
}
