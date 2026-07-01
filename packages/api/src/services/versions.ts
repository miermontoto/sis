// deriva la clave "base" de un tema a partir de su nombre, quitando los qualifiers de variante
// (live, remix, remaster...) para agrupar versiones distintas del mismo tema. Espejo conceptual de
// dedup.ts, pero en vez de fusionar tracks del mismo nombre, agrupamos variantes con una base común.
//
// El pelado es conservador y guiado por palabras clave: solo se quita un segmento final (entre
// paréntesis, corchetes o tras " - ") si contiene una palabra clave de versión. Así "Song (Part 1)"
// NO colapsa con "Song (Part 2)" (Part no es keyword), pero "Song (Live)" sí comparte base con "Song".

// palabras clave que marcan un segmento final como qualifier de versión (no parte del título base)
const VERSION_KEYWORDS = [
  /\b(live|unplugged|en vivo|en directo|directo|concert|sessions?)\b/,
  /\b(acoustic|acustic[oa]?|stripped|piano version)\b/,
  /\b(remix|rework|bootleg|flip|club mix|dub|vip mix)\b/,
  /\b(remaster(ed)?|remasterizad[oa]|mono|stereo|anniversary)\b/,
  /\b(radio edit|radio version|single version|short version)\b/,
  /\b(extended|long version|full length)\b/,
  /\b(instrumental|karaoke)\b/,
  /\b(demo|take \d+|alternate|alternative|early version|rough)\b/,
  /\b(deluxe|bonus)\b/,
  /\b(feat\.?|featuring|ft\.?|with )\b/,
  /\b(edit|version|edicion|mix|rmx)\b/,
];

// segmento final entre paréntesis/corchetes, o tras " - " hasta el final
const TRAILING_SEGMENT = /\s*[([]([^()[\]]*)[)\]]\s*$|\s+-\s+([^-]+?)\s*$/;

function isVersionQualifier(text: string): boolean {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return VERSION_KEYWORDS.some(re => re.test(t));
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
  let name = rawName.trim();
  for (;;) {
    const m = name.match(TRAILING_SEGMENT);
    if (!m) break;
    const inner = (m[1] ?? m[2] ?? '').trim();
    if (!inner || !isVersionQualifier(inner)) break; // no es qualifier de versión: es parte del base
    const stripped = name.slice(0, name.length - m[0].length).trim();
    if (!stripped) break; // el nombre era íntegramente qualifier: conservamos el base actual
    name = stripped;
  }
  return normalizeBase(name);
}
