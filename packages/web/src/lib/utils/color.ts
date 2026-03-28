const DEFAULT_COLOR: [number, number, number] = [29, 185, 84];

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
