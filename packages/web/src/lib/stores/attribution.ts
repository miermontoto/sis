// "Cambió a qué entidad cuenta un play": un merge, una colección o unos créditos
// corregidos. Cada mutación sube el changeVersion de su propio store; quien enseña cifras
// o posiciones lee los tres juntos con esto, y relee con cualquiera de ellos. Leerlos a
// mano dejaba fuera al que faltase: los merges no movían el dashboard, los tops ni las
// posiciones del hero del detalle. Las relaciones soft no entran, porque no tocan el
// tracking (ver relateModal.changeVersion)
import { mergeModal } from './merge-modal.svelte';
import { collectionsStore } from './collections.svelte';
import { creditsModal } from './credits-modal.svelte';

export const attributionVersion = () =>
  `${mergeModal.changeVersion}:${collectionsStore.changeVersion}:${creditsModal.changeVersion}`;
