import { describe, it, expect } from 'vitest';
import { timelineMonths, bucketTimeline, fitTimeline, bucketIndexOf, monthRange, weekMonth, type TimelineSources } from './entity-timeline';
import { periodToQuarter, MIN_BAR_SLOT_PX } from './chart';

const NOW = new Date('2026-10-14T12:00:00Z');

function sources(overrides: Partial<TimelineSources> = {}): TimelineSources {
  return { series: [], rankHistory: [], chartWeeks: [], weekStart: 'monday', now: NOW, ...overrides };
}

describe('monthRange', () => {
  it('cruza el cambio de año', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('weekMonth', () => {
  it('lleva la semana al mes de su primer día, con el corte de weekStart', () => {
    // 2026-W13 en lunes empieza el lunes 30 de marzo; con corte en viernes, el viernes 3 de abril
    expect(weekMonth('2026-W13', 'monday')).toBe('2026-03');
    expect(weekMonth('2026-W13', 'friday')).toBe('2026-04');
  });
});

describe('timelineMonths', () => {
  it('extiende el eje hasta el mes en curso aunque la entidad dejara de sonar', () => {
    const months = timelineMonths(sources({
      series: [{ period: '2026-06', play_count: 3, total_ms: 600 }, { period: '2026-08', play_count: 1, total_ms: 200 }],
    }));
    expect(months.map(m => m.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(months.map(m => m.plays)).toEqual([3, 0, 1, 0, 0]);
    // el acumulado no baja en los meses vacíos
    expect(months.map(m => m.cumPlays)).toEqual([3, 3, 4, 4, 4]);
  });

  it('arrastra la posición all-time por los meses sin historial', () => {
    const months = timelineMonths(sources({
      series: [{ period: '2026-07', play_count: 1, total_ms: 1 }],
      rankHistory: [{ period: '2026-07', rank: 40 }, { period: '2026-09', rank: 25 }],
    }));
    expect(months.map(m => m.rank)).toEqual([40, 40, 25, 25]);
  });

  it('deja la posición a null antes del primer play', () => {
    const months = timelineMonths(sources({
      series: [{ period: '2026-08', play_count: 1, total_ms: 1 }],
      rankHistory: [{ period: '2026-09', rank: 12 }],
    }));
    expect(months.map(m => m.rank)).toEqual([null, 12, 12]);
  });

  it('se queda con la mejor semana de cada mes e ignora las semanas fuera del chart', () => {
    const months = timelineMonths(sources({
      series: [{ period: '2026-09', play_count: 1, total_ms: 1 }],
      chartWeeks: [
        { period: '2026-W36', rank: 9 }, // empieza el lunes 7 de septiembre
        { period: '2026-W37', rank: 4 },
        { period: '2026-W38', rank: null },
        { period: '2026-W41', rank: 15 }, // empieza el lunes 12 de octubre
      ],
    }));
    expect(months.map(m => m.chartRank)).toEqual([4, 15]);
  });

  it('sin datos no hay eje', () => {
    expect(timelineMonths(sources())).toEqual([]);
  });
});

describe('bucketTimeline', () => {
  const months = timelineMonths(sources({
    series: [
      { period: '2026-01', play_count: 2, total_ms: 20 },
      { period: '2026-02', play_count: 3, total_ms: 30 },
      { period: '2026-04', play_count: 5, total_ms: 50 },
    ],
    rankHistory: [{ period: '2026-01', rank: 30 }, { period: '2026-02', rank: 20 }, { period: '2026-04', rank: 8 }],
    chartWeeks: [{ period: '2026-W06', rank: 7 }, { period: '2026-W15', rank: 2 }],
  }));

  it('suma las escuchas y cierra acumulado y posición en el último mes del bucket', () => {
    const [q1, q2] = bucketTimeline(months, periodToQuarter);
    expect(q1).toMatchObject({ key: '2026-Q1', months: ['2026-01', '2026-02', '2026-03'], plays: 5, ms: 50, cumPlays: 5, rank: 20, chartRank: 7 });
    expect(q2).toMatchObject({ key: '2026-Q2', plays: 5, cumPlays: 10, rank: 8, chartRank: 2 });
  });

  it('no muta los meses de entrada', () => {
    bucketTimeline(months, periodToQuarter);
    expect(months[0]).toMatchObject({ key: '2026-01', months: ['2026-01'], plays: 2 });
  });
});

describe('fitTimeline', () => {
  const longHistory = timelineMonths(sources({ series: [{ period: '2016-01', play_count: 1, total_ms: 1 }] }));

  it('baja de granularidad hasta que cada columna tiene un slot legible', () => {
    const width = 330;
    const fitted = fitTimeline(longHistory, width, 'month', null);
    expect(width / fitted.length).toBeGreaterThanOrEqual(MIN_BAR_SLOT_PX);
    expect(fitted[0].key).toMatch(/^\d{4}(-Q[1-4])?$/);
  });

  it('sin ancho medido deja los meses', () => {
    expect(fitTimeline(longHistory, 0, 'month', null)).toBe(longHistory);
  });

  it('por años agrupa siempre, quepa o no', () => {
    expect(fitTimeline(longHistory, 4000, 'year', null).map(b => b.key)).toEqual(
      Array.from({ length: 11 }, (_, i) => String(2016 + i)),
    );
  });

  it('el año enfocado son sus meses, sin agregar', () => {
    const focused = fitTimeline(longHistory, 100, 'year', '2020');
    expect(focused.map(b => b.key)).toEqual(monthRange('2020-01', '2020-12'));
  });
});

describe('bucketIndexOf', () => {
  it('encuentra el bucket que contiene el mes', () => {
    const months = timelineMonths(sources({ series: [{ period: '2025-01', play_count: 1, total_ms: 1 }] }));
    const quarters = bucketTimeline(months, periodToQuarter);
    expect(quarters[bucketIndexOf(quarters, '2025-05')].key).toBe('2025-Q2');
    expect(bucketIndexOf(quarters, '2024-12')).toBe(-1);
  });
});
