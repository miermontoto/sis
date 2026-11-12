// modelo del dashboard de widgets: una lista ordenada de huecos (slots) que la
// rejilla empaqueta sola, como la pantalla de inicio de iOS. un slot con un solo
// widget es un widget suelto; con varios es una pila (stack) que se pasa con el
// dedo. el tamaño es del slot, así que todos los widgets de una pila lo comparten.
// módulo puro: las operaciones del editor (en el dashboard y en Settings)
// devuelven un layout nuevo y nunca mutan el recibido

import { SIZE_SPAN, WIDGET_SIZES, resolveSettings, widgetDef, type WidgetSettings, type WidgetSize } from './registry';

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
}

// intervalos que ofrece el editor para rotar una pila
export const ROTATE_OPTIONS: readonly number[] = [0, 10, 30, 60, 300];

// por debajo de este ancho de columna la rejilla no gana otra: en un móvil salen
// dos (el small es medio ancho, como en iOS), y crece a lo ancho hasta MAX
export const WIDGET_CELL_MIN_PX = 150;
export const WIDGET_COLS_MIN = 2;
export const WIDGET_COLS_MAX = 12;

const newId = (): string => Math.random().toString(36).slice(2, 10);

// siempre par, como la rejilla de iOS: casi todos los tamaños miden 2 o 4 de ancho,
// y con un número impar la última columna se quedaba vacía en cada fila
export function gridColumns(widthPx: number, gapPx: number): number {
  const fit = Math.floor((widthPx + gapPx) / (WIDGET_CELL_MIN_PX + gapPx));
  const even = fit - (fit % 2);
  return Math.max(WIDGET_COLS_MIN, Math.min(WIDGET_COLS_MAX, even));
}

// tamaño con el que se pinta un slot en una rejilla de `cols` columnas: el xl
// (4 de ancho) no cabe en un móvil y se pinta como large, que es lo que haría
// una rejilla de iOS sin sitio
export function effectiveSize(size: WidgetSize, cols: number): WidgetSize {
  return SIZE_SPAN[size].cols > cols ? 'large' : size;
}

// tamaños que admiten todos los widgets de una pila, en el orden de WIDGET_SIZES
export function commonSizes(items: readonly WidgetInstance[]): WidgetSize[] {
  return WIDGET_SIZES.filter(s => items.every(i => widgetDef(i.type)?.sizes.includes(s)));
}

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
  return { slots };
}

// el dashboard de serie: lo que había antes de los widgets, más una pila de
// recuerdos y el reproductor. Pensado para cuadrar en una rejilla de 8
// columnas (escritorio) y caer limpio en las de 6 y 2
export function defaultDashboard(): DashboardLayout {
  return fromSeeds([
    ['stats', 'xl'],
    ['weekStrip', 'medium'],
    ['nowPlaying', 'medium'],
    [['onThisDay', 'medium'], ['anniversaries', 'medium']],
    ['milestone', 'small'],
    ['goal', 'small'],
    ['top', 'large', { entity: 'track', range: 'week' }],
    ['top', 'large', { entity: 'album', range: 'week', style: 'collage' }],
    ['top', 'large', { entity: 'artist', range: 'week', style: 'collage' }],
    ['lastReport', 'large'],
    ['recentPlays', 'large'],
    [['genres', 'large'], ['clock', 'large']],
    ['rankChanges', 'large'],
    ['lastYear', 'large'],
    ['calendar', 'xl'],
  ], 'd');
}

// las secciones del dashboard de antes (detail-layout, key `dashboardLayout`)
// convertidas en widgets, para que el primer arranque conserve el orden y lo que
// el usuario había ocultado. el statsBar era una fila de cinco cifras: un stats xl
const LEGACY_SECTIONS: Record<string, Seed> = {
  statsBar: ['stats', 'xl'],
  weekStrip: ['weekStrip', 'medium'],
  topTracks: ['top', 'large', { entity: 'track', range: 'week' }],
  topAlbums: ['top', 'large', { entity: 'album', range: 'week', style: 'collage' }],
  topArtists: ['top', 'large', { entity: 'artist', range: 'week', style: 'collage' }],
  lastReport: ['lastReport', 'large'],
  lastYear: ['lastYear', 'large'],
  topGenres: ['genres', 'large'],
  rankChanges: ['rankChanges', 'large'],
  recentPlays: ['recentPlays', 'large'],
};

export function migrateLegacyLayout(raw: string | null | undefined): DashboardLayout | null {
  if (!raw) return null;
  let stored: { main?: unknown; rail?: unknown };
  try { stored = JSON.parse(raw); } catch { return null; }
  if (!stored || typeof stored !== 'object') return null;
  const keys = [stored.main, stored.rail].flatMap(k => Array.isArray(k) ? k : []);
  const seeds = [...new Set(keys)].map(k => LEGACY_SECTIONS[String(k)]).filter((s): s is Seed => !!s);
  return seeds.length > 0 ? fromSeeds(seeds, 'm') : null;
}

// reconcilia lo guardado contra el registro actual: descarta widgets de tipos
// retirados y slots vacíos, valida ajustes y tamaño (si la pila ya no admite el
// guardado, el mayor que admita) y repara ids repetidos. null = no sirve
export function parseDashboard(raw: string | null | undefined): DashboardLayout | null {
  if (!raw) return null;
  let stored: { slots?: unknown };
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
  return { slots };
}

export const serializeDashboard = (layout: DashboardLayout): string => JSON.stringify(layout);

// --- operaciones del editor ---

const mapSlot = (layout: DashboardLayout, slotId: string, fn: (s: WidgetSlot) => WidgetSlot): DashboardLayout =>
  ({ slots: layout.slots.map(s => s.id === slotId ? fn(s) : s) });

// widget nuevo al principio, como iOS: es lo primero que se ve al cerrar la galería
export function addWidget(layout: DashboardLayout, type: string, size?: WidgetSize): DashboardLayout {
  const slot = createSlot(type, size);
  return slot ? { slots: [slot, ...layout.slots] } : layout;
}

export const removeSlot = (layout: DashboardLayout, slotId: string): DashboardLayout =>
  ({ slots: layout.slots.filter(s => s.id !== slotId) });

// quita un widget de su pila; si era el último, el slot desaparece
export function removeItem(layout: DashboardLayout, slotId: string, itemId: string): DashboardLayout {
  const slot = layout.slots.find(s => s.id === slotId);
  if (!slot) return layout;
  const items = slot.items.filter(i => i.id !== itemId);
  return items.length === 0 ? removeSlot(layout, slotId) : mapSlot(layout, slotId, s => ({ ...s, items, rotateSec: items.length > 1 ? s.rotateSec : 0 }));
}

// mueve un slot a `index` de la lista (índice relativo a la lista SIN el slot)
export function moveSlot(layout: DashboardLayout, slotId: string, index: number): DashboardLayout {
  const slot = layout.slots.find(s => s.id === slotId);
  if (!slot) return layout;
  const rest = layout.slots.filter(s => s.id !== slotId);
  const at = Math.max(0, Math.min(index, rest.length));
  return { slots: [...rest.slice(0, at), slot, ...rest.slice(at)] };
}

// soltar un slot junto a otro: delante o detrás de él
export function placeSlot(layout: DashboardLayout, slotId: string, targetId: string, where: 'before' | 'after'): DashboardLayout {
  if (slotId === targetId) return layout;
  const rest = layout.slots.filter(s => s.id !== slotId);
  const t = rest.findIndex(s => s.id === targetId);
  return t < 0 ? layout : moveSlot(layout, slotId, where === 'before' ? t : t + 1);
}

// ¿puede el slot `slotId` entrar en la pila `targetId`? sólo si todos sus
// widgets admiten el tamaño de la pila destino (iOS tampoco redimensiona al apilar)
export function canStack(layout: DashboardLayout, slotId: string, targetId: string): boolean {
  if (slotId === targetId) return false;
  const src = layout.slots.find(s => s.id === slotId);
  const dst = layout.slots.find(s => s.id === targetId);
  return !!src && !!dst && commonSizes([...dst.items, ...src.items]).includes(dst.size);
}

// soltar un slot encima de otro: sus widgets se suman a la pila destino, que
// pasa a enseñar el primero de los recién llegados
export function stackSlot(layout: DashboardLayout, slotId: string, targetId: string): DashboardLayout {
  if (!canStack(layout, slotId, targetId)) return layout;
  const src = layout.slots.find(s => s.id === slotId)!;
  return { slots: removeSlot(layout, slotId).slots.map(s => s.id === targetId ? { ...s, items: [...s.items, ...src.items] } : s) };
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
  return { slots: [...rest.slice(0, i + 1), out, ...rest.slice(i + 1)] };
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

export function updateSettings(layout: DashboardLayout, slotId: string, itemId: string, patch: Partial<WidgetSettings>): DashboardLayout {
  return mapSlot(layout, slotId, s => ({
    ...s,
    items: s.items.map(it => it.id === itemId ? { ...it, settings: resolveSettings(widgetDef(it.type)!, { ...it.settings, ...patch }) } : it),
  }));
}
