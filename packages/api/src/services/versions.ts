// deriva la clave "base" de un tema a partir de su nombre, quitando los qualifiers de variante
// (live, remix, remaster...) para agrupar versiones distintas del mismo tema. Espejo conceptual de
// dedup.ts, pero en vez de fusionar tracks del mismo nombre, agrupamos variantes con una base común.
//
// El pelado es conservador y guiado por palabras clave: solo se quita un segmento final (entre
// paréntesis, corchetes o tras " - ") si contiene una palabra clave de versión. Así "Song (Part 1)"
// NO colapsa con "Song (Part 2)" (Part no es keyword), pero "Song (Live)" sí comparte base con "Song".

// palabras clave que marcan una GRABACIÓN distinta: el segmento no es parte del título base,
// pero tampoco es el mismo audio (una toma en directo no es la de estudio)
export const VARIANT_KEYWORDS = [
  /\b(live|unplugged|en vivo|en directo|directo|concert|sessions?)\b/,
  /\b(acoustic|acustic[oa]?|stripped|piano version)\b/,
  /\b(remix|rework|bootleg|flip|club mix|dub|vip mix)\b/,
  /\b(remaster(ed)?|remasterizad[oa]|mono|stereo|anniversary)\b/,
  /\b(radio edit|radio version|single version|short version)\b/,
  /\b(extended|long version|full length)\b/,
  /\b(instrumental|karaoke)\b/,
  /\b(demo|take \d+|alternate|alternative|early version|rough)\b/,
  /\b(deluxe|bonus)\b/,
  /\b(edit|version|edicion|mix|rmx)\b/,
];

// palabras clave que solo cambian los CRÉDITOS, no la grabación: el mismo tema publicado
// acreditando (o no) a los invitados ("Walk On Water" ←→ "Walk On Water (feat. Beyoncé)").
// Anclados al inicio del segmento: "with" suelto dentro de un título no es un crédito.
export const CREDIT_KEYWORDS = [
  /^(feat\.?|featuring|ft\.?|with|con)\b/,
];

// para agrupar versiones vale cualquiera de los dos: ambos son qualifiers, no título base
const VERSION_KEYWORDS = [...VARIANT_KEYWORDS, ...CREDIT_KEYWORDS];

// segmento final entre paréntesis/corchetes, o tras " - " hasta el final
const TRAILING_SEGMENT = /\s*[([]([^()[\]]*)[)\]]\s*$|\s+-\s+([^-]+?)\s*$/;

const normalizeSegment = (text: string) =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function isVersionQualifier(text: string): boolean {
  return VERSION_KEYWORDS.some(re => re.test(normalizeSegment(text)));
}

// solo cr\u00e9ditos: el segmento empieza por feat./ft./with y NO menciona una variante de
// grabaci\u00f3n \u2014 "(Live feat. X)" cambia el audio, as\u00ed que no se pela
function isCreditQualifier(text: string): boolean {
  const t = normalizeSegment(text);
  return CREDIT_KEYWORDS.some(re => re.test(t)) && !VARIANT_KEYWORDS.some(re => re.test(t));
}

// pela segmentos finales mientras `isQualifier` los reconozca; devuelve el t\u00edtulo restante
function stripTrailingQualifiers(rawName: string, isQualifier: (text: string) => boolean): string {
  let name = rawName.trim();
  for (;;) {
    const m = name.match(TRAILING_SEGMENT);
    if (!m) break;
    const inner = (m[1] ?? m[2] ?? '').trim();
    if (!inner || !isQualifier(inner)) break; // no es qualifier: es parte del base
    const stripped = name.slice(0, name.length - m[0].length).trim();
    if (!stripped) break; // el nombre era \u00edntegramente qualifier: conservamos el base actual
    name = stripped;
  }
  return name;
}

// normaliza el título base a una clave estable para agrupar (sin acentos, sin puntuación,
// minúsculas, espacios colapsados).
function normalizeBase(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// clave de agrupación de versiones: título base normalizado tras pelar los qualifiers de versión
export function versionBaseKey(rawName: string): string {
  return normalizeBase(stripTrailingQualifiers(rawName, isVersionQualifier));
}

// una parte demasiado corta no identifica a un tema: descarta ruido de la partición
const MIN_MEDLEY_PART_LENGTH = 2;

// parte el título en los temas de un medley ("Heathens / Trees", "Robot Rock / Oh Yeah").
// dos restricciones para no partir lo que no es un medley: la barra necesita espacio en algún
// lado (si no, "Erase/Replace" o "POP/STARS" son títulos, no medleys) y tiene que estar a nivel
// 0 de paréntesis/corchetes ("Outro (Obie Trice/ Cheers)" es un crédito dentro del título).
function splitMedley(name: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === '/' && depth === 0 && (/\s/.test(name[i - 1] ?? '') || /\s/.test(name[i + 1] ?? ''))) {
      parts.push(name.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(name.slice(start));
  return parts;
}

// claves con las que un track puede entrar en un cluster de versiones: su base completa y, si es
// un medley, la base de cada tema encadenado (cada parte se pela por separado, así
// "Lane Boy / Redecorate (Live)" también aporta "redecorate"). Ojo: emparejar por estas claves
// exige que la clave compartida sea la base COMPLETA de uno de los dos lados (ver getTrackVersions),
// porque una parte suelta también captura prefijos de obra ("Luisa Miller / Act 2: ...").
export function versionKeys(rawName: string): string[] {
  const base = stripTrailingQualifiers(rawName, isVersionQualifier);
  const keys = new Set([normalizeBase(base)]);
  const parts = splitMedley(base);
  if (parts.length > 1) {
    parts
      .map(p => versionBaseKey(p)) // pela cada parte por separado
      .filter(k => k.length >= MIN_MEDLEY_PART_LENGTH)
      .forEach(k => keys.add(k));
  }
  keys.delete('');
  return [...keys];
}

// clave de deduplicación: pela SOLO los créditos, así que dos nombres colapsan cuando son
// la misma grabación con distinta acreditación, pero "Song (Live)" conserva su qualifier y
// nunca cae en el mismo grupo que "Song". Más estricta que versionKeys a propósito:
// aquí un falso positivo fusionaría grabaciones distintas, no solo las agruparía.
export function creditBaseKey(rawName: string): string {
  return normalizeBase(stripTrailingQualifiers(rawName, isCreditQualifier));
}
