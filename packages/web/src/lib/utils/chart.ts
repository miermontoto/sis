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