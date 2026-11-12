import { describe, it, expect } from 'vitest';
import {
  defaultDashboard, parseDashboard, serializeDashboard, migrateLegacyLayout, gridColumns, effectiveSize,
  commonSizes, addWidget, removeItem, moveSlot, placeSlot, stepSlot, canStack, stackSlot, unstackItem, moveItem,
  resizeSlot, nextSize, setRotate, updateSettings, createWidget, slotSection, sectionSlots, toggleCollapsed,
  WIDGET_COLS_MAX, type DashboardLayout, type WidgetSlot,
} from './layout';
import { SECTIONS, SIZE_SPAN, WIDGETS, resolveSettings, widgetDef, type WidgetSettings } from './registry';

const slot = (id: string, size: WidgetSlot['size'], type: string, settings: Partial<WidgetSettings> = {}, ...more: string[]): WidgetSlot => ({
  id, size, rotateSec: 0,
  items: [type, ...more].map((t, i) => ({ ...createWidget(t, i === 0 ? settings : {})!, id: `${id}-${i}` })),
});
const ids = (l: DashboardLayout) => l.slots.map(s => s.id);
const layoutOf = (...slots: WidgetSlot[]): DashboardLayout => ({ slots, collapsed: [] });

describe('registro', () => {
  it('cada widget admite su tamaño por defecto, tipos únicos y su sección existe', () => {
    const sections = new Set(SECTIONS.map(s => s.key));
    for (const w of WIDGETS) {
      expect(w.sizes).toContain(w.defaultSize);
      expect(sections.has(w.scope(resolveSettings(w, undefined)))).toBe(true);
    }
    expect(new Set(WIDGETS.map(w => w.type)).size).toBe(WIDGETS.length);
  });

  it('resolveSettings rellena defaults y descarta valores inválidos o claves desconocidas', () => {
    const top = widgetDef('top')!;
    expect(resolveSettings(top, { entity: 'album', range: 'decade', bogus: 1 })).toEqual({ entity: 'album', range: 'week', style: 'list' });
    expect(resolveSettings(widgetDef('goal')!, { target: -5 }).target).toBe(20);
  });

  it('la sección sale de los ajustes: rango, periodo o cifra', () => {
    const section = (type: string, settings: Partial<WidgetSettings>) => slotSection(slot('x', 'large', type, settings));
    expect(section('top', { range: 'week' })).toBe('week');
    expect(section('top', { range: 'month' })).toBe('month');
    expect(section('top', { range: '6months' })).toBe('year');
    expect(section('top', { range: 'all' })).toBe('all');
    expect(section('goal', { period: 'day' })).toBe('today');
    expect(section('chart', { granularity: 'year' })).toBe('year');
    expect(section('stat', { figure: 'totalPlays' })).toBe('all');
    expect(section('lastReport', {})).toBe('past');
  });
});

describe('rejilla', () => {
  it('dos columnas en un móvil, más a lo ancho, siempre pares y nunca más del tope', () => {
    expect(gridColumns(328, 12)).toBe(2);
    expect(gridColumns(700, 16)).toBe(4);
    // caben 7 (1340px): se queda en 6, que con widgets de 2 de ancho no deja hueco
    expect(gridColumns(1340, 24)).toBe(6);
    expect(gridColumns(1640, 24)).toBe(8);
    expect(gridColumns(10_000, 24)).toBe(WIDGET_COLS_MAX);
  });

  it('xl y tall se pintan como large donde no caben cuatro columnas', () => {
    expect(effectiveSize('xl', 2)).toBe('large');
    expect(effectiveSize('xl', 4)).toBe('xl');
    expect(effectiveSize('tall', 2)).toBe('large');
    expect(effectiveSize('tall', 4)).toBe('tall');
    expect(effectiveSize('tile', 2)).toBe('tile');
  });

  // cada sección del default cierra filas enteras en 6 columnas (medias filas × columnas)
  it('el default cierra cada sección en filas enteras de 6 columnas', () => {
    const layout = defaultDashboard();
    for (const { key } of SECTIONS) {
      const area = sectionSlots(layout, key).reduce((a, s) => a + SIZE_SPAN[s.size].cols * SIZE_SPAN[s.size].rows, 0);
      expect(area % 6, key).toBe(0);
    }
  });
});

describe('parseDashboard', () => {
  it('ida y vuelta del default sin pérdidas', () => {
    const layout = defaultDashboard();
    expect(parseDashboard(serializeDashboard(layout))).toEqual(layout);
  });

  it('basura o json sin slots = null', () => {
    expect(parseDashboard('nope')).toBeNull();
    expect(parseDashboard('{"main":[]}')).toBeNull();
    expect(parseDashboard('')).toBeNull();
  });

  it('descarta tipos retirados sin sustituto y slots vacíos, repara ids duplicados', () => {
    const raw = JSON.stringify({ slots: [
      { id: 'a', size: 'large', rotateSec: 0, items: [{ id: 'x', type: 'nowPlaying', settings: {} }] },
      { id: 'b', size: 'large', rotateSec: 0, items: [{ id: 'x', type: 'top', settings: {} }] },
      { id: 'b', size: 'medium', rotateSec: 0, items: [{ id: 'x', type: 'weekStrip', settings: {} }] },
    ] });
    const parsed = parseDashboard(raw)!;
    expect(parsed.slots.map(s => s.items[0].type)).toEqual(['top', 'weekStrip']);
    const all = parsed.slots.flatMap(s => [s.id, ...s.items.map(i => i.id)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('el widget de varias cifras se convierte en una cifra por slot, en su sitio', () => {
    const raw = JSON.stringify({ slots: [
      { id: 'a', size: 'large', rotateSec: 0, items: [{ id: '1', type: 'top' }] },
      { id: 'b', size: 'xl', rotateSec: 0, items: [{ id: '2', type: 'stats', settings: { figures: ['streak', 'totalPlays'] } }] },
    ] });
    const parsed = parseDashboard(raw)!;
    expect(parsed.slots.map(s => [s.items[0].type, s.size, s.items[0].settings.figure ?? null]))
      .toEqual([['top', 'large', null], ['stat', 'tile', 'streak'], ['stat', 'tile', 'totalPlays']]);
  });

  it('un tamaño que la pila ya no admite cae al mayor que admitan todos; las secciones plegadas se validan', () => {
    const raw = JSON.stringify({ collapsed: ['week', 'nope', 'week'], slots: [
      { id: 'a', size: 'small', rotateSec: 10, items: [{ id: '1', type: 'genres' }, { id: '2', type: 'clock' }] },
    ] });
    const parsed = parseDashboard(raw)!;
    expect(parsed.slots.map(s => [s.size, s.rotateSec])).toEqual([['large', 10]]);
    expect(parsed.collapsed).toEqual(['week']);
  });
});

describe('migrateLegacyLayout', () => {
  it('convierte las secciones visibles en widgets respetando el orden; el statsBar son cinco cifras', () => {
    const legacy = JSON.stringify({ main: ['topTracks', 'statsBar'], rail: ['recentPlays'], hidden: ['topGenres'] });
    const migrated = migrateLegacyLayout(legacy)!;
    expect(migrated.slots.map(s => s.items[0].type)).toEqual(['top', 'stat', 'stat', 'stat', 'stat', 'stat', 'recentPlays']);
    expect(migrated.slots[0].items[0].settings).toMatchObject({ entity: 'track', range: 'week' });
  });

  it('sin secciones conocidas no hay migración', () => {
    expect(migrateLegacyLayout(JSON.stringify({ main: ['ghost'] }))).toBeNull();
    expect(migrateLegacyLayout('')).toBeNull();
  });
});

describe('operaciones', () => {
  // a, b, c en This week; d en Today
  const base = layoutOf(
    slot('a', 'large', 'genres', { range: 'week' }),
    slot('b', 'large', 'clock', { range: 'week' }),
    slot('c', 'large', 'top', { range: 'week' }),
    slot('d', 'tile', 'goal', { period: 'day' }),
  );

  it('addWidget pone el nuevo delante con su tamaño por defecto (o el pedido si lo admite)', () => {
    expect(addWidget(base, 'weekStrip').slots[0]).toMatchObject({ size: 'band', items: [{ type: 'weekStrip' }] });
    expect(addWidget(base, 'weekStrip', 'small').slots[0].size).toBe('band');
    expect(addWidget(base, 'ghost')).toBe(base);
  });

  it('moveSlot, placeSlot y stepSlot reordenan, sólo dentro de la sección', () => {
    expect(ids(moveSlot(base, 'c', 0))).toEqual(['c', 'a', 'b', 'd']);
    expect(ids(placeSlot(base, 'a', 'c', 'after'))).toEqual(['b', 'c', 'a', 'd']);
    expect(placeSlot(base, 'd', 'a', 'before')).toBe(base);
    expect(ids(stepSlot(base, 'c', -1))).toEqual(['a', 'c', 'b', 'd']);
    // el primero de la sección no sube, aunque haya slots de otra delante en la lista
    expect(stepSlot(base, 'd', -1)).toBe(base);
  });

  it('apilar exige misma sección y que todos quepan en el tamaño destino', () => {
    expect(canStack(base, 'b', 'a')).toBe(true);
    expect(canStack(base, 'd', 'a')).toBe(false);
    const stacked = stackSlot(base, 'b', 'a');
    expect(stacked.slots.map(s => s.items.map(i => i.type))).toEqual([['genres', 'clock'], ['top'], ['goal']]);
  });

  it('desapilar deja el widget justo detrás y la pila de uno pierde la rotación', () => {
    const stacked = setRotate(stackSlot(base, 'b', 'a'), 'a', 30);
    const out = unstackItem(stacked, 'a', 'b-0');
    expect(out.slots.map(s => s.items.map(i => i.type))).toEqual([['genres'], ['clock'], ['top'], ['goal']]);
    expect(out.slots[0].rotateSec).toBe(0);
  });

  it('quitar el último widget de un slot lo elimina; moveItem reordena la pila', () => {
    expect(ids(removeItem(base, 'd', 'd-0'))).toEqual(['a', 'b', 'c']);
    const stacked = stackSlot(base, 'b', 'a');
    expect(moveItem(stacked, 'a', 'b-0', 0).slots[0].items.map(i => i.type)).toEqual(['clock', 'genres']);
  });

  it('el tamaño sólo cambia a uno que admitan todos y nextSize los recorre en bucle', () => {
    expect(resizeSlot(base, 'a', 'medium').slots[0].size).toBe('medium');
    expect(resizeSlot(base, 'a', 'xl').slots[0].size).toBe('large');
    expect(commonSizes(base.slots[3].items)).toEqual(['tile', 'band', 'small', 'medium']);
    expect(nextSize(base.slots[3])).toBe('band');
    expect(nextSize({ ...base.slots[3], size: 'medium' })).toBe('tile');
  });

  it('cambiar el rango muda el widget al final de su nueva sección', () => {
    const withAll = layoutOf(...base.slots, slot('e', 'large', 'top', { range: 'all' }));
    const moved = updateSettings(withAll, 'a', 'a-0', { range: 'all' });
    expect(slotSection(moved.slots.find(s => s.id === 'a')!)).toBe('all');
    expect(sectionSlots(moved, 'all').map(s => s.id)).toEqual(['e', 'a']);
    // ajustes inválidos se validan contra el registro
    const bad = updateSettings(base, 'c', 'c-0', { entity: 'artist', range: 'forever' });
    expect(bad.slots[2].items[0].settings).toMatchObject({ entity: 'artist', range: 'week' });
  });

  it('plegar y desplegar una sección; setRotate sólo acepta los intervalos del editor', () => {
    expect(toggleCollapsed(base, 'week').collapsed).toEqual(['week']);
    expect(toggleCollapsed(toggleCollapsed(base, 'week'), 'week').collapsed).toEqual([]);
    expect(setRotate(base, 'a', 7).slots[0].rotateSec).toBe(0);
  });
});
