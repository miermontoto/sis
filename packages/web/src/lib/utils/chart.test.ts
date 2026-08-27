import { describe, it, expect } from 'vitest';
import { fitSeries, aggregateSeries, periodToMonth, periodToQuarter, periodToYear, niceAxisMax, MIN_BAR_SLOT_PX, type SeriesPoint } from './chart';

// bug: en las vistas de detalle el ancho de barra del activity chart era
// plotWidth/N sin suelo mínimo, así que en viewports estrechos con series
// largas (~130 meses con range=all) cada barra quedaba en ~2px e ilegible.
// el fix adapta la granularidad (mes → trimestre → año) al ancho disponible
// en vez de comprimir las barras: la serie completa sigue visible sin scroll.

function months(n: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let y = 2015, m = 1;
  for (let i = 0; i < n; i++) {
    out.push({ period: `${y}-${String(m).padStart(2, '0')}`, play_count: 1, total_ms: 60_000 });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const PHONE_CARD_WIDTH = 330; // ~360px de viewport menos padding
const LAPTOP_CARD_WIDTH = 830;
const MONTHS_ALL_TIME = 130; // ~11 años de historia con granularidad mensual

describe('fitSeries', () => {
  it('agrega hasta que cada barra tiene un slot legible en móvil', () => {
    const fitted = fitSeries(months(MONTHS_ALL_TIME), PHONE_CARD_WIDTH);
    // invariante del fix: cada barra dispone de al menos MIN_BAR_SLOT_PX
    expect(PHONE_CARD_WIDTH / fitted.length).toBeGreaterThanOrEqual(MIN_BAR_SLOT_PX);
    // precondición del bug: la serie sin agregar era sub-legible en móvil
    expect(PHONE_CARD_WIDTH / MONTHS_ALL_TIME).toBeLessThan(MIN_BAR_SLOT_PX);
    // agrega por calendario (trimestre o año), no trunca datos
    expect(fitted[0].period).toMatch(/^\d{4}(-Q[1-4])?$/);
    expect(fitted.length).toBeLessThan(MONTHS_ALL_TIME);
  });

  it('mantiene más granularidad cuanto más ancho es el contenedor', () => {
    const phone = fitSeries(months(MONTHS_ALL_TIME), PHONE_CARD_WIDTH);
    const laptop = fitSeries(months(MONTHS_ALL_TIME), LAPTOP_CARD_WIDTH);
    // el portátil cabe con más barras → granularidad más fina que el móvil
    expect(laptop.length).toBeGreaterThan(phone.length);
    expect(LAPTOP_CARD_WIDTH / laptop.length).toBeGreaterThanOrEqual(MIN_BAR_SLOT_PX);
  });

  it('conserva los totales al agregar', () => {
    const data = months(MONTHS_ALL_TIME);
    const fitted = fitSeries(data, PHONE_CARD_WIDTH);
    expect(fitted.reduce((a, d) => a + d.play_count, 0)).toBe(MONTHS_ALL_TIME);
    expect(fitted.reduce((a, d) => a + d.total_ms, 0)).toBe(MONTHS_ALL_TIME * 60_000);
  });

  it('no toca la serie cuando el contenedor es suficientemente ancho', () => {
    const data = months(24);
    expect(fitSeries(data, LAPTOP_CARD_WIDTH)).toBe(data);
  });

  it('devuelve la serie intacta mientras el ancho no está medido', () => {
    const data = months(MONTHS_ALL_TIME);
    expect(fitSeries(data, 0)).toBe(data);
  });

  it('cae a años cuando ni los trimestres caben', () => {
    const fitted = fitSeries(months(240), PHONE_CARD_WIDTH); // 20 años → 80 trimestres no caben
    expect(fitted.every(d => /^\d{4}$/.test(d.period))).toBe(true);
    expect(fitted.length).toBe(20);
  });
});

describe('aggregateSeries', () => {
  it('agrupa por clave calendario sumando plays y ms, en orden', () => {
    const data: SeriesPoint[] = [
      { period: '2023-01', play_count: 2, total_ms: 100 },
      { period: '2023-02', play_count: 3, total_ms: 200 },
      { period: '2023-03', play_count: 1, total_ms: 50 },
      { period: '2023-04', play_count: 4, total_ms: 400 },
    ];
    expect(aggregateSeries(data, periodToQuarter)).toEqual([
      { period: '2023-Q1', play_count: 6, total_ms: 350 },
      { period: '2023-Q2', play_count: 4, total_ms: 400 },
    ]);
  });
});

describe('claves de periodo', () => {
  it('mapea día, semana y mes a claves más gruesas', () => {
    expect(periodToMonth('2023-05-12')).toBe('2023-05');
    expect(periodToMonth('2023-05')).toBe('2023-05');
    expect(periodToMonth('2024-W01')).toBe('2024-01');
    expect(periodToQuarter('2023-05')).toBe('2023-Q2');
    expect(periodToYear('2023-11')).toBe('2023');
  });
});

// el techo del eje se fija en la opción (en vez de dejárselo a echarts) porque es
// el divisor con el que el bar chart de rankings calcula cuántos píxeles mide cada
// barra, y de ahí si el nombre de la entidad cabe dentro o tiene que salir fuera
describe('niceAxisMax', () => {
  it('redondea hacia arriba a un paso 1/2/5 de su orden de magnitud', () => {
    expect(niceAxisMax(743)).toBe(800);
    expect(niceAxisMax(12)).toBe(15);
    expect(niceAxisMax(37)).toBe(40);
  });

  it('nunca deja la barra más larga fuera del eje', () => {
    [1, 7, 99, 100, 101, 1234, 98_765].forEach((max) => {
      expect(niceAxisMax(max)).toBeGreaterThanOrEqual(max);
    });
  });

  it('no sube un escalón entero cuando el máximo ya cae justo en un paso', () => {
    // 0.1 + 0.2 no es exactamente 0.3: sin margen, la división da 3.0000000000000004
    // y el techo saltaba de 0.3 a 0.4, un eje un tercio más largo que sus datos
    expect(niceAxisMax(0.1 + 0.2)).toBeCloseTo(0.3, 10);
    expect(niceAxisMax(1000)).toBe(1000);
  });

  it('devuelve un techo positivo sin datos con los que escalar', () => {
    expect(niceAxisMax(0)).toBe(1);
    expect(niceAxisMax(-5)).toBe(1);
    expect(niceAxisMax(NaN)).toBe(1);
  });
});
