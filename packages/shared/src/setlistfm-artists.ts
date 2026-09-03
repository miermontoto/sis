// Clasificación de las entidades de artista de setlist.fm.
//
// setlist.fm modela CADA variante de crédito como una entidad propia con su MBID:
// buscando "Bad Bunny" aparecen 30, entre ellas "J Balvin, Dua Lipa, Bad Bunny,
// Tainy" y "Jennifer Lopez & Bad Bunny"; buscando "Kendrick Lamar", otras 30,
// entre ellas "Kendrick Lamar & SZA" (la Grand National Tour) y "Kendrick Lamar
// feat. Big Pooh".
//
// Buscar setlists por `artistName` es una coincidencia de subcadena sobre TODAS
// ellas, así que mete bolos de otro artista (los de J Balvin bajo Bad Bunny) sin
// forma de distinguirlos. Lo correcto es resolver las entidades, decidir cuáles
// son de verdad este artista y filtrar por MBID.

export type SetlistfmBilling =
  // la entidad ES el artista
  | 'primary'
  // gira co-cabecera que él encabeza ("Kendrick Lamar & SZA")
  | 'coheadline'
  // aparece acompañando a otro: crédito de canción o cartel ajeno
  | 'guest';

// marcadores que degradan a nuestro artista a invitado aunque figure en el
// nombre. "Kendrick Lamar feat. Big Pooh" es un crédito de canción, no un bolo
const GUEST_MARKERS = /(\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bpresenta\b|\bpresents\b|\bvs\.?\b|\s+x\s+)/i;

// separadores de un cartel compartido: "A & B", "A, B", "A and B", "A with B"
const BILLING_SPLIT = /\s*(?:&|,|\+|\/|\band\b|\bwith\b)\s*/i;

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** ¿Qué relación tiene esta entidad de setlist.fm con el artista que buscamos? */
export function classifySetlistfmBilling(entityName: string, artistName: string): SetlistfmBilling {
  const entity = normalize(entityName);
  const artist = normalize(artistName);
  if (!entity || !artist) return 'guest';
  if (entity === artist) return 'primary';

  // un "feat." en cualquier posición marca crédito de canción, no de cartel
  if (GUEST_MARKERS.test(entityName)) return 'guest';

  // sólo cuenta encabezar: en "J Balvin, Dua Lipa, Bad Bunny, Tainy" el bolo es
  // de J Balvin, no de Bad Bunny, aunque los dos estuvieran en el escenario
  const [lead] = entityName.split(BILLING_SPLIT);
  return lead && normalize(lead) === artist ? 'coheadline' : 'guest';
}

/** MBIDs que cuentan como conciertos de este artista, con su etiqueta de cartel. */
export function acceptedSetlistfmArtists(
  entities: { mbid?: string | null; name?: string | null }[],
  artistName: string,
): { mbid: string; name: string; billing: Exclude<SetlistfmBilling, 'guest'> }[] {
  const out: { mbid: string; name: string; billing: Exclude<SetlistfmBilling, 'guest'> }[] = [];
  for (const e of entities) {
    if (!e.mbid || !e.name) continue;
    const billing = classifySetlistfmBilling(e.name, artistName);
    if (billing !== 'guest') out.push({ mbid: e.mbid, name: e.name, billing });
  }
  // el artista propiamente dicho primero, para que sea el MBID de referencia
  return out.sort((a, b) => (a.billing === 'primary' ? -1 : 0) - (b.billing === 'primary' ? -1 : 0));
}
