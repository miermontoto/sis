import type { VersionTag } from '@sis/shared';

// deriva la "versión" de un track a partir de su nombre: separa el título base de los
// qualifiers de variante (live, remix, remaster...). Espejo conceptual de dedup.ts, pero
// en vez de fusionar tracks del mismo nombre, agrupamos variantes con un título base común.
//
// El pelado es conservador y guiado por palabras clave: solo se quita un segmento final
// (entre paréntesis, corchetes o tras " - ") si contiene una palabra clave de versión. Así
// "Song (Part 1)" NO colapsa con "Song (Part 2)" (Part no es keyword), pero "Song (Live)" sí
// comparte base con "Song".

// reglas de clasificación en orden de prioridad: la primera que casa define el tag.
// el texto se compara en minúsculas y sin acentos.
const VERSION_RULES: { tag: VersionTag; re: RegExp }[] = [
  { tag: 'live',         re: /\b(live|unplugged|en vivo|en directo|directo|concert|sessions?)\b/ },
  { tag: 'acoustic',     re: /\b(acoustic|acustic[oa]?|stripped|piano version)\b/ },
  { tag: 'remix',        re: /\b(remix|rework|bootleg|flip|club mix|dub|vip mix)\b/ },
  { tag: 'remaster',     re: /\b(remaster(ed)?|remasterizad[oa]|mono|stereo|anniversary)\b/ },
  { tag: 'radio',        re: /\b(radio edit|radio version|single version|short version)\b/ },
  { tag: 'extended',     re: /\b(extended|long version|full length)\b/ },
  { tag: 'instrumental', re: /\b(instrumental|karaoke)\b/ },
  { tag: 'demo',         re: /\b(demo|take \d+|alternate|alternative|early version|rough)\b/ },
  { tag: 'deluxe',       re: /\b(deluxe|bonus)\b/ },
  { tag: 'feat',         re: /\b(feat\.?|featuring|ft\.?|with )\b/ },
  { tag: 'edit',         re: /\b(edit|version|edicion|mix|rmx)\b/ },
];

// segmento final entre paréntesis/corchetes, o tras " - " hasta el final
const TRAILING_SEGMENT = /\s*[([]([^()[\]]*)[)\]]\s*$|\s+-\s+([^-]+?)\s*$/;

function classify(text: string): VersionTag | null {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const { tag, re } of VERSION_RULES) if (re.test(t)) return tag;
  return null;
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

export function deriveVersion(rawName: string): { base: string; qualifier: string | null; tag: VersionTag } {
  let name = rawName.trim();
  const quals: string[] = [];

  // pelar segmentos finales mientras sean qualifiers de versión (keyword)
  for (;;) {
    const m = name.match(TRAILING_SEGMENT);
    if (!m) break;
    const inner = (m[1] ?? m[2] ?? '').trim();
    if (!inner || !classify(inner)) break; // no es un qualifier de versión: paramos (es parte del base)
    quals.unshift(inner);
    const stripped = name.slice(0, name.length - m[0].length).trim();
    if (!stripped) break; // el nombre era íntegramente qualifier: conservamos el base actual
    name = stripped;
  }

  if (quals.length === 0) {
    return { base: normalizeBase(name), qualifier: null, tag: 'original' };
  }

  // clasificar por prioridad global sobre todos los qualifiers juntos
  return {
    base: normalizeBase(name),
    qualifier: quals.join(' · '),
    tag: classify(quals.join(' ')) ?? 'other',
  };
}
