// catálogo de mensajes de notificaciones push (es/en) con diacríticos correctos.
// cada función devuelve {title, body} para un tipo de evento. el locale se elige
// desde user_settings.locale ('en*' => en, resto => es, ya que el dev es español).
import type { RecordEntry, ChartEntry } from '@sis/shared';

export type NotifyLocale = 'es' | 'en';

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

// chart_closing: recap del top-N del chart semanal recién cerrado
export function chartClosingMessage(locale: NotifyLocale, top: ChartEntry[]): NotifyMessage {
  const names = top.map(e => e.name).join(', ');
  if (locale === 'es') {
    return { title: 'Tu semana en música', body: `Top de la semana: ${names}.` };
  }
  return { title: 'Your week in music', body: `This week's top: ${names}.` };
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
    return { title: 'Nuevo hito', body: `Has alcanzado las ${threshold.toLocaleString('es-ES')} reproducciones de ${subject}.` };
  }
  return { title: 'New milestone', body: `You've reached ${threshold.toLocaleString('en-US')} plays of ${subject}.` };
}
