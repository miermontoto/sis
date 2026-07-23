import type { EChartsOption } from 'echarts';

// --- Shared defaults ---

const MONO_STACK = 'ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace';

export const GRID = { top: 10, bottom: 5, left: 5, right: 0, containLabel: true };

export const AXIS_LINE = { lineStyle: { color: '#1e2a2a' } } as const;

export const AXIS_LABEL = { color: '#6a7a7a', fontSize: 11, fontFamily: MONO_STACK } as const;

export const SPLIT_LINE = { lineStyle: { color: '#1e2a2a', type: 'dashed' } } as const;

export const TOOLTIP_BASE = {
  trigger: 'axis' as const,
  backgroundColor: '#0f1214',
  borderColor: '#1e2a2a',
  textStyle: { color: '#e0e8e8', fontFamily: MONO_STACK },
};

export const GREEN = '#1db954';

// --- Axis helpers ---

export function categoryAxis(data: string[], overrides?: Record<string, any>): EChartsOption['xAxis'] {
  return {
    type: 'category',
    data,
    axisLabel: { ...AXIS_LABEL },
    axisLine: { ...AXIS_LINE },
    ...overrides,
  };
}

export function valueAxis(overrides?: Record<string, any>): EChartsOption['yAxis'] {
  return {
    type: 'value',
    splitLine: { ...SPLIT_LINE },
    axisLabel: { ...AXIS_LABEL },
    ...overrides,
  };
}

export function secondaryValueAxis(overrides?: Record<string, any>): EChartsOption['yAxis'] {
  return {
    type: 'value',
    splitLine: { show: false },
    axisLabel: { color: '#4a5a5a', fontSize: 11, fontFamily: MONO_STACK },
    ...overrides,
  };
}

// --- Series style helpers ---

// --- Adaptación de densidad temporal ---
// el ancho de barra de un chart de categorías es plotWidth/N: con series largas
// (range=all → ~130 meses) en viewports estrechos las barras quedan ilegibles.
// en vez de comprimir (o scrollear), se agrega la serie a una granularidad más
// gruesa (mes → trimestre → año) hasta que cada barra tiene un slot legible.

export interface SeriesPoint { period: string; play_count: number; total_ms: number }

// suelo de ancho por barra (px) por debajo del cual se considera ilegible
export const MIN_BAR_SLOT_PX = 10;

// lunes ISO de una semana YYYY-Www (W01 contiene el 4 de enero)
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

// normaliza cualquier periodo (día/semana/mes) a su mes calendario YYYY-MM
export function periodToMonth(period: string): string {
  const w = period.match(/^(\d{4})-W(\d{2})$/);
  if (w) {
    const d = isoWeekMonday(parseInt(w[1]), parseInt(w[2]));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return period.slice(0, 7);
}

export function periodToQuarter(period: string): string {
  const m = periodToMonth(period);
  const q = Math.floor((parseInt(m.slice(5, 7)) - 1) / 3) + 1;
  return `${m.slice(0, 4)}-Q${q}`;
}

export function periodToYear(period: string): string {
  return period.slice(0, 4);
}

// agrupa la serie por clave calendario preservando el orden de aparición y
// sumando plays/ms (no pierde datos, solo baja la resolución)
export function aggregateSeries(data: SeriesPoint[], keyFn: (p: string) => string): SeriesPoint[] {
  const buckets = new Map<string, SeriesPoint>();
  for (const d of data) {
    const key = keyFn(d.period);
    const b = buckets.get(key);
    if (b) { b.play_count += d.play_count; b.total_ms += d.total_ms; }
    else buckets.set(key, { period: key, play_count: d.play_count, total_ms: d.total_ms });
  }
  return [...buckets.values()];
}

// elige la granularidad más fina cuyas barras entran con al menos MIN_BAR_SLOT_PX
// en containerWidth; devuelve la serie tal cual si ya cabe o si aún no se ha
// medido el ancho (containerWidth 0). así el nivel de detalle depende del ancho
// disponible y no comprime nunca las barras por debajo del suelo legible.
export function fitSeries(data: SeriesPoint[], containerWidth: number): SeriesPoint[] {
  if (!containerWidth || data.length === 0) return data;
  const maxBars = Math.floor(containerWidth / MIN_BAR_SLOT_PX);
  if (data.length <= maxBars) return data;
  let best = data;
  for (const keyFn of [periodToMonth, periodToQuarter, periodToYear]) {
    best = aggregateSeries(data, keyFn);
    if (best.length <= maxBars) break;
  }
  return best;
}

export function barSeries(data: number[], overrides?: Record<string, any>) {
  return {
    type: 'bar' as const,
    data,
    itemStyle: { color: GREEN, borderRadius: [1, 1, 0, 0], borderColor: '#0f1214', borderWidth: 1 },
    barMaxWidth: 24,
    ...overrides,
  };
}

export function lineSeries(data: number[], overrides?: Record<string, any>) {
  return {
    type: 'line' as const,
    data,
    smooth: false,
    symbol: 'none',
    lineStyle: { color: GREEN, width: 2 },
    itemStyle: { color: GREEN },
    ...overrides,
  };
}

export function cumulativeLineSeries(data: number[], overrides?: Record<string, any>) {
  return lineSeries(data, {
    yAxisIndex: 1,
    lineStyle: { color: 'rgba(255,255,255,0.3)', width: 2 },
    itemStyle: { color: 'rgba(255,255,255,0.3)' },
    silent: true,
    ...overrides,
  });
}

export function areaGradient(color = GREEN, opacityTop = 0.4, opacityBottom = 0.02) {
  const hex = color.replace('#', '');
  const [r, g, b] = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map(h => parseInt(h, 16));
  return {
    color: {
      type: 'linear' as const,
      x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [
        { offset: 0, color: `rgba(${r},${g},${b},${opacityTop})` },
        { offset: 1, color: `rgba(${r},${g},${b},${opacityBottom})` },
      ],
    },
  };
}

// --- Grid helpers ---

export function dualAxisGrid(overrides?: Record<string, any>) {
  return { ...GRID, ...overrides };
}

// --- Zoom ---

// dataZoom sobre el eje X: rueda/arrastre (inside) + slider visible abajo.
// filterMode 'filter' hace que el eje Y se reescale a la ventana visible,
// útil en gráficas acumuladas donde las series arrancan apelotonadas en cero.
export function zoomX(): NonNullable<EChartsOption['dataZoom']> {
  // cast final: los typings de echarts exigen handleLabel junto a handleStyle en
  // emphasis; solo queremos el color, así que se relaja el chequeo del literal
  return [
    { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
    {
      type: 'slider',
      xAxisIndex: 0,
      filterMode: 'filter',
      height: 16,
      bottom: 6,
      borderColor: '#1e2a2a',
      backgroundColor: 'transparent',
      fillerColor: 'rgba(29,185,84,0.10)',
      dataBackground: { lineStyle: { color: '#1e2a2a' }, areaStyle: { color: '#162020' } },
      selectedDataBackground: { lineStyle: { color: GREEN }, areaStyle: { color: 'rgba(29,185,84,0.12)' } },
      handleStyle: { color: GREEN, borderColor: GREEN },
      moveHandleStyle: { color: GREEN },
      emphasis: { handleStyle: { color: GREEN } },
      textStyle: { color: '#6a7a7a', fontSize: 10 },
    },
  ] as unknown as NonNullable<EChartsOption['dataZoom']>;
}

// --- Eventos de lanzamiento (release markers) ---

// evento puntual (fecha de lanzamiento de un álbum/single) a marcar sobre una gráfica
export interface ChartEvent { date: string; label: string; kind: 'album' | 'single'; imageUrl?: string | null }

// tamaño de las carátulas que marcan eventos y carátulas máximas por bucket
export const EVENT_COVER_PX = 22;
const EVENT_MAX_COVERS = 3;
// margen superior del grid necesario para que las carátulas no se recorten
export const EVENT_GRID_TOP = EVENT_COVER_PX + 12;

// réplica del %W de strftime en SQLite (semana con lunes como primer día, contada
// desde el primer lunes del año; los días anteriores caen en W00) — debe coincidir
// exactamente con las claves semanales que genera la API
function sqliteWeekKey(date: Date): string {
  const jan1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const yday = Math.floor((date.getTime() - jan1.getTime()) / 86400000);
  const week = Math.floor((yday + 7 - ((date.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// convierte una fecha ISO (YYYY-MM-DD, o parcial YYYY / YYYY-MM de Spotify) a la clave
// de periodo del formato de muestra dado; null si la precisión de la fecha no alcanza
export function dateToPeriodKey(date: string, sampleFormat: string): string | null {
  if (/^\d{4}$/.test(sampleFormat)) return date.slice(0, 4);
  if (/^\d{4}-Q\d$/.test(sampleFormat)) return date.length >= 7 ? periodToQuarter(date.slice(0, 7)) : null;
  if (/^\d{4}-\d{2}$/.test(sampleFormat)) return date.length >= 7 ? date.slice(0, 7) : null;
  if (/^\d{4}-W\d{2}$/.test(sampleFormat)) return date.length >= 10 ? sqliteWeekKey(new Date(`${date}T00:00:00Z`)) : null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(sampleFormat)) return date.length >= 10 ? date : null;
  return null;
}

// construye el markLine de eventos para una serie de barras sobre eje de categorías:
// mapea cada evento al bucket del periodo mostrado y agrupa los que caen en el mismo.
// álbumes con línea más visible que singles; encima de cada línea se muestran las
// carátulas (sin rotar, hasta EVENT_MAX_COVERS) y el nombre aparece al hacer hover.
export function eventsMarkLine(events: ChartEvent[], periods: string[]) {
  if (!events.length || !periods.length) return undefined;
  const byIdx = new Map<number, ChartEvent[]>();
  for (const e of events) {
    const key = dateToPeriodKey(e.date, periods[0]);
    const idx = key === null ? -1 : periods.indexOf(key);
    if (idx >= 0) byIdx.set(idx, [...(byIdx.get(idx) ?? []), e]);
  }
  if (!byIdx.size) return undefined;
  return {
    symbol: 'none',
    animation: false,
    data: [...byIdx.entries()].map(([idx, evs]) => {
      const hasAlbum = evs.some(e => e.kind === 'album');
      // álbumes primero para que su carátula gane el hueco limitado del bucket
      const covers = [...evs].sort((a, b) => Number(b.kind === 'album') - Number(a.kind === 'album'))
        .filter(e => e.imageUrl).slice(0, EVENT_MAX_COVERS);
      const rich = Object.fromEntries(covers.map((e, i) => [`c${i}`, {
        backgroundColor: { image: e.imageUrl! },
        width: EVENT_COVER_PX,
        height: EVENT_COVER_PX,
      }]));
      return {
        xAxis: idx,
        lineStyle: { color: hasAlbum ? 'rgba(224,232,232,0.5)' : 'rgba(224,232,232,0.18)', type: 'dashed' as const, width: 1 },
        label: {
          show: covers.length > 0,
          formatter: () => covers.map((_, i) => `{c${i}|}`).join(' '),
          rich,
          position: 'end' as const,
          rotate: 0,
          distance: 3,
        },
        emphasis: {
          label: {
            show: true,
            formatter: () => evs.map(e => e.label).join('\n'),
            position: 'end' as const,
            rotate: 0,
            color: '#e0e8e8',
            fontSize: 10,
            backgroundColor: '#0f1214',
            borderColor: '#1e2a2a',
            borderWidth: 1,
            padding: [3, 6],
            borderRadius: 4,
          },
        },
      };
    }),
  };
}

// --- Trend line ---

export function linearRegression(values: number[]): { line: number[]; r2: number } {
  const n = values.length;
  if (n < 2) return { line: [...values], r2: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += values[i]; sxx += i * i; sxy += i * values[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const line = Array.from({ length: n }, (_, i) => intercept + slope * i);
  const mean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (values[i] - mean) ** 2;
    ssRes += (values[i] - line[i]) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { line, r2 };
}

export function trendSeries(line: number[], overrides?: Record<string, any>) {
  return {
    type: 'line' as const,
    data: line,
    smooth: false,
    symbol: 'none',
    lineStyle: { color: 'rgba(255,255,255,0.25)', width: 1.5, type: 'dashed' as const },
    itemStyle: { color: 'rgba(255,255,255,0.25)' },
    silent: true,
    tooltip: { show: false },
    ...overrides,
  };
}

// --- Pie chart ---

export const PIE_TOOLTIP = { trigger: 'item' as const, formatter: '{b}: {c} ({d}%)' };

export const PIE_COLORS = ['#1db954', '#1ed760', '#2ecc71', '#27ae60', '#16a085', '#1abc9c', '#3498db', '#2980b9', '#9b59b6', '#8e44ad'] as const;