export type RankingMetric = 'time' | 'plays';
export type WeekStartOption = 'monday' | 'sunday' | 'friday';
export type Granularity = 'week' | 'month' | 'year';
export type EntityType = 'artist' | 'track' | 'album';

/** 'auto' = browser default, otherwise a BCP 47 tag like 'en-US', 'es-ES' */
export type LocaleSetting = 'auto' | string;
export type RankChangeLookback = 'disabled' | '7d' | '30d';
export type AlbumTrackDisplay = 'off' | 'fill' | 'percent';

export const LOCALE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Browser default' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Espa\u00f1ol' },
  { value: 'fr-FR', label: 'Fran\u00e7ais' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'pt-BR', label: 'Portugu\u00eas (BR)' },
  { value: 'ja-JP', label: '\u65e5\u672c\u8a9e' },
  { value: 'zh-CN', label: '\u4e2d\u6587' },
];

export interface DateRangeParams {
  startDate: string;
  endDate: string;
}
