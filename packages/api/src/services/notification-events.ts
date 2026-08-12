// detección de eventos de notificación push (fase 1: granularidad WEEK).
// dos puntos de enganche producen los 4 tipos de evento (NotificationType):
//  - emitRecordEvents: diff de la cache de records -> 'record'
//  - checkChartClosings: cierre de semana time-driven -> 'chart_closing' | 'number_one' | 'biggest_debut'
// el envío real (sendPush) es credential-gated y fire-and-forget: nunca bloquea
// ni lanza hacia el polling / recomputo de cache.
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { getChart } from '../db/queries/index.js';
import { periodExpr } from '../db/queries/helpers.js';
import type { Db } from '../db/queries/index.js';
import { userSettings } from '../db/schema.js';
import { sendPush, hasDeliverableChannel } from './push-dispatch.js';
import {
  RECORDS_LIMIT,
  RECORD_NOTIFY_CATEGORIES,
  NOTIFICATION_MAX_PER_DAY,
  NOTIFY_CHART_TOP_N,
} from '../constants.js';
import {
  resolveLocale,
  recordMessage,
  numberOneMessage,
  chartClosingMessage,
  biggestDebutMessage,
  playlistRegeneratedMessage,
} from './notification-messages.js';
import type {
  NotificationType,
  PushPayload,
  RecordsResponse,
  EntityRecords,
  RecordEntry,
  WeekStartOption,
  RankingMetric,
} from '@sis/shared';
import { createLogger } from './logger.js';

const log = createLogger('notify');

// --- constantes locales (sin magic strings) ---

const GRANULARITY_WEEK = 'week' as const;
// el chart-closing de fase 1 opera solo sobre tracks
const CHART_ENTITY_TYPE = 'track' as const;
// prefijo del campo dedup `period` para eventos de cierre de semana ('week:2026-W25')
const PERIOD_PREFIX_WEEK = 'week:';
// entity_id vacío (NOT NULL) para eventos sin entidad (chart_closing); el UNIQUE dedup
const EMPTY_ENTITY = '';
// weekStart por defecto (coincide con DEFAULTS de routes/settings.ts)
const DEFAULT_WEEK_START: WeekStartOption = 'friday';
// ruta de deep link para el recap del chart
const CHARTS_ROUTE = '/charts';
// ventana de throttle: 24h para datetime('now', ...)
const THROTTLE_WINDOW = '-1 day';

// tipos de evento (literales de NotificationType)
const EVENT_RECORD: NotificationType = 'record';
const EVENT_NUMBER_ONE: NotificationType = 'number_one';
const EVENT_CHART_CLOSING: NotificationType = 'chart_closing';
const EVENT_BIGGEST_DEBUT: NotificationType = 'biggest_debut';
const EVENT_PLAYLIST_REGENERATED: NotificationType = 'playlist_regenerated';

// ruta de deep link a la vista de playlists (destino al abrir la notificación)
const PLAYLISTS_ROUTE = '/playlists';

// mapeo tipo-plural (clave de RecordsResponse) -> tipo-singular (entityType del payload/ruta)
const ENTITY_TYPE_MAP: readonly [keyof RecordsResponse, string][] = [
  ['tracks', 'track'],
  ['albums', 'album'],
  ['artists', 'artist'],
];

// --- preferencias (leídas de user_settings por spotifyId string) ---

const PREF_ENABLED = 'notificationsEnabled';
const PREF_RECORDS = 'notifyRecords';
const PREF_NUMBER_ONE = 'notifyNumberOne';
const PREF_CHART_CLOSINGS = 'notifyChartClosings';
const PREF_BIGGEST_DEBUT = 'notifyBiggestDebut';
const PREF_LOCALE = 'locale';
const PREF_WEEK_START = 'weekStart';
const PREF_RANKING_METRIC = 'rankingMetric';
const PREF_TRUE = 'true';

function getUserSettingsMap(db: Db, spotifyId: string): Map<string, string> {
  const rows = db.select().from(userSettings).where(eq(userSettings.userId, spotifyId)).all();
  return new Map(rows.map(r => [r.key, r.value]));
}

// lee una preferencia booleana con default (clave ausente -> default)
function boolPref(settings: Map<string, string>, key: string, def: boolean): boolean {
  const v = settings.get(key);
  return v === undefined ? def : v === PREF_TRUE;
}

// ruta de deep link a una entidad ( /track/:id, /album/:id, /artist/:id )
function entityRoute(entityType: string, entityId: string): string {
  return `/${entityType}/${entityId}`;
}

// --- despacho: gating de tokens + throttle + dedup + envío ---

// intenta despachar un evento. aplica, en orden:
//  1. si no hay dispositivos activos -> no hace nada (no registra, para que pueda
//     dispararse cuando exista un dispositivo)
//  2. throttle diario solo para 'record'/'number_one' (chart_closing/biggest_debut lo saltan)
//  3. dedup vía INSERT OR IGNORE: si no insertó fila, ya se envió -> skip
//  4. sendPush fire-and-forget (queueMicrotask): nunca bloquea al llamante
function dispatchEvent(
  userId: number,
  type: NotificationType,
  entityId: string,
  period: string,
  rank: number | null,
  payload: PushPayload,
): void {
  const db = getDb();

  // 1. sin canal entregable (sin dispositivo activo o sin credenciales del canal):
  //    nada que enviar y NO registramos el dedup, para que el evento se dispare cuando
  //    existan dispositivo + credenciales (evita "consumir" eventos sin entrega real)
  if (!hasDeliverableChannel(userId)) return;

  // 2. throttle diario: solo 'record' (los eventos de cierre de semana
  //    —number_one/chart_closing/biggest_debut— son poco frecuentes y lo saltan).
  //    el conteo se limita a filas 'record' para no mezclar con los tipos exentos.
  if (type === EVENT_RECORD) {
    const row = db.all(sql`
      SELECT COUNT(*) as n FROM sent_notifications
      WHERE user_id = ${userId}
        AND notification_type = ${EVENT_RECORD}
        AND sent_at >= datetime('now', ${THROTTLE_WINDOW})
    `)[0] as { n: number };
    if (row.n >= NOTIFICATION_MAX_PER_DAY) return;
  }

  // 3. dedup: el UNIQUE(user_id, notification_type, entity_id, period) evita reenvíos.
  //    changes !== 1 => la fila ya existía => ya se envió
  const res = db.run(sql`
    INSERT OR IGNORE INTO sent_notifications (user_id, notification_type, entity_id, period, rank)
    VALUES (${userId}, ${type}, ${entityId}, ${period}, ${rank})
  `);
  if (res.changes !== 1) return;

  // 4. envío desacoplado del hilo del polling / recomputo de cache
  queueMicrotask(() => {
    void sendPush(userId, payload).catch(err => log.error('error en sendPush:', err));
  });
}

// --- A) diff de la cache de records -> 'record' ---

// compara prev vs next RecordsResponse: por cada tipo de entidad y categoría vigilada,
// un entityId presente en el top-N de next pero ausente en el de prev dispara un 'record'.
// el campo dedup `period` es la clave de la categoría (una vez por entidad+categoría).
export function emitRecordEvents(userId: number, spotifyId: string, prev: RecordsResponse, next: RecordsResponse): void {
  const db = getDb();
  const settings = getUserSettingsMap(db, spotifyId);

  // gating: master switch + preferencia por tipo
  if (!boolPref(settings, PREF_ENABLED, false)) return;
  if (!boolPref(settings, PREF_RECORDS, true)) return;

  const locale = resolveLocale(settings.get(PREF_LOCALE));

  for (const [plural, entityType] of ENTITY_TYPE_MAP) {
    const prevEnt = prev[plural] as EntityRecords | undefined;
    const nextEnt = next[plural] as EntityRecords | undefined;
    if (!prevEnt || !nextEnt) continue;

    for (const category of RECORD_NOTIFY_CATEGORIES) {
      const prevList = ((prevEnt[category] as RecordEntry[]) ?? []).slice(0, RECORDS_LIMIT);
      const nextList = ((nextEnt[category] as RecordEntry[]) ?? []).slice(0, RECORDS_LIMIT);
      const prevIds = new Set(prevList.map(e => e.entityId));

      nextList.forEach((entry, idx) => {
        if (prevIds.has(entry.entityId)) return; // ya estaba en el top -> no es entrada nueva

        const msg = recordMessage(locale, entry, category);
        const payload: PushPayload = {
          title: msg.title,
          body: msg.body,
          data: {
            type: EVENT_RECORD,
            entityType,
            entityId: entry.entityId,
            period: category,
            route: entityRoute(entityType, entry.entityId),
          },
        };
        // dedup period = clave de la categoría; rank = posición en el ranking de records
        dispatchEvent(userId, EVENT_RECORD, entry.entityId, category, idx + 1, payload);
      });
    }
  }
}

// --- B) cierre de semana time-driven -> chart_closing / number_one / biggest_debut ---

// etiqueta de la semana actual reutilizando periodExpr() EXACTO: una subquery aliasada
// 'lh' con played_at = datetime('now') hace que el mismo strftime weekStart-aware
// produzca la etiqueta de la semana en curso (mismo formato que el chart real).
function currentWeekLabel(db: Db, weekStart: WeekStartOption): string | null {
  const pExpr = periodExpr(GRANULARITY_WEEK, weekStart);
  const row = db.all(sql`
    SELECT ${pExpr} as period FROM (SELECT datetime('now') as played_at) lh
  `)[0] as { period: string } | undefined;
  return row?.period ?? null;
}

// construye los eventos del chart final de la semana recién cerrada
function emitChartClosing(
  userId: number,
  settings: Map<string, string>,
  weekStart: WeekStartOption,
  sort: RankingMetric,
  closedLabel: string,
): void {
  const db = getDb();
  const locale = resolveLocale(settings.get(PREF_LOCALE));

  // chart final de la semana cerrada (tracks, orden del usuario). entries vienen
  // ordenadas por rank ascendente.
  const chart = getChart(db, CHART_ENTITY_TYPE, GRANULARITY_WEEK, weekStart, closedLabel, sort, userId);
  const entries = chart.entries;
  if (entries.length === 0) return;

  const period = PERIOD_PREFIX_WEEK + closedLabel;

  // top-N que muestra el recap. sirve además para deduplicar: number_one y
  // biggest_debut se omiten cuando el recap se envía y su entidad ya aparece aquí,
  // porque entonces el recap ya la cubre (evita notificaciones redundantes a la vez).
  const recapEnabled = boolPref(settings, PREF_CHART_CLOSINGS, true);
  const top = entries.slice(0, NOTIFY_CHART_TOP_N);
  const topIds = new Set(top.map(e => e.entityId));

  // chart_closing: recap del top-N (bypassa throttle)
  if (recapEnabled) {
    const msg = chartClosingMessage(locale, top);
    const payload: PushPayload = {
      title: msg.title,
      body: msg.body,
      data: { type: EVENT_CHART_CLOSING, period, route: CHARTS_ROUTE },
    };
    dispatchEvent(userId, EVENT_CHART_CLOSING, EMPTY_ENTITY, period, null, payload);
  }

  // number_one: la entrada rank 1 que no era #1 la semana anterior (nuevo líder).
  // se omite cuando el recap se envía: el #1 siempre encabeza su top-N, así que
  // "nuevo número 1" sería redundante con el recap que ya lo muestra primero.
  if (boolPref(settings, PREF_NUMBER_ONE, true)) {
    const top1 = entries.find(e => e.rank === 1);
    if (top1 && top1.previousRank !== 1 && !(recapEnabled && topIds.has(top1.entityId))) {
      const msg = numberOneMessage(locale, top1);
      const payload: PushPayload = {
        title: msg.title,
        body: msg.body,
        data: {
          type: EVENT_NUMBER_ONE,
          entityType: CHART_ENTITY_TYPE,
          entityId: top1.entityId,
          period,
          route: entityRoute(CHART_ENTITY_TYPE, top1.entityId),
        },
      };
      dispatchEvent(userId, EVENT_NUMBER_ONE, top1.entityId, period, top1.rank, payload);
    }
  }

  // biggest_debut: la entrada isNew mejor rankeada (entries ya vienen en orden de rank).
  // se omite solo si el recap se envía Y el debut ya aparece en su top-N (entonces el
  // recap lo cubre); si el debut cae fuera del top-N mostrado, sigue siendo info nueva.
  if (boolPref(settings, PREF_BIGGEST_DEBUT, true)) {
    const debut = entries.find(e => e.isNew);
    if (debut && !(recapEnabled && topIds.has(debut.entityId))) {
      const msg = biggestDebutMessage(locale, debut);
      const payload: PushPayload = {
        title: msg.title,
        body: msg.body,
        data: {
          type: EVENT_BIGGEST_DEBUT,
          entityType: CHART_ENTITY_TYPE,
          entityId: debut.entityId,
          period,
          route: entityRoute(CHART_ENTITY_TYPE, debut.entityId),
        },
      };
      dispatchEvent(userId, EVENT_BIGGEST_DEBUT, debut.entityId, period, debut.rank, payload);
    }
  }
}

// comprueba si la semana ha cambiado desde el último tick y, en tal caso, dispara los
// eventos de cierre de la semana previa. es time-driven: debe llamarse en cada ciclo de
// polling AUNQUE no haya datos nuevos.
export function checkChartClosings(userId: number, spotifyId: string): void {
  const db = getDb();
  const settings = getUserSettingsMap(db, spotifyId);

  // el master switch gobierna toda la detección time-driven
  if (!boolPref(settings, PREF_ENABLED, false)) return;

  // sin canal entregable (sin dispositivo activo o sin credenciales) no tocamos
  // notification_period_state: un instante transitorio no debe avanzar/consumir la semana
  // cerrada (recomputable luego vía getChart), de modo que el cierre se reintente cuando
  // existan dispositivo + credenciales.
  if (!hasDeliverableChannel(userId)) return;

  const weekStart = (settings.get(PREF_WEEK_START) as WeekStartOption) || DEFAULT_WEEK_START;
  const sort: RankingMetric = settings.get(PREF_RANKING_METRIC) === 'plays' ? 'plays' : 'time';

  const current = currentWeekLabel(db, weekStart);
  if (!current) return;

  const stored = db.all(sql`
    SELECT last_period as p FROM notification_period_state
    WHERE user_id = ${userId} AND granularity = ${GRANULARITY_WEEK}
  `)[0] as { p: string } | undefined;

  // primera vez: inicializar sin disparar (evita firing en primer arranque / backfill)
  if (!stored) {
    db.run(sql`
      INSERT OR IGNORE INTO notification_period_state (user_id, granularity, last_period)
      VALUES (${userId}, ${GRANULARITY_WEEK}, ${current})
    `);
    return;
  }

  // sin cambio de semana: nada que cerrar
  if (stored.p === current) return;

  // la semana recién cerrada = la almacenada. si se saltaron varias (app caída), solo
  // dispara la inmediatamente anterior y salta a la actual.
  emitChartClosing(userId, settings, weekStart, sort, stored.p);

  // persistir la semana actual (avanza aunque se hayan saltado semanas)
  db.run(sql`
    UPDATE notification_period_state SET last_period = ${current}
    WHERE user_id = ${userId} AND granularity = ${GRANULARITY_WEEK}
  `);
}

// --- C) auto-regeneración de playlist -> 'playlist_regenerated' ---

// notifica que una playlist generada se auto-regeneró en segundo plano. gated por
// el master switch de notificaciones + canal entregable; fire-and-forget (nunca
// lanza hacia el scheduler). sin dedup en sent_notifications: la frecuencia ya la
// limita el propio intervalo de regeneración (last_regenerated_at).
export function notifyPlaylistRegenerated(userId: number, spotifyId: string, name: string, trackCount: number): void {
  const db = getDb();
  const settings = getUserSettingsMap(db, spotifyId);

  if (!boolPref(settings, PREF_ENABLED, false)) return;
  if (!hasDeliverableChannel(userId)) return;

  const locale = resolveLocale(settings.get(PREF_LOCALE));
  const msg = playlistRegeneratedMessage(locale, name, trackCount);
  const payload: PushPayload = {
    title: msg.title,
    body: msg.body,
    data: { type: EVENT_PLAYLIST_REGENERATED, route: PLAYLISTS_ROUTE },
  };

  queueMicrotask(() => {
    void sendPush(userId, payload).catch(err => log.error('error en sendPush:', err));
  });
}
