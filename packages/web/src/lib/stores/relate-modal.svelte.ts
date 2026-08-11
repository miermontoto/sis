// Modal de relaciones global: una instancia de <RelateArtistModal> vive en el layout raíz
// y se abre desde cualquier parte (menú contextual, página de artista) pasando el target.
// Mismo patrón que merge-modal, pero aquí no hay canónico: la relación es simétrica.
import { api } from '$lib/api';
import type { RelatedArtist } from '$lib/api';

export interface RelateModalTarget {
  target: { id: string; name: string; imageUrl: string | null };
  existing: RelatedArtist[];
  /** Callback opcional invocado tras un cambio (relación creada o borrada). */
  onChanged?: () => void;
}

let target = $state<RelateModalTarget | null>(null);
let changeVersion = $state(0);

// se carga la lista completa y se filtra en cliente, igual que el modal de merges: la
// tabla de relaciones es pequeña y así no hace falta un endpoint por artista.
// Al ser simétrica, el artista consultado puede estar en cualquiera de los dos lados.
async function resolveExisting(artistId: string): Promise<RelatedArtist[]> {
  try {
    const all = await api.listArtistRelations();
    return all
      .filter(r => r.a_id === artistId || r.b_id === artistId)
      .map(r => (r.a_id === artistId
        ? { id: r.b_id, ruleIds: [r.id], name: r.b_name, imageUrl: r.b_image }
        : { id: r.a_id, ruleIds: [r.id], name: r.a_name, imageUrl: r.a_image }));
  } catch {
    return [];
  }
}

export const relateModal = {
  get target() { return target; },
  get changeVersion() { return changeVersion; },
  async open(opts: { target: { id: string; name: string; imageUrl: string | null }; onChanged?: () => void }) {
    target = { ...opts, existing: await resolveExisting(opts.target.id) };
  },
  close() { target = null; },
  /** Recarga `existing` tras un cambio (crear/borrar) sin cerrar el modal. */
  async refresh() {
    if (!target) return;
    target = { ...target, existing: await resolveExisting(target.target.id) };
  },
  notifyChange() { changeVersion++; },
};
