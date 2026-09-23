// geometría del logo: "sis" en minúsculas monolínea con el punto de la i en acento.
// una sola fuente para el componente de la web, la imagen og de la api y los assets
// de assets/logo (iconos, favicon, splash). las letras se describen por su línea
// central y se pintan con remates redondos, así que no dependen de ninguna fuente

interface WordmarkParams {
  stroke: number; // grosor del trazo
  xHeight: number; // de la base al hombro, medido en la línea central
  sWidth: number; // ancho de la línea central de la s
  dot: number; // radio del punto de la i
}

export interface Wordmark {
  viewBox: [number, number, number, number];
  strokeWidth: number;
  letters: string; // s, i y s en un solo path
  dot: { cx: number; cy: number; r: number };
}

// constantes de construcción, comunes a todos los cortes
const BASELINE = 100;
const LETTER_GAP = 10;
const S_TERMINAL_DEG = 46; // inclinación de los terminales de la s
const S_SPLIT = 0.47; // parte de la altura que se lleva el óvalo de arriba (corrección óptica)
const S_TOP_NARROW = 0.94; // y es algo más estrecho que el de abajo
const DOT_GAP = 0.42; // hueco entre la i y su punto, en grosores de trazo

const r2 = (v: number) => Math.round(v * 100) / 100;

// s por su línea central: dos óvalos apilados que se tocan en el centro con tangente horizontal
function sPath(x: number, top: number, w: number, h: number): string {
  const rx = w / 2, rxT = rx * S_TOP_NARROW, cx = x + rx;
  const ryT = (h * S_SPLIT) / 2, ryB = (h * (1 - S_SPLIT)) / 2, my = top + 2 * ryT;
  const a = (S_TERMINAL_DEG * Math.PI) / 180;
  const sx = cx + rxT * Math.cos(a), sy = top + ryT - ryT * Math.sin(a);
  const ex = cx - rx * Math.cos(a), ey = my + ryB + ryB * Math.sin(a);
  return `M${r2(sx)} ${r2(sy)}A${r2(rxT)} ${r2(ryT)} 0 1 0 ${r2(cx)} ${r2(my)}A${r2(rx)} ${r2(ryB)} 0 1 1 ${r2(ex)} ${r2(ey)}`;
}

function buildWordmark({ stroke, xHeight, sWidth, dot }: WordmarkParams): Wordmark {
  const half = stroke / 2, top = BASELINE - xHeight;
  const sAdvance = sWidth + stroke, iAdvance = Math.max(stroke, dot * 2);
  const iX = sAdvance + LETTER_GAP + iAdvance / 2;
  const s2X = sAdvance + LETTER_GAP + iAdvance + LETTER_GAP;
  const dotCy = top - half - stroke * DOT_GAP - dot;
  const minY = dotCy - dot;
  return {
    viewBox: [0, r2(minY), s2X + sAdvance, r2(BASELINE + half - minY)],
    strokeWidth: stroke,
    letters: `${sPath(half, top, sWidth, xHeight)}M${r2(iX)} ${BASELINE}V${top}${sPath(s2X + half, top, sWidth, xHeight)}`,
    dot: { cx: r2(iX), cy: r2(dotCy), r: dot },
  };
}

/** corte normal: icono de la app, wordmark de la interfaz, share cards */
export const WORDMARK = buildWordmark({ stroke: 14, xHeight: 52, sWidth: 40, dot: 9.5 });
/** corte grueso para el favicon: a 16-32 px el normal se queda fino */
export const WORDMARK_BOLD = buildWordmark({ stroke: 18, xHeight: 60, sWidth: 46, dot: 11.5 });

/** alto del wordmark pintado a un ancho dado */
export const wordmarkHeight = (mark: Wordmark, width: number): number => (mark.viewBox[3] / mark.viewBox[2]) * width;

/** fragmento svg del wordmark a `width` de ancho con su esquina superior izquierda en (x, y) */
export function wordmarkSvg(mark: Wordmark, x: number, y: number, width: number, ink: string, accent: string): string {
  const [vx, vy, vw] = mark.viewBox, k = width / vw, { cx, cy, r } = mark.dot;
  return `<g transform="translate(${r2(x)} ${r2(y)}) scale(${Math.round(k * 1e4) / 1e4}) translate(${-vx} ${-vy})">`
    + `<path d="${mark.letters}" fill="none" stroke="${ink}" stroke-width="${mark.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${accent}"/></g>`;
}
