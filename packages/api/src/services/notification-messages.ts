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

// biggest_debut: mejor debut (isNew) del chart semanal recién cerrado
export function biggestDebutMessage(locale: NotifyLocale, entry: ChartEntry): NotifyMessage {
  const subject = withArtist(entry.name, entry.artistName, locale);
  if (locale === 'es') {
    return { title: 'Debut de la semana', body: `${subject} debuta en el puesto nº ${entry.rank}.` };
  }
  return { title: 'Debut of the week', body: `${subject} debuts at #${entry.rank}.` };
}
