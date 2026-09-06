import { describe, it, expect } from 'vitest';
import { readableTextOn, hexToRgb, rgbToHex, resolveEntityColor } from './color';

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
