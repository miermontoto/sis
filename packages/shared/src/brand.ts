// geometría del logo: "sis" monospace de trazo recto, esquinas con el radio pequeño
// de las tarjetas y el punto de la i como un cuadrado en acento. una sola fuente para
// el componente de la web, la imagen og de la api y los assets de assets/logo (iconos,
// favicon, splash). las letras se describen por su línea central y se pintan con
// remates cuadrados, así que no dependen de ninguna fuente instalada.
// hubo una versión redonda (2026-09-23) y se retiró: chocaba con la ui monospace
// de esquinas duras. no vuelvas a remates ni cuencos redondos

interface WordmarkParams {
  stroke: number; // grosor del trazo
  xHeight: number; // de la base al hombro, medido en la línea central
  sWidth: number; // ancho de la línea central de la s (y de cada celda monospace)
  radius: number; // radio de las esquinas de la s, en la línea central
}

export interface Wordmark {
  viewBox: [number, number, number, number];
  strokeWidth: number;
  letters: string; // s, i (fuste, remate y pie) y s en un solo path
  dot: { x: number; y: number; size: number };
}

// constantes de construcción, comunes a todos los cortes
const BASELINE = 100;
const CELL_GAP = 6; // entre celdas monospace
const I_ARM = 0.42; // remate superior de la i, en anchos de s
const DOT_SIZE = 1.25; // lado del punto, en grosores de trazo
const DOT_GAP = 0.55; // hueco entre la i y su punto, en grosores de trazo

const r2 = (v: number) => Math.round(v * 100) / 100;

// s cuadrada por su línea central: brazo arriba, medio y abajo, esquinas de radio r
function sPath(x: number, top: number, w: number, bottom: number, r: number): string {
  const m = (top + bottom) / 2;
  return `M${x + w} ${top}H${x + r}A${r} ${r} 0 0 0 ${x} ${top + r}V${m - r}A${r} ${r} 0 0 0 ${x + r} ${m}`
    + `H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${m + r}V${bottom - r}A${r} ${r} 0 0 1 ${x + w - r} ${bottom}H${x}`;
}

function buildWordmark({ stroke, xHeight, sWidth, radius }: WordmarkParams): Wordmark {
  const half = stroke / 2, top = BASELINE - xHeight, cell = sWidth + stroke;
  const iX = cell + CELL_GAP, s2X = 2 * (cell + CELL_GAP), cx = iX + cell / 2;
  const size = stroke * DOT_SIZE, dotY = top - half - stroke * DOT_GAP - size;
  const i = `M${cx} ${BASELINE}V${top}M${r2(cx - sWidth * I_ARM)} ${top}H${cx}M${iX + half} ${BASELINE}H${iX + cell - half}`;
  return {
    viewBox: [0, r2(dotY), s2X + cell, r2(BASELINE + half - dotY)],
    strokeWidth: stroke,
    letters: `${sPath(half, top, sWidth, BASELINE, radius)}${i}${sPath(s2X + half, top, sWidth, BASELINE, radius)}`,
    dot: { x: r2(cx - size / 2), y: r2(dotY), size: r2(size) },
  };
}

/** corte normal: icono de la app, wordmark de la interfaz, share cards */
export const WORDMARK = buildWordmark({ stroke: 14, xHeight: 52, sWidth: 36, radius: 7 });
/** corte grueso para el favicon: a 16-32 px el normal se queda fino */
export const WORDMARK_BOLD = buildWordmark({ stroke: 18, xHeight: 58, sWidth: 38, radius: 8 });

/** alto del wordmark pintado a un ancho dado */
export const wordmarkHeight = (mark: Wordmark, width: number): number => (mark.viewBox[3] / mark.viewBox[2]) * width;

/** fragmento svg del wordmark a `width` de ancho con su esquina superior izquierda en (x, y) */
export function wordmarkSvg(mark: Wordmark, x: number, y: number, width: number, ink: string, accent: string): string {
  const [vx, vy, vw] = mark.viewBox, k = width / vw, { x: dx, y: dy, size } = mark.dot;
  return `<g transform="translate(${r2(x)} ${r2(y)}) scale(${Math.round(k * 1e4) / 1e4}) translate(${-vx} ${-vy})">`
    + `<path d="${mark.letters}" fill="none" stroke="${ink}" stroke-width="${mark.strokeWidth}" stroke-linecap="square" stroke-linejoin="miter"/>`
    + `<rect x="${dx}" y="${dy}" width="${size}" height="${size}" fill="${accent}"/></g>`;
}
