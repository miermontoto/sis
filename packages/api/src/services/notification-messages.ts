// catálogo de mensajes de notificaciones push (es/en) con diacríticos correctos.
// cada función devuelve {title, body} para un tipo de evento. el locale se elige
// desde user_settings.locale ('en*' => en, resto => es, ya que el dev es español).
import type { RecordEntry, ChartEntry, Granularity, ReportResponse } from '@sis/shared';

export type NotifyLocale = 'es' | 'en';

// etiqueta BCP 47 con la que se formatean cifras y nombres de mes de cada locale
const LOCALE_TAGS: Record<NotifyLocale, string> = { es: 'es-ES', en: 'en-US' };

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export interface NotifyMessage {
  title: string;
  body: string;
}

// resuelve el locale efectivo desde el valor crudo de user_settings.locale
// ('auto', 'es', 'en-US', ...). solo 'en*' mapea a inglés; el resto a español.
export function resolveLocale(raw: string | null | undefined): NotifyLocale {
  return (raw ?? '').toLowerCase().startsWith('en') ? 'en' : 'es';
}

// etiqueta legible por locale de cada categoría de record vigilada (RECORD_NOTIFY_CATEGORIES)
const RECORD_CATEGORY_LABELS: Record<string, Record<NotifyLocale, string>> = {
  peakWeekPlays: { es: 'mejor semana', en: 'peak week plays' },
  mostWeeksAtNo1: { es: 'semanas en el número 1', en: 'weeks at #1' },
  longestChartRun: { es: 'permanencia en el chart', en: 'chart longevity' },
};

// añade la autoría (" de X" / " by X") cuando la entidad tiene artista (tracks/álbumes);
// para artistas artistName es null y se devuelve solo el nombre
function withArtist(name: string, artistName: string | null, locale: NotifyLocale): string {
  if (!artistName) return name;
  return locale === 'es' ? `${name} de ${artistName}` : `${name} by ${artistName}`;
}

// record: la entidad entra por primera vez al top de una categoría de records
export function recordMessage(locale: NotifyLocale, entry: RecordEntry, category: string): NotifyMessage {
  const label = RECORD_CATEGORY_LABELS[category]?.[locale] ?? category;
  const subject = withArtist(entry.name, entry.artistName, locale);
  if (locale === 'es') {
    return { title: 'Nuevo récord', body: `${subject} ha entrado en tus récords de ${label}.` };
  }
  return { title: 'New record', body: `${subject} just joined your ${label} records.` };
}

// number_one: nuevo número 1 del chart semanal recién cerrado
export function numberOneMessage(locale: NotifyLocale, entry: ChartEntry): NotifyMessage {
  const subject = withArtist(entry.name, entry.artistName, locale);
  if (locale === 'es') {
    return { title: 'Nuevo número 1', body: `${subject} es tu número 1 de la semana.` };
  }
  return { title: 'New #1', body: `${subject} is your #1 this week.` };
}

// tiempo de escucha legible: "18h 20m" / "18 h 20 min" (las horas con separador de miles,
// que un año pasa de mil)
function formatListening(ms: number, locale: NotifyLocale): string {
  const minutes = Math.round(ms / MS_PER_MINUTE);
  const h = Math.floor(minutes / MINUTES_PER_HOUR).toLocaleString(LOCALE_TAGS[locale]);
  const m = minutes % MINUTES_PER_HOUR;
  return locale === 'es' ? `${h} h ${m} min` : `${h}h ${m}m`;
}

// de qué periodo habla el título: "semana", "septiembre", "2025"
function periodSubject(locale: NotifyLocale, granularity: Granularity, period: string): string {
  if (granularity === 'week') return locale === 'es' ? 'semana' : 'week';
  if (granularity === 'year') return period;
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: 'long', timeZone: 'UTC' }).format(new Date(`${period}-01T00:00:00Z`));
}

// report_ready: el report de una semana / mes / año recién cerrado, con su tiempo total y
// sus nº 1 de artista y tema (el orden es la métrica del usuario, igual que en el report)
export function reportReadyMessage(locale: NotifyLocale, granularity: Granularity, period: string, report: ReportResponse): NotifyMessage {
  const { plays, totalMs } = report.summary;
  const subject = periodSubject(locale, granularity, period);
  const time = formatListening(totalMs, locale);
  const count = plays.toLocaleString(LOCALE_TAGS[locale]);
  const artist = report.top.artists[0]?.artist?.name;
  const track = report.top.tracks[0]?.track;
  const trackName = track ? withArtist(track.name, track.artists[0]?.name ?? null, locale) : null;
  if (locale === 'es') {
    return {
      title: `Tu ${subject} en música`,
      body: [
        `${time} en ${count} ${plays === 1 ? 'reproducción' : 'reproducciones'}.`,
        artist && `Artista número 1: ${artist}.`,
        trackName && `Tema número 1: ${trackName}.`,
      ].filter(Boolean).join(' '),
    };
  }
  return {
    title: `Your ${subject} in music`,
    body: [
      `${time} across ${count} ${plays === 1 ? 'play' : 'plays'}.`,
      artist && `#1 artist: ${artist}.`,
      trackName && `#1 track: ${trackName}.`,
    ].filter(Boolean).join(' '),
  };
}

// playlist_regenerated: una playlist generada se auto-regeneró en segundo plano
export function playlistRegeneratedMessage(locale: NotifyLocale, name: string, trackCount: number): NotifyMessage {
  if (locale === 'es') {
    return { title: 'Playlist actualizada', body: `Se regeneró «${name}» con ${trackCount} temas.` };
  }
  return { title: 'Playlist refreshed', body: `"${name}" was refreshed with ${trackCount} tracks.` };
}

// release_anniversary: un álbum/single escuchado cumple años desde su publicación
export function releaseAnniversaryMessage(locale: NotifyLocale, name: string, artistName: string | null, years: number): NotifyMessage {
  const subject = withArtist(name, artistName, locale);
  if (locale === 'es') {
    return { title: 'Aniversario', body: `${subject} cumple hoy ${years} ${years === 1 ? 'año' : 'años'}.` };
  }
  return { title: 'Anniversary', body: `${subject} turns ${years} today.` };
}

// first_listen_anniversary: aniversario de la primera escucha de un artista
export function firstListenAnniversaryMessage(locale: NotifyLocale, name: string, years: number): NotifyMessage {
  if (locale === 'es') {
    return { title: 'Aniversario de escucha', body: years === 1 ? `Hace 1 año que escuchaste a ${name} por primera vez.` : `Hace ${years} años que escuchaste a ${name} por primera vez.` };
  }
  return { title: 'Listening anniversary', body: years === 1 ? `1 year since you first listened to ${name}.` : `${years} years since you first listened to ${name}.` };
}

// milestone: una entidad cruza un umbral de reproducciones
export function milestoneMessage(locale: NotifyLocale, name: string, artistName: string | null, threshold: number): NotifyMessage {
  const subject = withArtist(name, artistName, locale);
  if (locale === 'es') {
    return { title: 'Nuevo hito', body: `Has alcanzado las ${threshold.toLocaleString(LOCALE_TAGS.es)} reproducciones de ${subject}.` };
  }
  return { title: 'New milestone', body: `You've reached ${threshold.toLocaleString(LOCALE_TAGS.en)} plays of ${subject}.` };
}
