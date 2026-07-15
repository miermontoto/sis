// registro de secciones configurables de las vistas de detalle (artist/album/
// track) + resolución de la disposición guardada por el usuario. módulo puro
// (sin dependencias de settings) para poder testearlo y evitar ciclos de import.

export type EntityKind = 'artist' | 'album' | 'track';
export type LayoutColumn = 'main' | 'rail';

export interface SectionDef {
  key: string;
  label: string;
  column: LayoutColumn; // columna por defecto
}

// disposición efectiva: keys ordenadas por columna + ocultas. las tres listas
// son disjuntas y cubren exactamente el registro de la entidad
export interface DetailLayout {
  main: string[];
  rail: string[];
  hidden: string[];
}

// orden y columna por defecto de cada sección, por tipo de entidad. el hero y
// los merge banners son estructurales (no configurables) y no aparecen aquí.
export const DETAIL_SECTIONS: Record<EntityKind, SectionDef[]> = {
  artist: [
    { key: 'stats', label: 'Stats', column: 'main' },
    { key: 'rankingBadges', label: 'Ranking badges', column: 'main' },
    { key: 'chartStats', label: 'Chart stats', column: 'main' },
    { key: 'activity', label: 'Activity chart', column: 'main' },
    { key: 'topTracks', label: 'Top tracks', column: 'main' },
    { key: 'topAlbums', label: 'Top albums', column: 'main' },
    { key: 'historyByYear', label: 'History by year', column: 'rail' },
    { key: 'recentPlays', label: 'Recent plays', column: 'rail' },
  ],
  album: [
    { key: 'stats', label: 'Stats', column: 'main' },
    { key: 'rankingBadges', label: 'Ranking badges', column: 'main' },
    { key: 'chartStats', label: 'Chart stats', column: 'main' },
    { key: 'activity', label: 'Activity chart', column: 'main' },
    { key: 'tracks', label: 'Tracks', column: 'main' },
    { key: 'historyByYear', label: 'History by year', column: 'rail' },
    { key: 'recentPlays', label: 'Recent plays', column: 'rail' },
  ],
  track: [
    { key: 'stats', label: 'Stats', column: 'main' },
    { key: 'rankingBadges', label: 'Ranking badges', column: 'main' },
    { key: 'chartStats', label: 'Chart stats', column: 'main' },
    { key: 'albumBreakdown', label: 'Played in', column: 'main' },
    { key: 'activity', label: 'Listening history', column: 'main' },
    { key: 'historyByYear', label: 'History by year', column: 'rail' },
    { key: 'versions', label: 'Versions', column: 'rail' },
    { key: 'recentPlays', label: 'Recent plays', column: 'rail' },
  ],
};

export function sectionLabel(kind: EntityKind, key: string): string {
  return DETAIL_SECTIONS[kind].find(d => d.key === key)?.label ?? key;
}

// disposición por defecto: cada sección en su columna de registro, nada oculto
export function defaultLayout(kind: EntityKind): DetailLayout {
  const main: string[] = [];
  const rail: string[] = [];
  for (const d of DETAIL_SECTIONS[kind]) (d.column === 'rail' ? rail : main).push(d.key);
  return { main, rail, hidden: [] };
}

// parsea el JSON guardado con tolerancia a basura (devuelve null si no sirve)
export function parseLayout(raw: string | null | undefined): Partial<DetailLayout> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj as Partial<DetailLayout>;
  } catch { /* json inválido → default */ }
  return null;
}

// reconcilia lo guardado contra el registro actual: descarta keys desconocidas
// y duplicadas (precedencia main > rail > hidden) y añade las secciones nuevas
// a su columna por defecto, respetando el orden guardado para las ya colocadas.
// así añadir una sección al registro la hace aparecer sin romper layouts viejos.
export function resolveLayout(kind: EntityKind, stored: Partial<DetailLayout> | null | undefined): DetailLayout {
  const defs = DETAIL_SECTIONS[kind];
  const known = new Set(defs.map(d => d.key));
  const seen = new Set<string>();

  const take = (arr: string[] | undefined): string[] => {
    const out: string[] = [];
    for (const k of arr ?? []) {
      if (known.has(k) && !seen.has(k)) { seen.add(k); out.push(k); }
    }
    return out;
  };

  const main = take(stored?.main);
  const rail = take(stored?.rail);
  const hidden = take(stored?.hidden);

  for (const d of defs) {
    if (!seen.has(d.key)) {
      (d.column === 'rail' ? rail : main).push(d.key);
      seen.add(d.key);
    }
  }

  return { main, rail, hidden };
}

const ALL_ZONES: (keyof DetailLayout)[] = ['main', 'rail', 'hidden'];

// mueve una key a (zone, index), quitándola de donde estuviera. index es
// relativo a la lista destino ya SIN la key (así lo calcula el drag), y se
// acota al rango válido. base de las operaciones de reordenado del editor.
export function moveSection(layout: DetailLayout, key: string, zone: keyof DetailLayout, index: number): DetailLayout {
  const next: DetailLayout = { main: [...layout.main], rail: [...layout.rail], hidden: [...layout.hidden] };
  for (const z of ALL_ZONES) {
    const i = next[z].indexOf(key);
    if (i >= 0) next[z].splice(i, 1);
  }
  const clamped = Math.max(0, Math.min(index, next[zone].length));
  next[zone].splice(clamped, 0, key);
  return next;
}

// oculta la sección (la manda a 'hidden') o, si ya estaba oculta, la restaura
// al final de su columna por defecto
export function toggleSectionHidden(kind: EntityKind, layout: DetailLayout, key: string): DetailLayout {
  if (layout.hidden.includes(key)) {
    const col = DETAIL_SECTIONS[kind].find(d => d.key === key)?.column ?? 'main';
    return moveSection(layout, key, col, layout[col].length);
  }
  return moveSection(layout, key, 'hidden', layout.hidden.length);
}
