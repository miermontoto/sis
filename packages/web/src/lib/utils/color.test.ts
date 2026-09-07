import { describe, it, expect } from 'vitest';
import { readableTextOn, hexToRgb, rgbToHex, resolveEntityColor, dominantFromPixels, paletteFromPixels } from './color';

// el nombre de la entidad se pinta dentro de su barra cuando cabe, y el relleno
// de la barra es el color dominante de la portada: sin elegir el texto por
// contraste, una portada clara deja el nombre ilegible sobre su propia barra

const LIGHT = '#e0e8e8';
const DARK = '#0b0f10';

const WHITE_COVER: [number, number, number] = [240, 240, 235];
const YELLOW_COVER: [number, number, number] = [255, 214, 0];
const SPOTIFY_GREEN: [number, number, number] = [29, 185, 84];
const DEEP_BLUE: [number, number, number] = [40, 60, 160];

describe('readableTextOn', () => {
  it('oscurece el texto sobre rellenos claros y lo aclara sobre oscuros', () => {
    expect(readableTextOn(WHITE_COVER, 0.9)).toBe(DARK);
    expect(readableTextOn(YELLOW_COVER, 0.9)).toBe(DARK);
    expect(readableTextOn(DEEP_BLUE, 0.9)).toBe(LIGHT);
  });

  it('pesa el verde muy por encima del azul a igual intensidad de canal', () => {
    // el verde aporta ~10x más luz que el azul, así que un relleno verde pide
    // texto oscuro y uno azul del mismo valor lo pide claro. Un umbral sobre la
    // media de los canales daría la misma respuesta a los dos
    expect(readableTextOn([0, 220, 0], 1)).toBe(DARK);
    expect(readableTextOn([0, 0, 220], 1)).toBe(LIGHT);
  });

  it('usa texto oscuro sobre el verde de spotify, como el propio spotify', () => {
    // el caso que descartó el umbral por brillo: cae del lado "oscuro" del corte
    // pero el texto claro encima solo llega a 2.6:1, frente al 7:1 del oscuro
    expect(readableTextOn(SPOTIFY_GREEN, 0.9)).toBe(DARK);
  });

  it('compone contra el fondo de la tarjeta antes de decidir', () => {
    // el mismo color claro deja de serlo cuando el degradado de la barra se apaga:
    // a baja opacidad manda el fondo oscuro y el texto tiene que volver a ser claro
    expect(readableTextOn(WHITE_COVER, 0.9)).toBe(DARK);
    expect(readableTextOn(WHITE_COVER, 0.3)).toBe(LIGHT);
  });
});

// el pick manual de color de un álbum viaja como #rrggbb y las gráficas trabajan
// en tuplas rgb: la conversión tiene que ser exacta en los dos sentidos, y el
// resolver tiene que preferir el pick sin llegar a tocar la imagen
describe('hexToRgb / rgbToHex', () => {
  it('convierte en los dos sentidos, con y sin almohadilla, sin importar mayúsculas', () => {
    expect(hexToRgb('#1db954')).toEqual(SPOTIFY_GREEN);
    expect(hexToRgb('1DB954')).toEqual(SPOTIFY_GREEN);
    expect(rgbToHex(SPOTIFY_GREEN)).toBe('#1db954');
    expect(rgbToHex(hexToRgb('#0a0b0c')!)).toBe('#0a0b0c');
  });

  it('rechaza lo que no es un hex de 6 dígitos', () => {
    expect(hexToRgb('#fff')).toBeNull();
    expect(hexToRgb('red')).toBeNull();
    expect(hexToRgb('')).toBeNull();
    expect(hexToRgb(null)).toBeNull();
    expect(hexToRgb(undefined)).toBeNull();
  });

  it('acota canales fuera de rango al pasar a hex', () => {
    expect(rgbToHex([300, -5, 12.6])).toBe('#ff000d');
  });
});

describe('resolveEntityColor', () => {
  it('el pick manual manda y se resuelve sin cargar ninguna imagen', async () => {
    // en vitest no hay Image: si intentara extraer de la url, reventaría o colgaría
    await expect(resolveEntityColor('#283ca0', 'https://example.test/cover.jpg')).resolves.toEqual(DEEP_BLUE);
  });

  it('sin pick ni imagen cae al verde por defecto', async () => {
    await expect(resolveEntityColor(null, null)).resolves.toEqual(SPOTIFY_GREEN);
    await expect(resolveEntityColor('nope', undefined)).resolves.toEqual(SPOTIFY_GREEN);
  });
});

// bloque rgba sintético: cada color repetido n veces, alfa opaco
function pixels(blocks: [[number, number, number], number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(blocks.flatMap(([[r, g, b], n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat()));
}

describe('dominantFromPixels', () => {
  it('un color minoritario gana a un fondo neutro, aclarado a la luma mínima', () => {
    // 90 grises y 10 rojos: el gris no tiene color y no compite; la luma del rojo
    // (~80) se sube a 90 para que tiña sobre fondo oscuro
    const data = pixels([[[128, 128, 128], 90], [[220, 20, 20], 10]]);
    expect(dominantFromPixels(data)).toEqual([248, 23, 23]);
  });

  it('entre colores con color gana el que ocupa más área, no el más chillón', () => {
    // la portada está hecha de un rojo oscuro; el rojo puro es un brillo puntual. Antes
    // ganaba el píxel más vivo y el "auto" salía más chillón que el álbum
    const data = pixels([[[200, 60, 60], 500], [[255, 0, 0], 20]]);
    expect(dominantFromPixels(data)).toEqual([200, 60, 60]);
  });

  it('un fondo neutro grande no gana a un color con área', () => {
    const data = pixels([[[128, 128, 128], 1000], [[60, 90, 220], 100]]);
    expect(dominantFromPixels(data)).toEqual([60, 90, 220]);
  });

  it('sin nada saturado usa la media de lo que no es negro', () => {
    const data = pixels([[[100, 100, 100], 50], [[0, 0, 0], 50]]);
    expect(dominantFromPixels(data)).toEqual([100, 100, 100]);
  });

  it('todo negro cae al verde por defecto', () => {
    expect(dominantFromPixels(pixels([[[0, 0, 0], 20]]))).toEqual(SPOTIFY_GREEN);
  });
});

describe('paletteFromPixels', () => {
  it('devuelve los colores más presentes, sin negros y sin repetir un tono casi igual', () => {
    const data = pixels([
      [[200, 30, 30], 50],
      [[202, 32, 28], 30], // el mismo rojo a ojo: no merece swatch propio
      [[30, 60, 200], 40],
      [[10, 10, 10], 100], // negro: mayoritario pero inútil como color de gráfica
      [[240, 240, 240], 20],
    ]);
    expect(paletteFromPixels(data, 6)).toEqual([[200, 30, 30], [30, 60, 200], [240, 240, 240]]);
  });

  it('respeta el tope pedido en orden de presencia', () => {
    const data = pixels([[[200, 30, 30], 50], [[30, 60, 200], 40], [[240, 240, 240], 20]]);
    expect(paletteFromPixels(data, 2)).toEqual([[200, 30, 30], [30, 60, 200]]);
  });

  it('sin píxeles útiles devuelve vacío', () => {
    expect(paletteFromPixels(pixels([[[0, 0, 0], 10]]), 6)).toEqual([]);
    expect(paletteFromPixels(new Uint8ClampedArray(0), 6)).toEqual([]);
  });
});
