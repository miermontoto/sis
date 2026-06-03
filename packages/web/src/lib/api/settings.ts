import type {
  RankingMetric, RankChangeLookback, WeekStartOption, LocaleSetting,
  AlbumTrackDisplay, SessionTrackingDisplay, SessionRankDisplay,
  NowPlayingDisplay, SocialVisibility,
} from '@sis/shared';
import { apiFetch } from './client.js';

interface SettingsData {
  rankingMetric: RankingMetric;
  rankChangeLookback: RankChangeLookback;
  weekStart: WeekStartOption;
  locale: LocaleSetting;
  albumTrackDisplay: AlbumTrackDisplay;
  albumShowDuration: boolean;
  albumShowAccolades: boolean;
  artistShowAlbumAccolades: boolean;
  artistShowTrackAccolades: boolean;
  sessionRankDisplay: SessionRankDisplay;
  sessionRankLimitYear: string;
  sessionRankLimitAll: string;
  sessionTrackingDisplay: SessionTrackingDisplay;
  nowPlayingDisplay: NowPlayingDisplay;
  socialVisibility: SocialVisibility;
  lastPeriodWeek: string | null;
  lastPeriodMonth: string | null;
  lastPeriodYear: string | null;
}

const SETTINGS_DEFAULTS: SettingsData = {
  rankingMetric: 'time',
  rankChangeLookback: 'disabled',
  weekStart: 'friday',
  locale: 'auto',
  albumTrackDisplay: 'fill',
  albumShowDuration: true,
  albumShowAccolades: true,
  artistShowAlbumAccolades: true,
  artistShowTrackAccolades: true,
  sessionRankDisplay: 'all+ytd',
  sessionRankLimitYear: '50',
  sessionRankLimitAll: '200',
  sessionTrackingDisplay: 'all',
  nowPlayingDisplay: 'auto',
  socialVisibility: 'visible',
  lastPeriodWeek: null,
  lastPeriodMonth: null,
  lastPeriodYear: null,
};

let settingsCache: SettingsData = { ...SETTINGS_DEFAULTS };
let settingsLoaded = false;

const lsKey = (key: string) =>
  key.startsWith('lastPeriod') ? `sis:lastPeriod:${key.slice(10).toLowerCase()}` : `sis:${key}`;

export async function loadSettings(): Promise<void> {
  let data: Record<string, string> = {};
  try {
    data = await apiFetch<Record<string, string>>('/settings');
  } catch {
    for (const key of Object.keys(SETTINGS_DEFAULTS)) {
      const v = localStorage.getItem(lsKey(key));
      if (v !== null) data[key] = v;
    }
  }

  settingsCache = { ...SETTINGS_DEFAULTS };
  for (const [key, def] of Object.entries(SETTINGS_DEFAULTS)) {
    const raw = data[key];
    if (typeof def === 'boolean') (settingsCache as any)[key] = raw !== undefined ? raw !== 'false' : def;
    else if (def === null) (settingsCache as any)[key] = raw || null;
    else (settingsCache as any)[key] = raw || def;
  }

  for (const [key, val] of Object.entries(settingsCache)) {
    if (val !== null) localStorage.setItem(lsKey(key), String(val));
  }
  settingsLoaded = true;
}

function updateSetting(patch: Partial<Record<string, string>>) {
  fetch(new URL('/api/settings', window.location.origin), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

function stringSetting<T extends string>(key: keyof SettingsData, defaultValue: T) {
  return [
    (): T => settingsLoaded ? settingsCache[key] as T : (localStorage.getItem(`sis:${key}`) as T) || defaultValue,
    (v: T) => { (settingsCache as any)[key] = v; localStorage.setItem(`sis:${key}`, v); updateSetting({ [key]: v }); },
  ] as const;
}

function boolSetting(key: keyof SettingsData) {
  return [
    (): boolean => settingsLoaded ? settingsCache[key] as boolean : localStorage.getItem(`sis:${key}`) !== 'false',
    (v: boolean) => { (settingsCache as any)[key] = v; localStorage.setItem(`sis:${key}`, String(v)); updateSetting({ [key]: String(v) }); },
  ] as const;
}

function withNotify<T>(setter: (v: T) => void) {
  const listeners: ((v: T) => void)[] = [];
  return {
    set(v: T) { setter(v); for (const fn of listeners) fn(v); },
    onChange(fn: (v: T) => void): () => void {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
  };
}

export const [getRankingMetric, setRankingMetric] = stringSetting<RankingMetric>('rankingMetric', 'time');
export const [getRankChangeLookback, setRankChangeLookback] = stringSetting<RankChangeLookback>('rankChangeLookback', 'disabled');
export const [getWeekStart, setWeekStart] = stringSetting<WeekStartOption>('weekStart', 'friday');
export const [getRawLocale, setLocale] = stringSetting<LocaleSetting>('locale', 'auto');
export const [getAlbumTrackDisplay, setAlbumTrackDisplay] = stringSetting<AlbumTrackDisplay>('albumTrackDisplay', 'fill');
export const [getAlbumShowDuration, setAlbumShowDuration] = boolSetting('albumShowDuration');
export const [getAlbumShowAccolades, setAlbumShowAccolades] = boolSetting('albumShowAccolades');
export const [getArtistShowAlbumAccolades, setArtistShowAlbumAccolades] = boolSetting('artistShowAlbumAccolades');
export const [getArtistShowTrackAccolades, setArtistShowTrackAccolades] = boolSetting('artistShowTrackAccolades');
export const [getSocialVisibility, setSocialVisibility] = stringSetting<SocialVisibility>('socialVisibility', 'visible');

export function getLocale(): string {
  const raw = getRawLocale();
  return raw === 'auto' ? navigator.language : raw;
}

const [_getSessionRankDisplay, _setSessionRankDisplay] = stringSetting<SessionRankDisplay>('sessionRankDisplay', 'all+ytd');
const _srd = withNotify<SessionRankDisplay>(_setSessionRankDisplay);
export const getSessionRankDisplay = _getSessionRankDisplay;
export const setSessionRankDisplay = _srd.set;
export const onSessionRankDisplayChange = _srd.onChange;

export const [getSessionRankLimitYear, setSessionRankLimitYear] = stringSetting('sessionRankLimitYear', '50');
export const [getSessionRankLimitAll, setSessionRankLimitAll] = stringSetting('sessionRankLimitAll', '200');

const [_getSessionTrackingDisplay, _setSessionTrackingDisplay] = stringSetting<SessionTrackingDisplay>('sessionTrackingDisplay', 'all');
const _std = withNotify<SessionTrackingDisplay>(_setSessionTrackingDisplay);
export const getSessionTrackingDisplay = _getSessionTrackingDisplay;
export const setSessionTrackingDisplay = _std.set;
export const onSessionTrackingDisplayChange = _std.onChange;

const [_getNowPlayingDisplay, _setNowPlayingDisplay] = stringSetting<NowPlayingDisplay>('nowPlayingDisplay', 'auto');
const _npd = withNotify<NowPlayingDisplay>(_setNowPlayingDisplay);
export const getNowPlayingDisplay = _getNowPlayingDisplay;
export const setNowPlayingDisplay = _npd.set;
export const onNowPlayingDisplayChange = _npd.onChange;

const LAST_PERIOD_SETTING_KEY: Record<string, string> = {
  week: 'lastPeriodWeek',
  month: 'lastPeriodMonth',
  year: 'lastPeriodYear',
};

export function setLastPeriod(gran: string, value: string) {
  const settingKey = LAST_PERIOD_SETTING_KEY[gran] as keyof SettingsData;
  (settingsCache as any)[settingKey] = value;
  localStorage.setItem(`sis:lastPeriod:${gran}`, value);
  updateSetting({ [settingKey]: value });
}
