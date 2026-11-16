// registro de widgets del dashboard: qué tipos existen, en qué tamaños se
// pintan, qué ajustes tiene cada uno y en qué sección caen. módulo puro (sin
// componentes ni settings) para poder testear el modelo de layout y armar los
// formularios de ajustes de forma genérica: un widget nuevo se declara aquí y en
// components.ts

// la rejilla es de columnas cuadradas partidas en dos medias filas: los tamaños se
// miden en columnas × medias filas. tile y band son los compactos (media celda de
// alto, la altura de la antigua barra de stats: una cifra, o una cifra con su
// gráfica); el resto son los de iOS (small 1×1, medium 2×1, large 2×2, xl 4×2) más
// tall (2×4), la lista larga que acompaña a dos collages apilados
export type WidgetSize = 'tile' | 'band' | 'small' | 'medium' | 'large' | 'tall' | 'xl';
export const WIDGET_SIZES: readonly WidgetSize[] = ['tile', 'band', 'small', 'medium', 'large', 'tall', 'xl'];
export const SIZE_SPAN: Record<WidgetSize, { cols: number; rows: number }> = {
  tile: { cols: 1, rows: 1 },
  band: { cols: 2, rows: 1 },
  small: { cols: 1, rows: 2 },
  medium: { cols: 2, rows: 2 },
  large: { cols: 2, rows: 4 },
  tall: { cols: 2, rows: 8 },
  xl: { cols: 4, rows: 4 },
};
export const SIZE_LABELS: Record<WidgetSize, string> = { tile: 'Compact', band: 'Compact wide', small: 'Small', medium: 'Medium', large: 'Large', tall: 'Tall', xl: 'Extra large' };
export const SIZE_SHORT: Record<WidgetSize, string> = { tile: 'XS', band: 'XS+', small: 'S', medium: 'M', large: 'L', tall: 'T', xl: 'XL' };
// los compactos: una sola línea de contenido, sin cabecera
export const isCompact = (size: WidgetSize) => size === 'tile' || size === 'band';

// secciones del dashboard, de la más cercana a la más lejana en el tiempo. Un
// widget no se coloca en una: cae en la que dice su propio alcance (`scope`), así
// que un top que pasa a all time se muda a All time
export type SectionKey = 'today' | 'week' | 'month' | 'year' | 'all' | 'past';
export const SECTIONS: readonly { key: SectionKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
  { key: 'past', label: 'Looking back' },
];

export type WidgetSettingValue = string | number | boolean;
export type WidgetSettings = Record<string, WidgetSettingValue>;

export interface FieldOption { value: string; label: string }

interface FieldBase {
  key: string;
  label: string;
  // el campo sólo tiene sentido con ciertos valores de los demás (el collage
  // de un top de temas no existe): oculto, su valor se conserva
  showIf?: (s: WidgetSettings) => boolean;
}
export type SettingField =
  | (FieldBase & { kind: 'select'; options: readonly FieldOption[]; default: string })
  | (FieldBase & { kind: 'number'; min: number; max: number; step: number; default: number; unit?: string })
  | (FieldBase & { kind: 'toggle'; default: boolean });

export type WidgetFamily = 'overview' | 'habits' | 'memories' | 'live' | 'charts';
export const FAMILY_LABELS: Record<WidgetFamily, string> = {
  overview: 'Overview',
  habits: 'Time & habits',
  memories: 'Memories',
  live: 'Live & social',
  charts: 'Charts & records',
};

export interface WidgetDef {
  type: string;
  label: string;
  description: string;
  family: WidgetFamily;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  fields: readonly SettingField[];
  // sección en la que cae con estos ajustes
  scope: (s: WidgetSettings) => SectionKey;
}

// --- opciones compartidas entre widgets ---

export const ENTITY_OPTIONS: readonly FieldOption[] = [
  { value: 'track', label: 'Tracks' },
  { value: 'album', label: 'Albums' },
  { value: 'artist', label: 'Artists' },
];

// los rangos de TIME_RANGES (shared) con la etiqueta larga del formulario; la
// frase va en los títulos ("Top tracks this week")
export const RANGE_OPTIONS: readonly FieldOption[] = [
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: '3months', label: 'Last 3 months' },
  { value: '6months', label: 'Last 6 months' },
  { value: 'year', label: 'Last 12 months' },
  { value: 'thisYear', label: 'This year' },
  { value: 'all', label: 'All time' },
];
export const RANGE_PHRASES: Record<string, string> = {
  week: 'this week',
  month: 'last 30 days',
  '3months': 'last 3 months',
  '6months': 'last 6 months',
  year: 'last 12 months',
  thisYear: 'this year',
  all: 'all time',
};
// sección de cada rango: los de meses y el año en curso van juntos en This year
const RANGE_SECTION: Record<string, SectionKey> = {
  week: 'week', month: 'month', '3months': 'year', '6months': 'year', year: 'year', thisYear: 'year', all: 'all',
};
const byRange = (s: WidgetSettings): SectionKey => RANGE_SECTION[String(s.range)] ?? 'week';

export const GRANULARITY_OPTIONS: readonly FieldOption[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

// 'auto' = la métrica de ranking de Settings, para que el widget siga el ajuste global
export const METRIC_OPTIONS: readonly FieldOption[] = [
  { value: 'auto', label: 'Ranking metric' },
  { value: 'plays', label: 'Plays' },
  { value: 'time', label: 'Time' },
];

// cifras del widget de cifra (ver Figure.svelte), con la sección de cada una
export const FIGURE_OPTIONS: readonly FieldOption[] = [
  { value: 'playsToday', label: 'Plays today' },
  { value: 'timeToday', label: 'Listened today' },
  { value: 'streak', label: 'Streak' },
  { value: 'playsWeek', label: 'Plays this week' },
  { value: 'timeWeek', label: 'Listened this week' },
  { value: 'playsYear', label: 'Plays this year' },
  { value: 'timeYear', label: 'Listened this year' },
  { value: 'totalPlays', label: 'Total plays' },
];
const FIGURE_SECTION: Record<string, SectionKey> = {
  playsToday: 'today', timeToday: 'today', streak: 'today',
  playsWeek: 'week', timeWeek: 'week',
  playsYear: 'year', timeYear: 'year',
  totalPlays: 'all',
};
const PERIOD_SECTION: Record<string, SectionKey> = { day: 'today', week: 'week', month: 'month', year: 'year' };

const entityField = (fallback: string, options: readonly FieldOption[] = ENTITY_OPTIONS): SettingField =>
  ({ kind: 'select', key: 'entity', label: 'Show', options, default: fallback });
const rangeField = (fallback: string, options: readonly FieldOption[] = RANGE_OPTIONS): SettingField =>
  ({ kind: 'select', key: 'range', label: 'Range', options, default: fallback });
const metricField: SettingField = { kind: 'select', key: 'metric', label: 'Measure', options: METRIC_OPTIONS, default: 'auto' };
const granularityField: SettingField = { kind: 'select', key: 'granularity', label: 'Period', options: GRANULARITY_OPTIONS, default: 'week' };
const fixed = (section: SectionKey) => () => section;

export const WIDGETS: readonly WidgetDef[] = [
  // --- overview: las secciones que tenía el dashboard ---
  {
    type: 'stat', label: 'Figure', family: 'overview',
    description: 'One figure with its context line: plays or time today, this week or this year, your streak, total plays.',
    sizes: ['tile', 'band', 'small', 'medium'], defaultSize: 'tile',
    fields: [{ kind: 'select', key: 'figure', label: 'Figure', options: FIGURE_OPTIONS, default: 'playsToday' }],
    scope: s => FIGURE_SECTION[String(s.figure)] ?? 'today',
  },
  {
    type: 'weekStrip', label: 'Last 7 days', family: 'overview',
    description: 'One bar per day for the last week, today highlighted.',
    sizes: ['band', 'medium', 'large', 'xl'], defaultSize: 'band',
    fields: [metricField],
    scope: fixed('today'),
  },
  {
    type: 'top', label: 'Top list', family: 'overview',
    description: 'Your top tracks, albums or artists for any range, as a list or a collage.',
    sizes: ['small', 'medium', 'large', 'tall', 'xl'], defaultSize: 'large',
    fields: [
      entityField('track'),
      rangeField('week'),
      {
        kind: 'select', key: 'style', label: 'Style', default: 'list',
        options: [{ value: 'list', label: 'List' }, { value: 'collage', label: 'Collage' }],
        showIf: s => s.entity !== 'track',
      },
    ],
    scope: byRange,
  },
  {
    type: 'lastReport', label: 'Latest report', family: 'overview',
    description: 'The last closed week, month or year with its three #1s.',
    sizes: ['medium', 'large', 'xl'], defaultSize: 'large',
    fields: [granularityField],
    scope: fixed('past'),
  },
  {
    type: 'lastYear', label: 'This week last year', family: 'overview',
    description: 'What topped the same week one year ago.',
    sizes: ['medium', 'large', 'tall', 'xl'], defaultSize: 'large',
    fields: [entityField('track')],
    scope: fixed('past'),
  },
  {
    type: 'genres', label: 'Top genres', family: 'overview',
    description: 'Genre mix of your listening.',
    sizes: ['medium', 'large'], defaultSize: 'large',
    fields: [rangeField('week')],
    scope: byRange,
  },
  {
    type: 'rankChanges', label: 'Ranking changes', family: 'overview',
    description: 'Who climbed your all-time and year rankings in the last 7 days.',
    sizes: ['medium', 'large', 'tall'], defaultSize: 'large',
    fields: [entityField('artist')],
    scope: fixed('week'),
  },
  {
    type: 'recentPlays', label: 'Recent plays', family: 'overview',
    description: 'Your latest plays, live.',
    sizes: ['medium', 'large', 'tall', 'xl'], defaultSize: 'large',
    fields: [],
    scope: fixed('today'),
  },

  // --- time & habits ---
  {
    type: 'clock', label: 'Listening clock', family: 'habits',
    description: 'When you listen: hours of the day, and by weekday at larger sizes.',
    sizes: ['medium', 'large', 'xl'], defaultSize: 'large',
    fields: [rangeField('month')],
    scope: byRange,
  },
  {
    type: 'calendar', label: 'Listening calendar', family: 'habits',
    description: 'A square per day, shaded by how much you listened. Wider sizes go further back.',
    sizes: ['medium', 'large', 'xl'], defaultSize: 'xl',
    fields: [metricField],
    scope: fixed('all'),
  },
  {
    type: 'goal', label: 'Listening goal', family: 'habits',
    description: 'Progress towards a target for the day, week, month or year, with your pace.',
    sizes: ['tile', 'band', 'small', 'medium'], defaultSize: 'tile',
    fields: [
      { kind: 'select', key: 'period', label: 'Period', default: 'week', options: [{ value: 'day', label: 'Day' }, ...GRANULARITY_OPTIONS] },
      { kind: 'select', key: 'unit', label: 'Goal in', default: 'time', options: [{ value: 'time', label: 'Hours' }, { value: 'plays', label: 'Plays' }] },
      { kind: 'number', key: 'target', label: 'Target', min: 1, max: 100_000, step: 1, default: 20 },
    ],
    scope: s => PERIOD_SECTION[String(s.period)] ?? 'week',
  },

  // --- memories ---
  {
    type: 'onThisDay', label: 'On this day', family: 'memories',
    description: 'What you played on this date in past years.',
    sizes: ['medium', 'large'], defaultSize: 'medium',
    fields: [],
    scope: fixed('past'),
  },
  {
    type: 'anniversaries', label: 'Anniversaries', family: 'memories',
    description: 'Artists you first heard and albums released on this date.',
    sizes: ['medium', 'large'], defaultSize: 'medium',
    fields: [],
    scope: fixed('past'),
  },
  {
    type: 'milestone', label: 'Next milestone', family: 'memories',
    description: 'How far your next all-time play milestone is, and when you will get there.',
    sizes: ['tile', 'band', 'small', 'medium'], defaultSize: 'band',
    fields: [],
    scope: fixed('all'),
  },

  // --- live & social ---
  {
    type: 'session', label: 'This session', family: 'live',
    description: 'Ranking moves your current session is about to make.',
    sizes: ['medium', 'large', 'tall'], defaultSize: 'large',
    fields: [],
    scope: fixed('today'),
  },
  {
    type: 'friends', label: 'Friends', family: 'live',
    description: 'What the people you follow are playing.',
    sizes: ['medium', 'large', 'tall'], defaultSize: 'large',
    fields: [],
    scope: fixed('today'),
  },

  // --- charts & records ---
  {
    type: 'chart', label: 'Chart', family: 'charts',
    description: 'The chart in progress with its new entries, re-entries and movers.',
    sizes: ['medium', 'large', 'tall', 'xl'], defaultSize: 'large',
    fields: [entityField('track'), granularityField],
    scope: s => PERIOD_SECTION[String(s.granularity)] ?? 'week',
  },
  {
    type: 'record', label: 'Record spotlight', family: 'charts',
    description: 'One of your records, a different one every day.',
    sizes: ['medium', 'large'], defaultSize: 'medium',
    fields: [entityField('any', [{ value: 'any', label: 'Anything' }, ...ENTITY_OPTIONS])],
    scope: fixed('all'),
  },
  {
    type: 'discoveries', label: 'New to you', family: 'charts',
    description: 'Artists, albums or tracks you heard for the first time.',
    sizes: ['medium', 'large', 'tall', 'xl'], defaultSize: 'large',
    fields: [entityField('artist'), rangeField('week', RANGE_OPTIONS.filter(o => o.value !== 'all'))],
    scope: byRange,
  },
  {
    type: 'concerts', label: 'Concerts', family: 'charts',
    description: 'Your upcoming and latest logged shows.',
    sizes: ['medium', 'large'], defaultSize: 'medium',
    fields: [],
    scope: fixed('past'),
  },
];

const BY_TYPE = new Map(WIDGETS.map(w => [w.type, w]));
export const widgetDef = (type: string): WidgetDef | undefined => BY_TYPE.get(type);

// sección de un widget con unos ajustes (los tipos retirados caen en Today)
export const widgetSection = (type: string, settings: WidgetSettings): SectionKey => widgetDef(type)?.scope(settings) ?? 'today';

// ajustes efectivos: default de cada campo y, encima, lo guardado que siga siendo
// válido (una opción retirada o un número fuera de rango vuelven al default).
// las claves desconocidas se descartan
export function resolveSettings(def: WidgetDef, stored: Partial<WidgetSettings> | undefined): WidgetSettings {
  const out: WidgetSettings = {};
  for (const f of def.fields) {
    const v = stored?.[f.key];
    out[f.key] = validValue(f, v) ? v : f.default;
  }
  return out;
}

function validValue(f: SettingField, v: unknown): v is WidgetSettingValue {
  switch (f.kind) {
    case 'select': return typeof v === 'string' && f.options.some(o => o.value === v);
    case 'number': return typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max;
    case 'toggle': return typeof v === 'boolean';
  }
}
