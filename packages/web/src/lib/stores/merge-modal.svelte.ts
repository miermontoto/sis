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
  // el modal no se abre hasta tener esto: nada de cargar la lista entera y filtrarla aquí,
  // que eran 480kB y ~300ms bloqueando el servidor por cada apertura
  try {
    const sources = await api.mergeSources(entityType, targetId);
    return sources.map(m => ({ id: m.source_id, ruleId: m.rule_id, name: m.name, imageUrl: m.image_url }));
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
    const current = target;
    if (!current) return;
    const existingMerges = await resolveExistingMerges(current.entityType, current.target.id);
    // el modal pudo cerrarse (o pasar a otro target) durante la espera: el spread se
    // evaluaba ANTES del await, así que reabría con el target viejo justo después de
    // que un merge lo cerrase
    if (target === current) target = { ...current, existingMerges };
  },
  notifyChange() { changeVersion++; },
};
