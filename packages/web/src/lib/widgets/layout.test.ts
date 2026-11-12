import { describe, it, expect } from 'vitest';
import {
  defaultDashboard, parseDashboard, serializeDashboard, migrateLegacyLayout, gridColumns, effectiveSize,
  commonSizes, addWidget, removeItem, moveSlot, placeSlot, canStack, stackSlot, unstackItem, moveItem,
  resizeSlot, nextSize, setRotate, updateSettings, createWidget, WIDGET_COLS_MAX,
  type DashboardLayout, type WidgetSlot,
} from './layout';
import { WIDGETS, resolveSettings, widgetDef } from './registry';

const slot = (id: string, size: WidgetSlot['size'], ...types: string[]): WidgetSlot => ({
  id, size, rotateSec: 0, items: types.map((type, i) => ({ ...createWidget(type)!, id: `${id}-${i}` })),
});
const ids = (l: DashboardLayout) => l.slots.map(s => s.id);

describe('registro', () => {
  it('cada widget admite su tamaño por defecto y tipos únicos', () => {
    for (const w of WIDGETS) expect(w.sizes).toContain(w.defaultSize);
    expect(new Set(WIDGETS.map(w => w.type)).size).toBe(WIDGETS.length);
  });

  it('resolveSettings rellena defaults y descarta valores inválidos o claves desconocidas', () => {
    const top = widgetDef('top')!;
    expect(resolveSettings(top, { entity: 'album', range: 'decade', bogus: 1 })).toEqual({ entity: 'album', range: 'week', style: 'list' });
    const goal = widgetDef('goal')!;
    expect(resolveSettings(goal, { target: -5 }).target).toBe(20);
    const stats = widgetDef('stats')!;
    expect(resolveSettings(stats, { figures: ['streak', 'nope'] }).figures).toEqual(stats.fields[0].default);
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

  it('el xl se pinta como large donde no caben cuatro columnas', () => {
    expect(effectiveSize('xl', 2)).toBe('large');
    expect(effectiveSize('xl', 4)).toBe('xl');
    expect(effectiveSize('medium', 2)).toBe('medium');
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

  it('descarta tipos retirados y slots vacíos, repara ids duplicados', () => {
    const raw = JSON.stringify({ slots: [
      { id: 'a', size: 'large', rotateSec: 0, items: [{ id: 'x', type: 'ghost', settings: {} }] },
      { id: 'b', size: 'large', rotateSec: 0, items: [{ id: 'x', type: 'top', settings: {} }] },
      { id: 'b', size: 'medium', rotateSec: 0, items: [{ id: 'x', type: 'weekStrip', settings: {} }] },
    ] });
    const parsed = parseDashboard(raw)!;
    expect(parsed.slots.map(s => s.items[0].type)).toEqual(['top', 'weekStrip']);
    const all = parsed.slots.flatMap(s => [s.id, ...s.items.map(i => i.id)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('un tamaño que la pila ya no admite cae al mayor que admitan todos', () => {
    const raw = JSON.stringify({ slots: [
      { id: 'a', size: 'small', rotateSec: 10, items: [{ id: '1', type: 'genres' }, { id: '2', type: 'clock' }] },
      { id: 'b', size: 'xl', rotateSec: 7, items: [{ id: '3', type: 'goal' }, { id: '4', type: 'recentPlays' }] },
    ] });
    const parsed = parseDashboard(raw)!;
    expect(parsed.slots.map(s => [s.size, s.rotateSec])).toEqual([['large', 10], ['medium', 0]]);
  });
});

describe('migrateLegacyLayout', () => {
  it('convierte las secciones visibles en widgets respetando el orden y saltando las ocultas', () => {
    const legacy = JSON.stringify({ main: ['topTracks', 'statsBar'], rail: ['recentPlays'], hidden: ['topGenres'] });
    const migrated = migrateLegacyLayout(legacy)!;
    expect(migrated.slots.map(s => [s.items[0].type, s.size])).toEqual([['top', 'large'], ['stats', 'xl'], ['recentPlays', 'large']]);
    expect(migrated.slots[0].items[0].settings).toMatchObject({ entity: 'track', range: 'week' });
  });

  it('sin secciones conocidas no hay migración', () => {
    expect(migrateLegacyLayout(JSON.stringify({ main: ['ghost'] }))).toBeNull();
    expect(migrateLegacyLayout('')).toBeNull();
  });
});

describe('operaciones', () => {
  const base: DashboardLayout = { slots: [slot('a', 'large', 'genres'), slot('b', 'large', 'clock'), slot('c', 'small', 'goal')] };

  it('addWidget pone el nuevo delante con su tamaño por defecto (o el pedido si lo admite)', () => {
    expect(addWidget(base, 'weekStrip').slots[0]).toMatchObject({ size: 'medium', items: [{ type: 'weekStrip' }] });
    expect(addWidget(base, 'weekStrip', 'small').slots[0].size).toBe('medium');
    expect(addWidget(base, 'ghost')).toBe(base);
  });

  it('moveSlot y placeSlot reordenan', () => {
    expect(ids(moveSlot(base, 'c', 0))).toEqual(['c', 'a', 'b']);
    expect(ids(placeSlot(base, 'a', 'c', 'after'))).toEqual(['b', 'c', 'a']);
    expect(ids(placeSlot(base, 'c', 'a', 'before'))).toEqual(['c', 'a', 'b']);
    expect(placeSlot(base, 'a', 'a', 'after')).toBe(base);
  });

  it('apilar exige que la pila destino quepa en el tamaño de los recién llegados', () => {
    expect(canStack(base, 'b', 'a')).toBe(true);
    expect(canStack(base, 'c', 'a')).toBe(false); // goal no tiene large
    const stacked = stackSlot(base, 'b', 'a');
    expect(stacked.slots.map(s => s.items.map(i => i.type))).toEqual([['genres', 'clock'], ['goal']]);
    expect(stackSlot(base, 'c', 'a')).toBe(base);
  });

  it('desapilar deja el widget justo detrás y la pila de uno pierde la rotación', () => {
    const stacked = setRotate(stackSlot(base, 'b', 'a'), 'a', 30);
    expect(stacked.slots[0].rotateSec).toBe(30);
    const out = unstackItem(stacked, 'a', 'b-0');
    expect(out.slots.map(s => s.items.map(i => i.type))).toEqual([['genres'], ['clock'], ['goal']]);
    expect(out.slots[0].rotateSec).toBe(0);
    expect(out.slots[1].size).toBe('large');
  });

  it('quitar el último widget de un slot lo elimina', () => {
    expect(ids(removeItem(base, 'c', 'c-0'))).toEqual(['a', 'b']);
  });

  it('moveItem reordena dentro de la pila', () => {
    const stacked = stackSlot(base, 'b', 'a');
    expect(moveItem(stacked, 'a', 'b-0', 0).slots[0].items.map(i => i.type)).toEqual(['clock', 'genres']);
  });

  it('el tamaño sólo cambia a uno que admitan todos y nextSize los recorre en bucle', () => {
    expect(resizeSlot(base, 'a', 'medium').slots[0].size).toBe('medium');
    expect(resizeSlot(base, 'a', 'xl').slots[0].size).toBe('large');
    expect(commonSizes(base.slots[2].items)).toEqual(['small', 'medium']);
    expect(nextSize(base.slots[2])).toBe('medium');
    expect(nextSize({ ...base.slots[2], size: 'medium' })).toBe('small');
  });

  it('updateSettings valida contra el registro', () => {
    const top: DashboardLayout = { slots: [slot('t', 'large', 'top')] };
    const next = updateSettings(top, 't', 't-0', { entity: 'artist', range: 'forever' });
    expect(next.slots[0].items[0].settings).toMatchObject({ entity: 'artist', range: 'week' });
  });

  it('setRotate sólo acepta los intervalos del editor', () => {
    expect(setRotate(base, 'a', 7).slots[0].rotateSec).toBe(0);
  });
});
