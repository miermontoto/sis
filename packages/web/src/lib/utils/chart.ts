import type { EChartsOption } from 'echarts';

// --- Shared defaults ---

export const GRID = { top: 10, bottom: 5, left: 5, right: 5, containLabel: true };

export const AXIS_LINE = { lineStyle: { color: '#2a2a2a' } } as const;

export const AXIS_LABEL = { color: '#888', fontSize: 11 } as const;

export const SPLIT_LINE = { lineStyle: { color: '#2a2a2a' } } as const;

export const TOOLTIP_BASE = {
  trigger: 'axis' as const,
  backgroundColor: '#1a1a1a',
  borderColor: '#2a2a2a',
  textStyle: { color: '#e5e5e5' },
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
    axisLabel: { color: '#555', fontSize: 11 },
    ...overrides,
  };
}

// --- Series style helpers ---

export function barSeries(data: number[], overrides?: Record<string, any>) {
  return {
    type: 'bar' as const,
    data,
    itemStyle: { color: GREEN, borderRadius: [3, 3, 0, 0] },
    barMaxWidth: 24,
    ...overrides,
  };
}

export function lineSeries(data: number[], overrides?: Record<string, any>) {
  return {
    type: 'line' as const,
    data,
    smooth: true,
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

// --- Pie chart ---

export const PIE_TOOLTIP = { trigger: 'item' as const, formatter: '{b}: {c} ({d}%)' };

export const PIE_COLORS = ['#1db954', '#1ed760', '#2ecc71', '#27ae60', '#16a085', '#1abc9c', '#3498db', '#2980b9', '#9b59b6', '#8e44ad'] as const;
