import { describe, it, expect } from 'vitest';
import { DETAIL_SECTIONS, defaultLayout, resolveLayout, parseLayout, moveSection, toggleSectionHidden } from './detail-layout';

describe('defaultLayout', () => {
  it('coloca cada sección del registro en su columna por defecto, nada oculto', () => {
    const layout = defaultLayout('artist');
    expect(layout.main).toEqual(['stats', 'rankingBadges', 'chartStats', 'activity', 'topTracks', 'topAlbums']);
    expect(layout.rail).toEqual(['historyByYear', 'recentPlays']);
    expect(layout.hidden).toEqual([]);
  });
});

describe('resolveLayout', () => {
  it('devuelve el default cuando no hay nada guardado', () => {
    expect(resolveLayout('album', null)).toEqual(defaultLayout('album'));
  });

  it('respeta el orden y las columnas guardadas', () => {
    const stored = { main: ['activity', 'stats'], rail: ['recentPlays', 'historyByYear'], hidden: ['tracks'] };
    const resolved = resolveLayout('album', stored);
    expect(resolved.main).toEqual(['activity', 'stats', 'rankingBadges', 'chartStats']);
    expect(resolved.rail).toEqual(['recentPlays', 'historyByYear']);
    expect(resolved.hidden).toEqual(['tracks']);
  });

  it('descarta keys desconocidas (secciones retiradas del registro)', () => {
    const resolved = resolveLayout('artist', { main: ['stats', 'ghostSection'], rail: [], hidden: [] });
    expect(resolved.main).not.toContain('ghostSection');
    expect(resolved.main[0]).toBe('stats');
  });

  it('añade secciones nuevas a su columna por defecto sin romper el orden guardado', () => {
    // layout viejo sin 'chartStats' ni 'recentPlays' (añadidas después)
    const stored = { main: ['stats', 'rankingBadges', 'activity', 'topTracks', 'topAlbums'], rail: ['historyByYear'], hidden: [] };
    const resolved = resolveLayout('artist', stored);
    // chartStats (main por defecto) se añade al final de main; recentPlays al final de rail
    expect(resolved.main).toEqual(['stats', 'rankingBadges', 'activity', 'topTracks', 'topAlbums', 'chartStats']);
    expect(resolved.rail).toEqual(['historyByYear', 'recentPlays']);
    // cobertura total: cada sección del registro aparece exactamente una vez
    const all = [...resolved.main, ...resolved.rail, ...resolved.hidden].sort();
    expect(all).toEqual(DETAIL_SECTIONS.artist.map(d => d.key).sort());
  });

  it('deduplica una key presente en varias listas (precedencia main > rail > hidden)', () => {
    const resolved = resolveLayout('track', { main: ['stats'], rail: ['stats'], hidden: ['stats'] });
    const occurrences = [...resolved.main, ...resolved.rail, ...resolved.hidden].filter(k => k === 'stats');
    expect(occurrences).toEqual(['stats']);
    expect(resolved.main).toContain('stats');
  });
});

describe('parseLayout', () => {
  it('devuelve null para vacío o JSON inválido', () => {
    expect(parseLayout('')).toBeNull();
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('{not json')).toBeNull();
  });

  it('parsea un objeto válido', () => {
    expect(parseLayout('{"main":["stats"]}')).toEqual({ main: ['stats'] });
  });
});

describe('moveSection', () => {
  it('reordena dentro de la misma columna', () => {
    const layout = { main: ['a', 'b', 'c'], rail: [], hidden: [] };
    // mover 'c' al inicio: índice 0 relativo a la lista sin 'c' → [a, b]
    expect(moveSection(layout, 'c', 'main', 0).main).toEqual(['c', 'a', 'b']);
    // mover 'a' al final
    expect(moveSection(layout, 'a', 'main', 2).main).toEqual(['b', 'c', 'a']);
  });

  it('mueve entre columnas quitando la key del origen', () => {
    const layout = { main: ['a', 'b'], rail: ['x'], hidden: [] };
    const next = moveSection(layout, 'a', 'rail', 1);
    expect(next.main).toEqual(['b']);
    expect(next.rail).toEqual(['x', 'a']);
  });

  it('acota índices fuera de rango', () => {
    const layout = { main: ['a'], rail: [], hidden: [] };
    expect(moveSection(layout, 'a', 'rail', 99).rail).toEqual(['a']);
  });

  it('no muta el layout de entrada', () => {
    const layout = { main: ['a', 'b'], rail: [], hidden: [] };
    moveSection(layout, 'a', 'rail', 0);
    expect(layout.main).toEqual(['a', 'b']);
    expect(layout.rail).toEqual([]);
  });
});

describe('toggleSectionHidden', () => {
  it('oculta una sección visible', () => {
    const layout = { main: ['stats', 'activity'], rail: [], hidden: [] };
    const next = toggleSectionHidden('artist', layout, 'stats');
    expect(next.main).toEqual(['activity']);
    expect(next.hidden).toEqual(['stats']);
  });

  it('restaura una sección oculta a su columna por defecto', () => {
    // 'recentPlays' es de columna 'rail' por defecto
    const layout = { main: ['stats'], rail: ['historyByYear'], hidden: ['recentPlays'] };
    const next = toggleSectionHidden('artist', layout, 'recentPlays');
    expect(next.hidden).toEqual([]);
    expect(next.rail).toEqual(['historyByYear', 'recentPlays']);
  });
});
