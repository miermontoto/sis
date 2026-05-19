// Modal de merge global: una instancia de <MergeEntityModal> vive en el layout raíz y
// se abre desde cualquier parte (p. ej. menú contextual) pasando el target.
import { api } from '$lib/api';

type EntityType = 'album' | 'artist' | 'track';

export interface MergeModalTarget {
  entityType: EntityType;
  target: { id: string; name: string; imageUrl: string | null };
  parentId?: string;
  existingMerges: { id: string; ruleId: number; name: string; imageUrl: string | null }[];
  initialStep?: 'select' | 'remerge';
  /** Callback opcional invocado tras un cambio (merge creado o borrado). */
  onChanged?: () => void;
}

let target = $state<MergeModalTarget | null>(null);
let changeVersion = $state(0);

async function resolveExistingMerges(entityType: EntityType, targetId: string) {
  // cargamos todas las reglas y filtramos. Evita añadir un endpoint nuevo y es ligero en tamaño.
  try {
    const all = await api.listMerges();
    return all
      .filter(m => m.entity_type === entityType && m.target_id === targetId)
      .map(m => ({ id: m.source_id, ruleId: m.id, name: m.source_name, imageUrl: m.source_image }));
  } catch {
    return [];
  }
}

export const mergeModal = {
  get target() { return target; },
  get changeVersion() { return changeVersion; },
  async open(opts: { entityType: EntityType; target: { id: string; name: string; imageUrl: string | null }; parentId?: string; onChanged?: () => void }) {
    const existingMerges = await resolveExistingMerges(opts.entityType, opts.target.id);
    target = { ...opts, existingMerges };
  },
  close() { target = null; },
  /** Recarga existingMerges tras un cambio (crear/borrar) sin cerrar el modal. */
  async refresh() {
    if (!target) return;
    target = { ...target, existingMerges: await resolveExistingMerges(target.entityType, target.target.id) };
  },
  notifyChange() { changeVersion++; },
};
