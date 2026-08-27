const DEFAULT_COLOR: [number, number, number] = [29, 185, 84];

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

export function extractColor(url: string): Promise<[number, number, number]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let bestR = 0, bestG = 0, bestB = 0, bestScore = -1;
        let sumR = 0, sumG = 0, sumB = 0, count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i], pg = data[i+1], pb = data[i+2];
          const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
          const sat = max === 0 ? 0 : (max - min) / max;
          const brightness = max / 255;
          const score = sat * (0.3 + brightness * 0.7);

          if (brightness > 0.08) {
            sumR += pr; sumG += pg; sumB += pb; count++;
          }
          if (score > bestScore) {
            bestScore = score;
            bestR = pr; bestG = pg; bestB = pb;
          }
        }

        let r: number, g: number, b: number;

        if (bestScore > 0.15) {
          r = bestR; g = bestG; b = bestB;
        } else if (count > 0) {
          r = Math.round(sumR / count);
          g = Math.round(sumG / count);
          b = Math.round(sumB / count);
        } else {
          resolve(DEFAULT_COLOR);
          return;
        }

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 90) {
          const factor = 90 / Math.max(lum, 1);
          r = Math.min(255, Math.round(r * factor));
          g = Math.min(255, Math.round(g * factor));
          b = Math.min(255, Math.round(b * factor));
        }

        resolve([r, g, b]);
      } catch {
        resolve(DEFAULT_COLOR);
      }
    };
    img.onerror = () => resolve(DEFAULT_COLOR);
    img.src = url;
  });
}
