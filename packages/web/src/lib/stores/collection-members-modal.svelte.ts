// "Relations" de una colección (también de un álbum que viene, que lo es por debajo): una
// colección no se mergea —no es un lanzamiento—, así que su forma de relacionarse con
// singles, EPs y temas es tenerlos dentro. Una instancia de <CollectionMembersModal> vive
// en el layout y la abren el menú contextual de su fila y el menú del hero de su página.
// Quién avisa de un cambio sigue siendo `collectionsStore.invalidate()`.
export interface CollectionMembersTarget {
  id: number;
  name: string;
}

let target = $state<CollectionMembersTarget | null>(null);

export const collectionMembersModal = {
  get target() { return target; },
  open(t: CollectionMembersTarget) { target = t; },
  close() { target = null; },
};
