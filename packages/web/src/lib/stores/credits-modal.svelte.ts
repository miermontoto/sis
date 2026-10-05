// Modal de créditos global: una instancia de <CreditsModal> vive en el layout raíz y se
// abre desde el menú del hero del tema o del álbum y desde el menú contextual de sus
// filas. El modal pide él mismo los créditos, así que aquí sólo viaja qué se corrige.
import type { CreditSubjectType } from '$lib/api';

export interface CreditsModalTarget {
  type: CreditSubjectType;
  entity: { id: string; name: string; imageUrl: string | null };
}

let target = $state<CreditsModalTarget | null>(null);
// sube con cada corrección guardada o deshecha: los créditos deciden a qué artista
// cuenta cada play, así que toda vista que rankea o pinta artistas relee con ella
// (purgar la cache no basta si nadie vuelve a pedir, ver collectionsStore)
let changeVersion = $state(0);

export const creditsModal = {
  get target() { return target; },
  get changeVersion() { return changeVersion; },
  open(opts: CreditsModalTarget) { target = opts; },
  close() { target = null; },
  notifyChange() { changeVersion++; },
};
