import { describe, it, expect } from 'vitest';
import { fitSeries, aggregateSeries, periodToMonth, periodToQuarter, periodToYear, niceAxisMax, measureTextWidth, truncateToWidth, fitPieLabels, MIN_BAR_SLOT_PX, AXIS_LABEL, PIE_LABEL, PIE_LABEL_LINE, PIE_MIN_OUTER_RADIUS, type SeriesPoint } from './chart';

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

// el nombre de la entidad se recorta contra el hueco real que tiene en el chart,
// no contra un tope de caracteres: con el tope, un nombre que cabía de sobra
// dentro de su barra perdía caracteres igualmente
describe('truncateToWidth', () => {
  const FONT = '12px sans';
  const NAME = 'The Foundations of Decay';

  it('no toca el nombre que cabe', () => {
    const room = measureTextWidth(NAME, FONT);
    expect(truncateToWidth(NAME, FONT, room)).toBe(NAME);
    expect(truncateToWidth(NAME, FONT, room * 2)).toBe(NAME);
  });

  it('recorta al prefijo más largo que cabe, no a uno conservador', () => {
    const room = measureTextWidth(NAME, FONT) / 2;
    const cut = truncateToWidth(NAME, FONT, room);

    expect(cut.endsWith('…')).toBe(true);
    expect(measureTextWidth(cut, FONT)).toBeLessThanOrEqual(room);
    // el siguiente carácter ya no cabría: el recorte es máximo
    expect(measureTextWidth(NAME.slice(0, cut.length) + '…', FONT)).toBeGreaterThan(room);
  });

  it('devuelve vacío cuando no cabe ni un carácter con su elipsis', () => {
    expect(truncateToWidth(NAME, FONT, 1)).toBe('');
    expect(truncateToWidth(NAME, FONT, 0)).toBe('');
    expect(truncateToWidth(NAME, FONT, -10)).toBe('');
  });
});

// bug: la dona de géneros reservaba 150px fijos por lado para las etiquetas, así
// que en la card de un móvil (~346px) el anillo se quedaba en 23px de radio
// aunque los géneros fueran cortos. Ahora se miden las etiquetas: el invariante
// es que la más ancha de cada lado entra entera hasta `bleedMargin` del borde,
// que es donde echarts empieza a recortar con puntos suspensivos
describe('fitPieLabels', () => {
  const PHONE_CARD = 346;
  const RAIL_CARD = 430;
  const HEIGHT = 220;
  const OLD_LABEL_BAND = 150;
  const GUTTER = PIE_LABEL_LINE.length + PIE_LABEL_LINE.length2 + PIE_LABEL.distanceToLabelLine + PIE_LABEL.bleedMargin;
  const labelWidth = (name: string, fontSize: number) => Math.ceil(measureTextWidth(name, `${fontSize}px ${PIE_LABEL.fontFamily}`));

  // desde las 12 en sentido horario: la grande ocupa la derecha, las otras dos la izquierda
  const SHORT = [{ name: 'rap', value: 60 }, { name: 'trap', value: 25 }, { name: 'drill', value: 15 }];
  // con la etiqueta larga en una porción de la izquierda
  const LOPSIDED = [{ name: 'hip hop', value: 120 }, { name: 'alternative metal', value: 40 }];

  it('en un móvil el anillo crece hasta lo que dejan las etiquetas, no una banda fija', () => {
    const fit = fitPieLabels(SHORT, PHONE_CARD, HEIGHT);
    // precondición del bug: con la banda fija el anillo apenas existía
    expect(PHONE_CARD / 2 - OLD_LABEL_BAND).toBeLessThan(PIE_MIN_OUTER_RADIUS);
    expect(fit.outer).toBeGreaterThan(PHONE_CARD / 2 - OLD_LABEL_BAND);
    expect(fit.fontSize).toBe(AXIS_LABEL.fontSize);
  });

  it('la etiqueta más ancha de cada lado entra entera', () => {
    const fit = fitPieLabels(LOPSIDED, PHONE_CARD, HEIGHT);
    const right = labelWidth('hip hop', fit.fontSize);
    const left = labelWidth('alternative metal', fit.fontSize);
    expect(fit.cx + fit.outer + GUTTER + right).toBeLessThanOrEqual(PHONE_CARD);
    expect(fit.cx - fit.outer - GUTTER - left).toBeGreaterThanOrEqual(0);
  });

  it('el anillo se aparta del lado de las etiquetas largas en vez de encogerse', () => {
    const fit = fitPieLabels(LOPSIDED, PHONE_CARD, HEIGHT);
    const longest = labelWidth('alternative metal', fit.fontSize);
    expect(fit.cx).toBeGreaterThan(PHONE_CARD / 2);
    // centrado, el anillo tendría que dejar sitio a la larga en los dos lados
    expect(fit.outer).toBeGreaterThan(PHONE_CARD / 2 - GUTTER - longest);
  });

  it('con ancho de sobra manda el alto y el conjunto queda centrado', () => {
    const wide = 1200;
    const fit = fitPieLabels(SHORT, wide, HEIGHT);
    expect(fit.outer).toBe(HEIGHT / 2 - PIE_LABEL_LINE.length - AXIS_LABEL.fontSize / 2);
    const left = fit.cx - fit.outer - GUTTER - labelWidth('drill', fit.fontSize);
    const right = wide - (fit.cx + fit.outer + GUTTER + labelWidth('rap', fit.fontSize));
    expect(left).toBeCloseTo(right);
  });

  it('baja un punto la fuente antes de dejar el anillo por debajo del mínimo', () => {
    // medio píxel más estrecha de lo que el anillo mínimo necesita con las etiquetas a tamaño normal
    const narrow = 2 * (GUTTER + PIE_MIN_OUTER_RADIUS) + labelWidth('alternative metal', AXIS_LABEL.fontSize) + labelWidth('hip hop', AXIS_LABEL.fontSize) - 1;
    const fit = fitPieLabels(LOPSIDED, narrow, HEIGHT);
    expect(fit.fontSize).toBeLessThan(AXIS_LABEL.fontSize);
    expect(fit.outer).toBeGreaterThanOrEqual(PIE_MIN_OUTER_RADIUS);
    // la bajada es por falta de sitio, no por ser estrecha: en el rail vuelve a su tamaño
    expect(fitPieLabels(LOPSIDED, RAIL_CARD, HEIGHT).fontSize).toBe(AXIS_LABEL.fontSize);
  });

  it('nunca baja del radio mínimo: por debajo, las etiquetas se parten', () => {
    expect(fitPieLabels(LOPSIDED, 200, HEIGHT).outer).toBe(PIE_MIN_OUTER_RADIUS);
  });
});
