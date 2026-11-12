// modelo del dashboard de widgets: una lista ordenada de huecos (slots) que se
// reparte en secciones por horizonte temporal (Today → Looking back) y que cada
// sección empaqueta en su rejilla, como la pantalla de inicio de iOS. Un slot con
// un solo widget es un widget suelto; con varios es una pila (stack) que se pasa
// con el dedo. El tamaño es del slot, así que todos los widgets de una pila lo
// comparten. La sección no se guarda: la dice el alcance del primer widget del slot
// (`slotSection`), así que cambiar el rango de un top lo muda de sección.
// Módulo puro: las operaciones del editor (en el dashboard y en Settings)
// devuelven un layout nuevo y nunca mutan el recibido

import {
  SECTIONS, SIZE_SPAN, WIDGET_SIZES, resolveSettings, widgetDef, widgetSection,
  type SectionKey, type WidgetSettings, type WidgetSize,
} from './registry';

export interface WidgetInstance {
  id: string;
  type: string;
  settings: WidgetSettings;
}

export interface WidgetSlot {
  id: string;
  size: WidgetSize;
  items: WidgetInstance[];
  // auto-rotación de la pila, en segundos (0 = sólo a mano)
  rotateSec: number;
}

export interface DashboardLayout {
  slots: WidgetSlot[];
  // secciones plegadas (se ve la cabecera, no los widgets)
  collapsed: SectionKey[];
}

// intervalos que ofrece el editor para rotar una pila
export const ROTATE_OPTIONS: readonly number[] = [0, 10, 30, 60, 300];

// columnas: 2 (móvil), 4 (tablet) o 6 (escritorio), y en escritorio nunca más: las
// celdas crecen con la pantalla. Con columnas que aumentaban con el ancho (8 a 1920px,
// 12 a 2560px) los tamaños tenían spans fijos, el default estaba compuesto para 6 y
// cada sección dejaba a la derecha un 30% (8 col.) o más de la mitad (12) vacío.
// Así un large es siempre un tercio de la fila y el default cierra filas a cualquier
// ancho. 6 columnas necesitan celdas de al menos WIDGET_CELL_MIN_PX (~960px de rejilla,
// un portátil de 1280 con el sidebar)
export const WIDGET_CELL_MIN_PX = 140;
export const WIDGET_COLS_MIN = 2;
export const WIDGET_COLS_MAX = 6;
const WIDGET_COLS_TABLET = 4;

const newId = (): string => Math.random().toString(36).slice(2, 10);
const SECTION_KEYS = new Set<string>(SECTIONS.map(s => s.key));

// siempre par, como la rejilla de iOS: casi todos los tamaños miden 2 o 4 de ancho,
// y con un número impar la última columna se quedaba vacía en cada fila
export function gridColumns(widthPx: number, gapPx: number): number {
  const fit = Math.floor((widthPx + gapPx) / (WIDGET_CELL_MIN_PX + gapPx));
  return fit >= WIDGET_COLS_MAX ? WIDGET_COLS_MAX : fit >= WIDGET_COLS_TABLET ? WIDGET_COLS_TABLET : WIDGET_COLS_MIN;
}

// tamaño con el que se pinta un slot en una rejilla de `cols` columnas: el xl
// (4 de ancho) no cabe en un móvil y se pinta como large, que es lo que haría una
// rejilla de iOS sin sitio. El tall también: existe para ir al lado de dos collages
// apilados, y en dos columnas no hay nada al lado (era una lista de 700px)
const NARROW_COLS = 4;
export function effectiveSize(size: WidgetSize, cols: number): WidgetSize {
  return SIZE_SPAN[size].cols > cols || (size === 'tall' && cols < NARROW_COLS) ? 'large' : size;
}

// tamaños que admiten todos los widgets de una pila, en el orden de WIDGET_SIZES
export function commonSizes(items: readonly WidgetInstance[]): WidgetSize[] {
  return WIDGET_SIZES.filter(s => items.every(i => widgetDef(i.type)?.sizes.includes(s)));
}

// --- colocación en la rejilla ---

export interface Placed { id: string; x: number; y: number; w: number; h: number }

// coloca los slots de una sección en `cols` columnas como lo haría `grid-auto-flow:
// dense` (cada uno en el primer hueco donde quepa, de arriba abajo y de izquierda a
// derecha) y después ensancha las tiras que no llegan al borde: un grupo de slots
// con la misma fila y el mismo alto, solo en esas filas (cuatro cifras y la tira de
// la semana; el último large de una sección). Con 4 columnas el default, compuesto
// para 6, dejaba un 23-41% de algunas secciones vacío. Sólo a lo ancho y sólo en
// tiras: crecer hacia abajo o dentro de un bloque deshacía el tamaño que el usuario
// acababa de elegir (encoger un large lo volvía a estirar)
export function packSection(items: readonly { id: string; w: number; h: number }[], cols: number): Placed[] {
  const taken: boolean[][] = [];
  const isFree = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (taken[r]?.[c]) return false;
    return true;
  };
  const mark = (p: Placed) => {
    for (let r = p.y; r < p.y + p.h; r++) for (let c = p.x; c < p.x + p.w; c++) (taken[r] ??= [])[c] = true;
  };
  const placed: Placed[] = items.map(({ id, w: rawW, h }) => {
    const w = Math.min(rawW, cols);
    for (let y = 0; ; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (isFree(x, y, w, h)) {
          const p = { id, x, y, w, h };
          mark(p);
          return p;
        }
      }
    }
  });

  // tiras: slots con la misma (fila, alto) cuyas filas no comparte ningún otro
  const strips = new Map<string, Placed[]>();
  for (const p of placed) {
    const key = `${p.y}:${p.h}`;
    strips.set(key, [...(strips.get(key) ?? []), p]);
  }
  for (const strip of strips.values()) {
    const { y, h } = strip[0];
    const crossed = placed.some(o => !strip.includes(o) && o.y < y + h && o.y + o.h > y);
    let extra = cols - strip.reduce((a, p) => a + p.w, 0);
    if (crossed || extra <= 0) continue;
    // reparto: los más estrechos crecen a la vez mientras alcance para todos ellos (cuatro
    // cifras y una tira en 8 columnas: la tira se queda el sobrante; en 10, todos a 2);
    // lo que no se puede repartir por igual se lo queda el último
    const row = [...strip].sort((a, b) => a.x - b.x);
    for (;;) {
      const min = Math.min(...row.map(p => p.w));
      const narrowest = row.filter(p => p.w === min);
      if (narrowest.length > extra) break;
      for (const p of narrowest) p.w++;
      extra -= narrowest.length;
      if (extra === 0) break;
    }
    row[row.length - 1].w += extra;
    let x = 0;
    for (const p of row) { p.x = x; x += p.w; }
  }
  return placed;
}

// el tamaño con el que se pinta el contenido de un slot que la colocación ha
// ensanchado: el mayor que admitan sus widgets dentro de la caja (un large estirado
// a 4 columnas se pinta como xl, con su lista a dos columnas)
export function sizeInBox(items: readonly WidgetInstance[], nominal: WidgetSize, w: number, h: number): WidgetSize {
  const fits = commonSizes(items).filter(s => SIZE_SPAN[s].cols <= w && SIZE_SPAN[s].rows <= h);
  const best = fits.at(-1);
  return best && SIZE_SPAN[best].cols * SIZE_SPAN[best].rows >= SIZE_SPAN[nominal].cols * SIZE_SPAN[nominal].rows ? best : nominal;
}

// sección de un slot: la de su primer widget (una pila sólo se forma dentro de una
// sección, así que todos sus widgets suelen compartirla)
export const slotSection = (slot: WidgetSlot): SectionKey =>
  slot.items[0] ? widgetSection(slot.items[0].type, slot.items[0].settings) : 'today';

export function createWidget(type: string, settings?: Partial<WidgetSettings>): WidgetInstance | null {
  const def = widgetDef(type);
  return def ? { id: newId(), type, settings: resolveSettings(def, settings) } : null;
}

function createSlot(type: string, size?: WidgetSize, settings?: Partial<WidgetSettings>): WidgetSlot | null {
  const item = createWidget(type, settings);
  if (!item) return null;
  const def = widgetDef(type)!;
  return { id: newId(), size: size && def.sizes.includes(size) ? size : def.defaultSize, items: [item], rotateSec: 0 };
}

// semilla de un layout: [tipo, tamaño, ajustes] o una pila de ellos. Los ids son
// deterministas (`prefijo + posición`) porque el default y lo migrado no se guardan
// hasta el primer cambio: con ids al azar, la página recordada de cada pila
// (localStorage, por id de slot) se perdería en cada arranque
type Seed = readonly [string, WidgetSize, Partial<WidgetSettings>?];
function fromSeeds(seeds: readonly (Seed | readonly Seed[])[], prefix: string): DashboardLayout {
  const slots: WidgetSlot[] = [];
  seeds.forEach((seed, i) => {
    const group = (Array.isArray(seed[0]) ? seed : [seed]) as readonly Seed[];
    const items = group
      .map(([type, , settings], j) => { const w = createWidget(type, settings); return w && { ...w, id: `${prefix}${i}.${j}` }; })
      .filter((w): w is WidgetInstance => w !== null);
    if (items.length > 0) slots.push({ id: `${prefix}${i}`, size: group[0][1], items, rotateSec: 0 });
  });
  return { slots, collapsed: [] };
}

// cifras de la antigua barra de stats (y del widget de varias cifras que la sustituyó
// unos días): una cifra por slot
const STATS_FIGURES = ['playsToday', 'timeToday', 'streak', 'timeWeek', 'totalPlays'];
const statTiles = (figures: readonly string[]): Seed[] => figures.map(figure => ['stat', 'tile', { figure }] as const);

// el dashboard de serie, sección a sección. Cada bloque cierra filas enteras en la
// rejilla de escritorio (6 columnas a cualquier ancho) y cae limpio en la de 2 (móvil).
// El orden de la lista no importa entre secciones (cada una filtra lo suyo)
export function defaultDashboard(): DashboardLayout {
  return fromSeeds([
    // today: cuatro cifras y la semana en una fila compacta
    ['stat', 'tile', { figure: 'playsToday' }],
    ['stat', 'tile', { figure: 'timeToday' }],
    ['stat', 'tile', { figure: 'streak' }],
    ['goal', 'tile', { period: 'day', target: 2 }],
    ['weekStrip', 'band'],
    // this week: la lista larga a la izquierda, los dos collages a su lado
    ['top', 'tall', { entity: 'track', range: 'week' }],
    ['top', 'xl', { entity: 'album', range: 'week', style: 'collage' }],
    ['top', 'xl', { entity: 'artist', range: 'week', style: 'collage' }],
    ['rankChanges', 'large'],
    [['genres', 'large', { range: 'week' }], ['clock', 'large', { range: 'week' }]],
    ['chart', 'large', { granularity: 'week' }],
    // this year: chart y estrenos del año, y una columna de cifras
    ['chart', 'large', { granularity: 'year', entity: 'artist' }],
    ['discoveries', 'large', { range: 'thisYear' }],
    ['stat', 'tile', { figure: 'playsYear' }],
    ['stat', 'tile', { figure: 'timeYear' }],
    ['goal', 'band', { period: 'year', target: 1000 }],
    ['top', 'medium', { entity: 'artist', range: 'thisYear' }],
    // all time
    ['calendar', 'xl'],
    ['record', 'medium'],
    ['milestone', 'medium'],
    // looking back
    ['lastReport', 'large'],
    [['onThisDay', 'large'], ['anniversaries', 'large']],
    ['lastYear', 'large'],
  ], 'd');
}

// las secciones del dashboard de antes (detail-layout, key `dashboardLayout`)
// convertidas en widgets, para que el primer arranque conserve el orden y lo que
// el usuario había ocultado. El statsBar eran cinco cifras: cinco tiles
const LEGACY_SECTIONS: Record<string, Seed[]> = {
  statsBar: statTiles(STATS_FIGURES),
  weekStrip: [['weekStrip', 'band']],
  topTracks: [['top', 'tall', { entity: 'track', range: 'week' }]],
  topAlbums: [['top', 'xl', { entity: 'album', range: 'week', style: 'collage' }]],
  topArtists: [['top', 'xl', { entity: 'artist', range: 'week', style: 'collage' }]],
  lastReport: [['lastReport', 'large']],
  lastYear: [['lastYear', 'large']],
  topGenres: [['genres', 'large']],
  rankChanges: [['rankChanges', 'large']],
  recentPlays: [['recentPlays', 'large']],
};

export function migrateLegacyLayout(raw: string | null | undefined): DashboardLayout | null {
  if (!raw) return null;
  let stored: { main?: unknown; rail?: unknown };
  try { stored = JSON.parse(raw); } catch { return null; }
  if (!stored || typeof stored !== 'object') return null;
  const keys = [stored.main, stored.rail].flatMap(k => Array.isArray(k) ? k : []);
  const seeds = [...new Set(keys)].flatMap(k => LEGACY_SECTIONS[String(k)] ?? []);
  return seeds.length > 0 ? fromSeeds(seeds, 'm') : null;
}

// tipos retirados que se convierten en otros al leer un layout guardado: el widget
// de varias cifras (`stats`) pasa a una cifra por slot. Los que no tienen sustituto
// (now playing, up next: el sidebar ya los enseña) desaparecen sin más
function expandRetired(item: Partial<WidgetInstance>): Seed[] | null {
  if (item.type !== 'stats') return null;
  const figures = (item.settings as { figures?: unknown } | undefined)?.figures;
  return statTiles(Array.isArray(figures) && figures.length > 0 ? figures.map(String) : STATS_FIGURES);
}

// reconcilia lo guardado contra el registro actual: descarta widgets de tipos
// retirados y slots vacíos, valida ajustes y tamaño (si la pila ya no admite el
// guardado, el mayor que admita) y repara ids repetidos. null = no sirve
export function parseDashboard(raw: string | null | undefined): DashboardLayout | null {
  if (!raw) return null;
  let stored: { slots?: unknown; collapsed?: unknown };
  try { stored = JSON.parse(raw); } catch { return null; }
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.slots)) return null;

  const seen = new Set<string>();
  const uniqueId = (id: unknown): string => {
    const s = typeof id === 'string' && id && !seen.has(id) ? id : newId();
    seen.add(s);
    return s;
  };

  const slots: WidgetSlot[] = [];
  for (const slot of stored.slots as Partial<WidgetSlot>[]) {
    if (!slot || typeof slot !== 'object' || !Array.isArray(slot.items)) continue;
    const items: WidgetInstance[] = [];
    for (const it of slot.items as Partial<WidgetInstance>[]) {
      const expanded = it ? expandRetired(it) : null;
      if (expanded) {
        for (const s of fromSeeds(expanded, 'x').slots) slots.push({ ...s, id: uniqueId(null), items: s.items.map(i => ({ ...i, id: uniqueId(null) })) });
        continue;
      }
      const def = it && typeof it.type === 'string' ? widgetDef(it.type) : undefined;
      if (!def) continue;
      items.push({ id: uniqueId(it.id), type: def.type, settings: resolveSettings(def, it.settings) });
    }
    // sin widgets válidos el slot no existe (commonSizes de nada son todos los tamaños)
    if (items.length === 0) continue;
    const sizes = commonSizes(items);
    if (sizes.length === 0) {
      // una pila sin tamaño común no se sostiene: cada widget vuelve a su hueco
      for (const item of items) slots.push({ id: uniqueId(null), size: widgetDef(item.type)!.defaultSize, items: [item], rotateSec: 0 });
      continue;
    }
    const size = sizes.includes(slot.size as WidgetSize) ? slot.size as WidgetSize : sizes[sizes.length - 1];
    const rotateSec = ROTATE_OPTIONS.includes(slot.rotateSec as number) ? slot.rotateSec as number : 0;
    slots.push({ id: uniqueId(slot.id), size, items, rotateSec });
  }
  const collapsed = Array.isArray(stored.collapsed)
    ? [...new Set(stored.collapsed.filter((k): k is SectionKey => SECTION_KEYS.has(String(k))))]
    : [];
  return { slots, collapsed };
}

export const serializeDashboard = (layout: DashboardLayout): string => JSON.stringify(layout);

// slots de una sección, en el orden de la lista
export const sectionSlots = (layout: DashboardLayout, section: SectionKey): WidgetSlot[] =>
  layout.slots.filter(s => slotSection(s) === section);

// --- operaciones del editor ---

const mapSlot = (layout: DashboardLayout, slotId: string, fn: (s: WidgetSlot) => WidgetSlot): DashboardLayout =>
  ({ ...layout, slots: layout.slots.map(s => s.id === slotId ? fn(s) : s) });
const findSlot = (layout: DashboardLayout, id: string) => layout.slots.find(s => s.id === id);

// widget nuevo al principio (de su sección, porque cada sección filtra la lista),
// como iOS: es lo primero que se ve al cerrar la galería
export function addWidget(layout: DashboardLayout, type: string, size?: WidgetSize): DashboardLayout {
  const slot = createSlot(type, size);
  return slot ? { ...layout, slots: [slot, ...layout.slots] } : layout;
}

export const removeSlot = (layout: DashboardLayout, slotId: string): DashboardLayout =>
  ({ ...layout, slots: layout.slots.filter(s => s.id !== slotId) });

// quita un widget de su pila; si era el último, el slot desaparece
export function removeItem(layout: DashboardLayout, slotId: string, itemId: string): DashboardLayout {
  const slot = findSlot(layout, slotId);
  if (!slot) return layout;
  const items = slot.items.filter(i => i.id !== itemId);
  return items.length === 0 ? removeSlot(layout, slotId) : mapSlot(layout, slotId, s => ({ ...s, items, rotateSec: items.length > 1 ? s.rotateSec : 0 }));
}

// mueve un slot a `index` de la lista (índice relativo a la lista SIN el slot)
export function moveSlot(layout: DashboardLayout, slotId: string, index: number): DashboardLayout {
  const slot = findSlot(layout, slotId);
  if (!slot) return layout;
  const rest = layout.slots.filter(s => s.id !== slotId);
  const at = Math.max(0, Math.min(index, rest.length));
  return { ...layout, slots: [...rest.slice(0, at), slot, ...rest.slice(at)] };
}

export function sameSection(layout: DashboardLayout, a: string, b: string): boolean {
  const sa = findSlot(layout, a);
  const sb = findSlot(layout, b);
  return !!sa && !!sb && slotSection(sa) === slotSection(sb);
}

// soltar un slot junto a otro: delante o detrás de él, sólo dentro de su sección
// (la sección la dicen los ajustes; para mudarlo se cambia su rango)
export function placeSlot(layout: DashboardLayout, slotId: string, targetId: string, where: 'before' | 'after'): DashboardLayout {
  if (slotId === targetId || !sameSection(layout, slotId, targetId)) return layout;
  const rest = layout.slots.filter(s => s.id !== slotId);
  const t = rest.findIndex(s => s.id === targetId);
  return t < 0 ? layout : moveSlot(layout, slotId, where === 'before' ? t : t + 1);
}

// un puesto arriba o abajo dentro de su sección (teclado y editor de lista)
export function stepSlot(layout: DashboardLayout, slotId: string, delta: -1 | 1): DashboardLayout {
  const slot = findSlot(layout, slotId);
  if (!slot) return layout;
  const peers = sectionSlots(layout, slotSection(slot));
  const neighbour = peers[peers.indexOf(slot) + delta];
  return neighbour ? placeSlot(layout, slotId, neighbour.id, delta < 0 ? 'before' : 'after') : layout;
}

// ¿puede el slot `slotId` entrar en la pila `targetId`? sólo dentro de la misma
// sección y si todos sus widgets admiten el tamaño de la pila destino (iOS tampoco
// redimensiona al apilar)
export function canStack(layout: DashboardLayout, slotId: string, targetId: string): boolean {
  if (slotId === targetId || !sameSection(layout, slotId, targetId)) return false;
  const src = findSlot(layout, slotId)!;
  const dst = findSlot(layout, targetId)!;
  return commonSizes([...dst.items, ...src.items]).includes(dst.size);
}

// soltar un slot encima de otro: sus widgets se suman a la pila destino
export function stackSlot(layout: DashboardLayout, slotId: string, targetId: string): DashboardLayout {
  if (!canStack(layout, slotId, targetId)) return layout;
  const src = findSlot(layout, slotId)!;
  return mapSlot(removeSlot(layout, slotId), targetId, s => ({ ...s, items: [...s.items, ...src.items] }));
}

// saca un widget de su pila a un slot propio justo detrás; conserva el tamaño
// de la pila si lo admite
export function unstackItem(layout: DashboardLayout, slotId: string, itemId: string): DashboardLayout {
  const i = layout.slots.findIndex(s => s.id === slotId);
  const slot = layout.slots[i];
  const item = slot?.items.find(it => it.id === itemId);
  if (!slot || !item || slot.items.length < 2) return layout;
  const def = widgetDef(item.type)!;
  const out: WidgetSlot = { id: newId(), size: def.sizes.includes(slot.size) ? slot.size : def.defaultSize, items: [item], rotateSec: 0 };
  const rest = removeItem(layout, slotId, itemId).slots;
  return { ...layout, slots: [...rest.slice(0, i + 1), out, ...rest.slice(i + 1)] };
}

// reordena un widget dentro de su pila
export function moveItem(layout: DashboardLayout, slotId: string, itemId: string, index: number): DashboardLayout {
  return mapSlot(layout, slotId, s => {
    const item = s.items.find(it => it.id === itemId);
    if (!item) return s;
    const rest = s.items.filter(it => it.id !== itemId);
    const at = Math.max(0, Math.min(index, rest.length));
    return { ...s, items: [...rest.slice(0, at), item, ...rest.slice(at)] };
  });
}

export function resizeSlot(layout: DashboardLayout, slotId: string, size: WidgetSize): DashboardLayout {
  return mapSlot(layout, slotId, s => commonSizes(s.items).includes(size) ? { ...s, size } : s);
}

// siguiente tamaño admitido (el botón de tamaño del modo edición los recorre en bucle)
export function nextSize(slot: WidgetSlot): WidgetSize {
  const sizes = commonSizes(slot.items);
  return sizes[(sizes.indexOf(slot.size) + 1) % sizes.length] ?? slot.size;
}

export function setRotate(layout: DashboardLayout, slotId: string, rotateSec: number): DashboardLayout {
  return ROTATE_OPTIONS.includes(rotateSec) ? mapSlot(layout, slotId, s => ({ ...s, rotateSec })) : layout;
}

// ajustes de un widget. Si con ellos el slot cambia de sección (un top que pasa a all
// time), se muda al final de la nueva: su puesto de la lista era el de la vieja, y
// podía caer en cualquier sitio de la otra
export function updateSettings(layout: DashboardLayout, slotId: string, itemId: string, patch: Partial<WidgetSettings>): DashboardLayout {
  const before = findSlot(layout, slotId);
  if (!before) return layout;
  const next = mapSlot(layout, slotId, s => ({
    ...s,
    items: s.items.map(it => it.id === itemId ? { ...it, settings: resolveSettings(widgetDef(it.type)!, { ...it.settings, ...patch }) } : it),
  }));
  const moved = findSlot(next, slotId)!;
  const section = slotSection(moved);
  if (section === slotSection(before)) return next;
  const peers = sectionSlots(next, section).filter(s => s.id !== slotId);
  const last = peers.at(-1);
  return last ? placeSlot(next, slotId, last.id, 'after') : next;
}

export function toggleCollapsed(layout: DashboardLayout, section: SectionKey): DashboardLayout {
  const collapsed = layout.collapsed.includes(section) ? layout.collapsed.filter(k => k !== section) : [...layout.collapsed, section];
  return { ...layout, collapsed };
}
