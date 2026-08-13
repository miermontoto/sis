import type {
  RankingMetric, RankChangeLookback, WeekStartOption, LocaleSetting,
  AlbumTrackDisplay, SessionTrackingDisplay, SessionRankDisplay,
  NowPlayingDisplay, SocialVisibility,
} from '@sis/shared';
import { type LayoutKind, type DetailLayout, resolveLayout, parseLayout } from '../detail-layout.js';
import { apiFetch, API_BASE } from './client.js';

interface SettingsData {
  rankingMetric: RankingMetric;
  rankChangeLookback: RankChangeLookback;
  weekStart: WeekStartOption;
  recordsUnique: boolean;
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
  sidebarCollapsed: boolean;
  notificationsEnabled: boolean;
  notifyRecords: boolean;
  notifyNumberOne: boolean;
  notifyChartClosings: boolean;
  notifyBiggestDebut: boolean;
  notifyAnniversaries: boolean;
  notifyMilestones: boolean;
  lastPeriodWeek: string | null;
  lastPeriodMonth: string | null;
  lastPeriodYear: string | null;
  // disposición de secciones de las vistas de detalle (JSON de DetailLayout;
  // '' = default). una key por tipo de entidad
  detailLayoutArtist: string;
  detailLayoutAlbum: string;
  detailLayoutTrack: string;
  dashboardLayout: string;
}

const SETTINGS_DEFAULTS: SettingsData = {
  rankingMetric: 'time',
  rankChangeLookback: 'disabled',
  weekStart: 'friday',
  // records únicos por entidad (true) vs permitir duplicados en peak week / longest run
  recordsUnique: true,
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
  // rail izquierdo colapsado (solo iconos): off por defecto
  sidebarCollapsed: false,
  // notificaciones push: master switch opt-in (off por defecto), tipos on
  notificationsEnabled: false,
  notifyRecords: true,
  notifyNumberOne: true,
  notifyChartClosings: true,
  notifyBiggestDebut: true,
  notifyAnniversaries: true,
  notifyMilestones: true,
  lastPeriodWeek: null,
  lastPeriodMonth: null,
  lastPeriodYear: null,
  detailLayoutArtist: '',
  detailLayoutAlbum: '',
  detailLayoutTrack: '',
  dashboardLayout: '',
};

let settingsCache: SettingsData = { ...SETTINGS_DEFAULTS };
let settingsLoaded = false;

// Escritura por clave dinámica. Cada clave de SettingsData tiene su propio tipo de
// valor, y loadSettings recorre SETTINGS_DEFAULTS con Object.entries, así que TS no
// puede correlacionar clave y valor en un índice genérico. El ensanchamiento se
// concentra aquí —a `unknown`, no a `any`— en vez de repetirse en cada asignación.
function writeCache(key: keyof SettingsData, value: SettingsData[keyof SettingsData]) {
  (settingsCache as unknown as Record<string, unknown>)[key] = value;
}

const lsKey = (key: string) =>
  key.startsWith('lastPeriod') ? `sis:lastPeriod:${key.slice(10).toLowerCase()}` : `sis:${key}`;

// high-water mark monótono para los marcadores lastPeriod*: gana el mayor
// (null = sin marca). los formatos YYYY / YYYY-MM / YYYY-Www van year-first y
// zero-padded, así que el orden lexicográfico coincide con el cronológico.
function maxMarker(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

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
  // marcadores lastPeriod* que el estado local adelanta al server y hay que
  // sanar (su PUT fire-and-forget pudo abortarse al recargar la página)
  const healPatch: Record<string, string> = {};
  for (const [key, def] of Object.entries(SETTINGS_DEFAULTS)) {
    const raw = data[key];
    if (typeof def === 'boolean') writeCache(key as keyof SettingsData, raw !== undefined ? raw !== 'false' : def);
    else if (def === null) {
      // marcador monótono (lastPeriod*): reconciliamos server vs localStorage
      // con el máximo. así un descarte local reciente no se pierde si su PUT
      // no llegó al server, y a la vez respetamos un descarte de otro
      // dispositivo. si lo local va por delante, sanamos el server.
      const server = raw || null;
      const local = localStorage.getItem(lsKey(key));
      const merged = maxMarker(server, local);
      writeCache(key as keyof SettingsData, merged);
      if (merged !== null && merged !== server) healPatch[key] = merged;
    }
    else writeCache(key as keyof SettingsData, raw || def);
  }

  for (const [key, val] of Object.entries(settingsCache)) {
    if (val !== null) localStorage.setItem(lsKey(key), String(val));
  }
  if (Object.keys(healPatch).length > 0) updateSetting(healPatch);
  settingsLoaded = true;
}

function updateSetting(patch: Partial<Record<string, string>>) {
  // API_BASE, no window.location.origin: en el apk el webview corre en
  // https://localhost y el PUT iría a un origen sin api → el ajuste no persiste
  // en el server (y loadSettings lo revertiría al valor viejo en el siguiente
  // arranque). API_BASE apunta al dominio público (CapacitorHttp mete la cookie).
  fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

function stringSetting<T extends string>(key: keyof SettingsData, defaultValue: T) {
  return [
    (): T => settingsLoaded ? settingsCache[key] as T : (localStorage.getItem(`sis:${key}`) as T) || defaultValue,
    (v: T) => { writeCache(key, v); localStorage.setItem(`sis:${key}`, v); updateSetting({ [key]: v }); },
  ] as const;
}

// defaultValue: valor pre-carga cuando no hay nada en localStorage (true salvo
// override, p.ej. el master switch de notificaciones que arranca en false)
function boolSetting(key: keyof SettingsData, defaultValue = true) {
  return [
    (): boolean => settingsLoaded ? settingsCache[key] as boolean : (localStorage.getItem(`sis:${key}`) ?? String(defaultValue)) !== 'false',
    (v: boolean) => { writeCache(key, v); localStorage.setItem(`sis:${key}`, String(v)); updateSetting({ [key]: String(v) }); },
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
export const [getRecordsUnique, setRecordsUnique] = boolSetting('recordsUnique');
export const [getRawLocale, setLocale] = stringSetting<LocaleSetting>('locale', 'auto');
export const [getAlbumTrackDisplay, setAlbumTrackDisplay] = stringSetting<AlbumTrackDisplay>('albumTrackDisplay', 'fill');
export const [getAlbumShowDuration, setAlbumShowDuration] = boolSetting('albumShowDuration');
export const [getAlbumShowAccolades, setAlbumShowAccolades] = boolSetting('albumShowAccolades');
export const [getArtistShowAlbumAccolades, setArtistShowAlbumAccolades] = boolSetting('artistShowAlbumAccolades');
export const [getArtistShowTrackAccolades, setArtistShowTrackAccolades] = boolSetting('artistShowTrackAccolades');
export const [getSocialVisibility, setSocialVisibility] = stringSetting<SocialVisibility>('socialVisibility', 'visible');

// notificaciones push: master switch (off por defecto) + toggles por tipo
export const [getNotificationsEnabled, setNotificationsEnabled] = boolSetting('notificationsEnabled', false);
export const [getNotifyRecords, setNotifyRecords] = boolSetting('notifyRecords');
export const [getNotifyNumberOne, setNotifyNumberOne] = boolSetting('notifyNumberOne');
export const [getNotifyChartClosings, setNotifyChartClosings] = boolSetting('notifyChartClosings');
export const [getNotifyBiggestDebut, setNotifyBiggestDebut] = boolSetting('notifyBiggestDebut');
export const [getNotifyAnniversaries, setNotifyAnniversaries] = boolSetting('notifyAnniversaries');
export const [getNotifyMilestones, setNotifyMilestones] = boolSetting('notifyMilestones');

export function getLocale(): string {
  const raw = getRawLocale();
  return raw === 'auto' ? navigator.language : raw;
}

const [_getSessionRankDisplay, _setSessionRankDisplay] = stringSetting<SessionRankDisplay>('sessionRankDisplay', 'all+ytd');
const _srd = withNotify<SessionRankDisplay>(_setSessionRankDisplay);
export const getSessionRankDisplay = _getSessionRankDisplay;
export const setSessionRankDisplay = _srd.set;
export const onSessionRankDisplayChange = _srd.onChange;

export const [getSessionRankLimitYear, setSessionRankLimitYear] = stringSetting<string>('sessionRankLimitYear', '50');
export const [getSessionRankLimitAll, setSessionRankLimitAll] = stringSetting<string>('sessionRankLimitAll', '200');

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

// disposición de vistas de detalle: JSON por tipo de entidad. get* reconcilia
// lo guardado contra el registro actual (secciones nuevas aparecen, keys
// retiradas se descartan); set* serializa el DetailLayout ya normalizado.
const DETAIL_LAYOUT_RAW: Record<LayoutKind, readonly [() => string, (v: string) => void]> = {
  artist: stringSetting<string>('detailLayoutArtist', ''),
  album: stringSetting<string>('detailLayoutAlbum', ''),
  track: stringSetting<string>('detailLayoutTrack', ''),
  dashboard: stringSetting<string>('dashboardLayout', ''),
};

export function getDetailLayout(kind: LayoutKind): DetailLayout {
  return resolveLayout(kind, parseLayout(DETAIL_LAYOUT_RAW[kind][0]()));
}

export function setDetailLayout(kind: LayoutKind, layout: DetailLayout): void {
  DETAIL_LAYOUT_RAW[kind][1](JSON.stringify(layout));
}

// rail colapsado: bool con notificación para que el layout reaccione al toggle
const [_getSidebarCollapsed, _setSidebarCollapsed] = boolSetting('sidebarCollapsed', false);
const _sbc = withNotify<boolean>(_setSidebarCollapsed);
export const getSidebarCollapsed = _getSidebarCollapsed;
export const setSidebarCollapsed = _sbc.set;
export const onSidebarCollapsedChange = _sbc.onChange;

const LAST_PERIOD_SETTING_KEY: Record<string, string> = {
  week: 'lastPeriodWeek',
  month: 'lastPeriodMonth',
  year: 'lastPeriodYear',
};

export function setLastPeriod(gran: string, value: string) {
  const settingKey = LAST_PERIOD_SETTING_KEY[gran] as keyof SettingsData;
  writeCache(settingKey, value);
  localStorage.setItem(`sis:lastPeriod:${gran}`, value);
  updateSetting({ [settingKey]: value });
}
