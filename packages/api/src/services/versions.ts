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

// clave de deduplicación: pela SOLO los créditos, así que dos nombres colapsan cuando son
// la misma grabación con distinta acreditación, pero "Song (Live)" conserva su qualifier y
// nunca cae en el mismo grupo que "Song". Más estricta que versionBaseKey a propósito:
// aquí un falso positivo fusionaría grabaciones distintas, no solo las agruparía.
export function creditBaseKey(rawName: string): string {
  return normalizeBase(stripTrailingQualifiers(rawName, isCreditQualifier));
}
