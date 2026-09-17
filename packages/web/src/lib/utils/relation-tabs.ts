// Las dos caras de una relación entre artistas, como pestañas del mismo modal:
// "merge" absorbe un artista dentro de otro (las escuchas se suman) y "relate"
// declara el vínculo sin tocar el tracking. Una sola tabla para que las dos
// pestañas digan lo mismo desde los dos modales.
export const RELATION_TABS = [
  { value: 'merge', label: 'Merge' },
  { value: 'relate', label: 'Relate' },
];
