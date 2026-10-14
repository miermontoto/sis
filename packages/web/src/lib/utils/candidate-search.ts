// Búsqueda en cliente sobre el pool de candidatos de los modales de merge y de relaciones.
// El pool de artistas son todos los que tienen escuchas (~10k), así que lo que cuesta por
// nombre —normalizar y puntuar el parecido con el target— se calcula UNA vez por carga, y
// cada tecla es un `includes` sobre cadenas ya preparadas (antes, dos NFD por candidato y
// pulsación).

// tope de filas pintadas: sin él una sola letra pintaba 6.4k filas con su <img> en un
// frame de 1.5s. Se recorta después de filtrar sobre el pool entero, así que el tope no
// esconde resultados de una búsqueda concreta: sólo pide afinarla
export const CANDIDATE_LIMIT = 60;
// parecido mínimo (trigramas) para contar como sugerencia sin haber escrito nada
export const SIMILAR_THRESHOLD = 0.3;

export interface Candidate { id: string; name: string; plays: number }
export interface IndexedCandidate<T extends Candidate> { item: T; key: string; sim: number }

export const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// nombre sin sufijo de versión: "song - remastered" / "song (live)" → "song"
const coreName = (s: string) => s.split(/ - | \(/)[0].trim();

function trigrams(s: string): Set<string> {
  const t = new Set<string>();
  for (let i = 0; i <= s.length - 3; i++) t.add(s.slice(i, i + 3));
  return t;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return common / Math.max(a.size, b.size);
}

/** normaliza cada candidato y, si hay `targetName`, puntúa su parecido con el target: el
 *  mejor de nombre completo y núcleo (sin sufijo de versión) contra los dos del target */
export function indexCandidates<T extends Candidate>(items: readonly T[], targetName?: string): IndexedCandidate<T>[] {
  if (targetName === undefined) return items.map(item => ({ item, key: normName(item.name), sim: 0 }));
  const targetKey = normName(targetName);
  const targetCore = coreName(targetKey);
  const targetTri = trigrams(targetKey);
  const targetCoreTri = targetCore !== targetKey ? trigrams(targetCore) : targetTri;
  return items.map(item => {
    const key = normName(item.name);
    const core = coreName(key);
    const keyTri = trigrams(key);
    const full = similarity(keyTri, targetTri);
    const coreSim = core !== key
      ? Math.max(similarity(trigrams(core), targetTri), similarity(trigrams(core), targetCoreTri))
      : similarity(keyTri, targetCoreTri);
    return { item, key, sim: Math.max(full, coreSim) };
  });
}

const bySimThenPlays = <T extends Candidate>(x: IndexedCandidate<T>, y: IndexedCandidate<T>) =>
  y.sim - x.sim || y.item.plays - x.item.plays;

/** subcadena sin acentos ni mayúsculas, los más parecidos al target primero y luego por
 *  plays. Basta con el nombre completo: su núcleo es un prefijo suyo */
export function searchCandidates<T extends Candidate>(index: readonly IndexedCandidate<T>[], query: string): T[] {
  const q = normName(query);
  return index.filter(c => c.key.includes(q)).sort(bySimThenPlays).map(c => c.item);
}

/** sin texto: los parecidos al target primero y, salvo `onlySimilar`, el resto detrás por plays */
export function suggestCandidates<T extends Candidate>(index: readonly IndexedCandidate<T>[], onlySimilar: boolean): T[] {
  const similar = index.filter(c => c.sim >= SIMILAR_THRESHOLD).sort(bySimThenPlays);
  if (onlySimilar) return similar.map(c => c.item);
  const rest = index.filter(c => c.sim < SIMILAR_THRESHOLD).sort((x, y) => y.item.plays - x.item.plays);
  return [...similar, ...rest].map(c => c.item);
}
