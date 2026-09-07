export type Rgb = [number, number, number];

const DEFAULT_COLOR: Rgb = [29, 185, 84];
const HEX_COLOR_RE = /^#?([0-9a-f]{6})$/i;
const HEX_RADIX = 16;

// fondo real bajo las barras del chart (--bg-card). Los rellenos son
// semitransparentes, así que el color que se ve es la composición de los dos y
// es esa, no la del color extraído, la que decide si el texto encima se lee
const CHART_BG: [number, number, number] = [15, 18, 20];
const LIGHT_TEXT = '#e0e8e8';
const DARK_TEXT = '#0b0f10';
// luminancias relativas (wcag) de los dos textos candidatos, precalculadas
const LIGHT_TEXT_LUMINANCE = 0.7939;
const DARK_TEXT_LUMINANCE = 0.0045;
// el 0.05 del cociente de contraste wcag, que evita dividir por negro puro
const CONTRAST_OFFSET = 0.05;
const SRGB_LOW_SLOPE = 12.92;
const SRGB_LOW_EDGE = 0.03928;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722];

// canal sRGB (0..255) a luz lineal, que es lo que se puede ponderar y sumar
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= SRGB_LOW_EDGE ? c / SRGB_LOW_SLOPE : ((c + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(luminanceA: number, luminanceB: number): number {
  const [hi, lo] = luminanceA > luminanceB ? [luminanceA, luminanceB] : [luminanceB, luminanceA];
  return (hi + CONTRAST_OFFSET) / (lo + CONTRAST_OFFSET);
}

/**
 * Color de texto legible sobre un relleno `rgb` pintado con opacidad `alpha`
 * encima del fondo de las tarjetas. Elige el candidato con más contraste real en
 * vez de partir por un umbral de brillo: sobre el verde de spotify, por ejemplo,
 * el texto oscuro contrasta cuatro veces más que el claro.
 */
export function readableTextOn(rgb: [number, number, number], alpha: number): string {
  const luminance = LUMINANCE_WEIGHTS.reduce(
    (acc, weight, i) => acc + weight * linearize(rgb[i] * alpha + CHART_BG[i] * (1 - alpha)),
    0,
  );
  return contrastRatio(luminance, DARK_TEXT_LUMINANCE) > contrastRatio(luminance, LIGHT_TEXT_LUMINANCE)
    ? DARK_TEXT
    : LIGHT_TEXT;
}

/** `#rrggbb` (con o sin almohadilla) a tupla rgb; null si no es un hex de 6 dígitos. */
export function hexToRgb(hex: string | null | undefined): Rgb | null {
  const m = hex ? HEX_COLOR_RE.exec(hex.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], HEX_RADIX);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Tupla rgb a `#rrggbb` en minúsculas, que es lo que acepta un `<input type="color">`. */
export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(HEX_RADIX).padStart(2, '0')).join('');
}

/**
 * Color de una entidad para gráficas y tintes: el pick manual (`color`) manda; sin él
 * se extrae de la imagen, y sin imagen queda el verde por defecto. Es el único sitio
 * que decide esa precedencia, así que todos los consumidores la comparten.
 */
export function resolveEntityColor(color: string | null | undefined, imageUrl: string | null | undefined): Promise<Rgb> {
  const manual = hexToRgb(color);
  if (manual) return Promise.resolve(manual);
  return imageUrl ? extractColor(imageUrl) : Promise.resolve(DEFAULT_COLOR);
}

// muestreo: la imagen se reduce a size×size antes de leer píxeles. 64 basta para
// medir áreas sin perder colores pequeños (un logo sobre fondo neutro)
const DOMINANT_SAMPLE_SIZE = 64;
// brillo (canal máximo / 255) por debajo del cual un píxel cuenta como negro
const MIN_BRIGHTNESS = 0.08;
// colorfulness por debajo de la cual un color cuenta como neutro (gris, beige apagado)
const MIN_DOMINANT_SCORE = 0.15;
const SCORE_BASE = 0.3;
const SCORE_BRIGHTNESS_WEIGHT = 0.7;
// luma mínima del resultado: por debajo se aclara, o no se vería sobre el fondo oscuro
const MIN_LUMA = 90;
const LUMA_WEIGHTS = [0.299, 0.587, 0.114];
// cuantización: bits por canal de los buckets. El dominante agrupa grueso (16 niveles)
// para que un degradado no reparta su área en decenas de buckets; la paleta más fino
// (32 niveles) porque luego funde los parecidos por distancia mínima
const DOMINANT_BITS = 4;
const PALETTE_BITS = 5;
const PALETTE_MIN_DISTANCE = 48;

/**
 * Píxeles rgba de `url` reducida a size×size; null si la imagen no carga o el canvas
 * queda contaminado (sin cabeceras CORS el navegador no deja leer sus píxeles).
 */
export function readImagePixels(url: string, size: number): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, size, size);
        resolve(ctx.getImageData(0, 0, size, size).data);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

interface Bucket { rgb: Rgb; n: number }

// buckets de `bits` por canal con la media y el nº de píxeles de cada uno, de más a
// menos poblado y sin negros: la medida de área que comparten dominante y paleta
function quantize(data: Uint8ClampedArray, bits: number): Bucket[] {
  const shift = 8 - bits;
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) / 255 <= MIN_BRIGHTNESS) continue;
    const key = ((r >> shift) << (2 * bits)) | ((g >> shift) << bits) | (b >> shift);
    const acc = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    acc.r += r; acc.g += g; acc.b += b; acc.n++;
    buckets.set(key, acc);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .map(({ r, g, b, n }) => ({ rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as Rgb, n }));
}

// "cuánto color" tiene un rgb: saturación ponderada por brillo, para que un rojo vivo
// puntúe más que un granate apagado con la misma saturación
function colorfulness([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return sat * (SCORE_BASE + (max / 255) * SCORE_BRIGHTNESS_WEIGHT);
}

// píxel suelto con más color, o null si ninguno pasa de neutro: el criterio original
// del dominante, que sobrevive como último recurso
function loudestPixel(data: Uint8ClampedArray): Rgb | null {
  let best: Rgb | null = null;
  let bestScore = MIN_DOMINANT_SCORE;
  for (let i = 0; i < data.length; i += 4) {
    const rgb: Rgb = [data[i], data[i + 1], data[i + 2]];
    const score = colorfulness(rgb);
    if (score > bestScore) {
      bestScore = score;
      best = rgb;
    }
  }
  return best;
}

// media ponderada por área de los buckets (= media de los píxeles que no son negros)
function meanOf(buckets: Bucket[]): Rgb | null {
  const total = buckets.reduce((acc, bk) => acc + bk.n, 0);
  if (total === 0) return null;
  const sum = buckets.reduce((acc, bk) => [acc[0] + bk.rgb[0] * bk.n, acc[1] + bk.rgb[1] * bk.n, acc[2] + bk.rgb[2] * bk.n], [0, 0, 0]);
  return [Math.round(sum[0] / total), Math.round(sum[1] / total), Math.round(sum[2] / total)];
}

// aclara hasta MIN_LUMA: el color tiñe fondos oscuros y un granate se perdería
function brighten([r, g, b]: Rgb): Rgb {
  const luma = LUMA_WEIGHTS[0] * r + LUMA_WEIGHTS[1] * g + LUMA_WEIGHTS[2] * b;
  if (luma >= MIN_LUMA) return [r, g, b];
  const factor = MIN_LUMA / Math.max(luma, 1);
  return [r, g, b].map((c) => Math.min(255, Math.round(c * factor))) as Rgb;
}

/**
 * Color dominante de un bloque de píxeles rgba: el más común de entre los que tienen
 * color (área × colorfulness sobre buckets gruesos). Así el rojo del que está hecha la
 * portada gana a su píxel más chillón, y un fondo neutro grande no gana a un logo de
 * color. Sin buckets con color: el píxel suelto más vivo y, si ni eso, la media de lo
 * que no es negro. Pura a propósito: es lo que se puede testear.
 */
export function dominantFromPixels(data: Uint8ClampedArray): Rgb {
  const buckets = quantize(data, DOMINANT_BITS);
  const common = buckets
    .filter((bk) => colorfulness(bk.rgb) > MIN_DOMINANT_SCORE)
    .reduce<{ score: number; rgb: Rgb } | null>((best, bk) => {
      const score = bk.n * colorfulness(bk.rgb);
      return best && best.score >= score ? best : { score, rgb: bk.rgb };
    }, null);
  const rgb = common?.rgb ?? loudestPixel(data) ?? meanOf(buckets);
  return rgb ? brighten(rgb) : DEFAULT_COLOR;
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Hasta `count` colores representativos de un bloque de píxeles rgba, del más presente
 * al menos: media de los buckets más poblados, saltando los negros y los que se parecen
 * a uno ya elegido. Es la paleta del cuentagotas.
 */
export function paletteFromPixels(data: Uint8ClampedArray, count: number): Rgb[] {
  // greedy: de más a menos poblado, descartando lo que ya está representado
  return quantize(data, PALETTE_BITS).reduce<Rgb[]>(
    (picked, bk) => picked.length < count && picked.every((p) => colorDistance(p, bk.rgb) >= PALETTE_MIN_DISTANCE) ? [...picked, bk.rgb] : picked,
    [],
  );
}

/** Color dominante de la imagen en `url` (ver dominantFromPixels); el verde si no se puede leer. */
export function extractColor(url: string): Promise<Rgb> {
  return readImagePixels(url, DOMINANT_SAMPLE_SIZE).then((px) => (px ? dominantFromPixels(px) : DEFAULT_COLOR));
}
