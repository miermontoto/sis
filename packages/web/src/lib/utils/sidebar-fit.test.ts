import { describe, it, expect } from 'vitest';
import { chooseFit, SIDEBAR_FIT_SLOP, type FitSizes } from './sidebar-fit';

// alturas reales medidas en el dev server (2026-09-06, sidebar de 220px, un
// tema sonando y sesión con tres entidades): base = cabecera + amigos + sesión
// + usuario + pie. Una columna entera pide ~1300px: por debajo de 1440p siempre
// hay que plegar algo, y lo que se plegaba mal era lo que se reportó
const sizes: FitSizes = { base: 385, navFull: 579, navCompact: 197, npFull: 334, npInline: 96 };
const full = { navCompact: false, npInline: false };
const both = { navCompact: true, npInline: true };

describe('chooseFit', () => {
  it('con sitio de sobra no pliega nada', () => {
    expect(chooseFit(1400, sizes, full)).toEqual(full);
  });

  it('pliega primero el now playing', () => {
    // nav entera + np en línea = 1060
    expect(chooseFit(1100, sizes, full)).toEqual({ navCompact: false, npInline: true });
  });

  it('en 1080p compacta la nav y deja el now playing entero, que sí cabe', () => {
    // nav compacta + np entero = 916; nav entera + np en línea = 1060 no cabe.
    // Con el escalón estricto esto acababa con las dos partes compactas
    expect(chooseFit(1000, sizes, both)).toEqual({ navCompact: true, npInline: false });
  });

  it('si no cabe nada, todo compacto', () => {
    expect(chooseFit(700, sizes, full)).toEqual(both);
  });

  it('una altura compacta desconocida se prueba como 0 para poder medirla', () => {
    expect(chooseFit(1000, { base: 385, navFull: 579, npFull: 334 }, full)).toEqual({ navCompact: false, npInline: true });
  });

  it('sin altura del now playing entero (forzado a línea) usa la de línea', () => {
    expect(chooseFit(1100, { base: 385, navFull: 579, npInline: 96 }, full)).toEqual(full);
  });

  it('expandir exige el margen; quedarse no', () => {
    const c = { navCompact: true, npInline: false }; // 916
    expect(chooseFit(916, sizes, c)).toEqual(c);
    // nav entera + np en línea = 1060: justo no expande, con margen sí
    expect(chooseFit(1060 + SIDEBAR_FIT_SLOP - 1, sizes, c)).toEqual(c);
    expect(chooseFit(1060 + SIDEBAR_FIT_SLOP, sizes, c)).toEqual({ navCompact: false, npInline: true });
  });
});
