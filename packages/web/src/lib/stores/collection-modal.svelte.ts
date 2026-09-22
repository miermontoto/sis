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

// Sólo la ventana: quién avisa de que una colección cambió es
// `collectionsStore.invalidate()`, que lo llaman todas las mutaciones y refresca a la
// vez el índice del menú y las vistas montadas. Dos señales para lo mismo era la
// forma de que una vista escuchara la que no se disparaba.
let target = $state<CollectionModalTarget | null>(null);

export const collectionModal = {
  get target() { return target; },
  open(opts: CollectionModalTarget) { target = opts; },
  close() { target = null; },
};
