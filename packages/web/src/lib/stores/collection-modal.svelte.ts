// Modal de colecciones global: una instancia de <CollectionModal> vive en el layout
// raíz y se abre desde cualquier parte (el menú contextual de un álbum o un tema),
// igual que el de merges. El modal pide él mismo las colecciones elegibles de la
// entidad, así que aquí sólo viaja a quién se está colocando.
export interface CollectionModalTarget {
  entityType: 'album' | 'track';
  entity: { id: string; name: string; imageUrl: string | null };
  /** artista bajo el que se crearía una colección nueva desde el propio modal */
  artistId: string;
  artistName: string;
}

let target = $state<CollectionModalTarget | null>(null);
let changeVersion = $state(0);

export const collectionModal = {
  get target() { return target; },
  // lo miran las vistas que quieran recargarse cuando algo cambió desde el menú
  // contextual (el detalle de álbum y el de tema pintan su línea de pertenencia)
  get changeVersion() { return changeVersion; },
  open(opts: CollectionModalTarget) { target = opts; },
  close() { target = null; },
  notifyChange() { changeVersion++; },
};
