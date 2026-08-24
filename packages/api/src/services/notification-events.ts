// detección de eventos de notificación push.
// tres puntos de enganche producen los tipos de evento (NotificationType):
//  - emitRecordEvents: diff de la cache de records -> 'record'
//  - checkChartClosings: cierre de semana time-driven -> 'chart_closing' | 'number_one'
//  - checkDailyEvents: cambio de día time-driven -> 'release_anniversary' | 'first_listen_anniversary' | 'milestone'
// el envío real (sendPush) es credential-gated y fire-and-forget: nunca bloquea
// ni lanza hacia el polling / recomputo de cache.
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { getChart } from '../db/queries/index.js';
import { periodExpr, userFilter, entityGroupCol, resolvedPlayJoins, resolvedEntityId, entityMergeJoin, albumNullFilter } from '../db/queries/helpers.js';
import type { Db, EntityType } from '../db/queries/index.js';
import { fetchEntityMetadata } from '../db/queries/charts.js';
import { userSettings } from '../db/schema.js';
import { sendPush, hasDeliverableChannel } from './push-dispatch.js';
import {
  RECORDS_LIMIT,
  RECORD_NOTIFY_CATEGORIES,
  NOTIFICATION_MAX_PER_DAY,
  NOTIFY_CHART_TOP_N,
  ANNIVERSARY_MIN_PLAYS,
  MILESTONE_THRESHOLDS,
} from '../constants.js';
import {
  resolveLocale,
  recordMessage,
  numberOneMessage,
  chartClosingMessage,
  playlistRegeneratedMessage,
  releaseAnniversaryMessage,
  firstListenAnniversaryMessage,
  milestoneMessage,
} from './notification-messages.js';
import type { NotifyLocale } from './notification-messages.js';
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
const EVENT_PLAYLIST_REGENERATED: NotificationType = 'playlist_regenerated';
const EVENT_RELEASE_ANNIVERSARY: NotificationType = 'release_anniversary';
const EVENT_FIRST_LISTEN_ANNIVERSARY: NotificationType = 'first_listen_anniversary';
const EVENT_MILESTONE: NotificationType = 'milestone';

// tipos potencialmente frecuentes que comparten el presupuesto diario
// NOTIFICATION_MAX_PER_DAY (los eventos de cierre de semana quedan exentos)
const THROTTLED_TYPES: readonly NotificationType[] = [
  EVENT_RECORD,
  EVENT_RELEASE_ANNIVERSARY,
  EVENT_FIRST_LISTEN_ANNIVERSARY,
  EVENT_MILESTONE,
];

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
const PREF_ANNIVERSARIES = 'notifyAnniversaries';
const PREF_MILESTONES = 'notifyMilestones';
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
//  2. throttle diario compartido para THROTTLED_TYPES (los eventos de cierre de semana lo saltan)
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

  // 2. throttle diario compartido entre los tipos frecuentes (records, aniversarios,
  //    milestones); los eventos de cierre de semana —number_one/chart_closing— son
  //    poco frecuentes y lo saltan. el conteo se limita a filas de THROTTLED_TYPES
  //    para no mezclar con los tipos exentos.
  if (THROTTLED_TYPES.includes(type)) {
    const typeList = sql.join(THROTTLED_TYPES.map(t => sql`${t}`), sql`, `);
    const row = db.all(sql`
      SELECT COUNT(*) as n FROM sent_notifications
      WHERE user_id = ${userId}
        AND notification_type IN (${typeList})
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

// --- B) cierre de semana time-driven -> chart_closing / number_one ---

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

  // top-N que muestra el recap. sirve además para deduplicar: number_one se omite
  // cuando el recap se envía y su entidad ya aparece aquí, porque entonces el recap
  // ya la cubre (evita notificaciones redundantes a la vez).
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

// --- C) eventos diarios time-driven -> release_anniversary / first_listen_anniversary / milestone ---

// granularidad del estado diario en notification_period_state
const GRANULARITY_DAY = 'day';
// tipos de entidad que se escanean para milestones
const MILESTONE_ENTITY_TYPES: readonly EntityType[] = ['artist', 'album', 'track'];

// fecha UTC 'YYYY-MM-DD' actual (mismo reloj que datetime('now') en SQLite)
function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// aniversarios de publicación: álbumes/singles con release_date completo cuyo MM-DD
// es hoy, con al menos un año de antigüedad y ANNIVERSARY_MIN_PLAYS plays del usuario
function emitReleaseAnniversaries(db: Db, userId: number, locale: NotifyLocale, today: string): void {
  const year = parseInt(today.slice(0, 4), 10);
  const mmdd = today.slice(5);
  const uf = userFilter(userId);

  const rows = db.all(sql`
    WITH album_plays AS (
      SELECT ${entityGroupCol('album', userId)} as eid, count(*) as plays
      FROM listening_history lh
      ${resolvedPlayJoins('album', userId)}
      WHERE 1=1 ${uf} ${albumNullFilter('album')}
      GROUP BY eid
    )
    SELECT ap.eid as id, al.release_date as releaseDate, ap.plays as plays
    FROM album_plays ap
    JOIN albums al ON al.spotify_id = ap.eid
    WHERE ap.plays >= ${ANNIVERSARY_MIN_PLAYS}
      AND length(al.release_date) = 10
      AND substr(al.release_date, 6) = ${mmdd}
      AND CAST(substr(al.release_date, 1, 4) AS INTEGER) < ${year}
    ORDER BY ap.plays DESC
  `) as { id: string; releaseDate: string; plays: number }[];
  if (rows.length === 0) return;

  const metaMap = fetchEntityMetadata(db, 'album', rows.map(r => r.id));
  for (const row of rows) {
    const meta = metaMap.get(row.id);
    if (!meta) continue;
    const years = year - parseInt(row.releaseDate.slice(0, 4), 10);
    const msg = releaseAnniversaryMessage(locale, meta.name, meta.artistName, years);
    const payload: PushPayload = {
      title: msg.title,
      body: msg.body,
      data: {
        type: EVENT_RELEASE_ANNIVERSARY,
        entityType: 'album',
        entityId: row.id,
        period: String(year),
        route: entityRoute('album', row.id),
      },
    };
    // dedup period = año en curso: un aniversario por álbum y año
    dispatchEvent(userId, EVENT_RELEASE_ANNIVERSARY, row.id, String(year), null, payload);
  }
}

// aniversarios de primera escucha: artistas cuya primera play (merges resueltos)
// fue tal día como hoy hace >= 1 año, con un mínimo de plays acumuladas
function emitFirstListenAnniversaries(db: Db, userId: number, locale: NotifyLocale, today: string): void {
  const year = parseInt(today.slice(0, 4), 10);
  const mmdd = today.slice(5);

  const rows = db.all(sql`
    WITH plays_dedup AS (
      SELECT DISTINCT ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, lh.played_at as played_at
      FROM listening_history lh
      JOIN track_artists ta ON ta.track_id = lh.track_id
      ${entityMergeJoin('artist', userId)}
      WHERE lh.user_id = ${userId}
    )
    SELECT eid as id, min(played_at) as firstPlayed, count(*) as plays
    FROM plays_dedup
    GROUP BY eid
    HAVING plays >= ${ANNIVERSARY_MIN_PLAYS}
      AND substr(min(played_at), 6, 5) = ${mmdd}
      AND CAST(substr(min(played_at), 1, 4) AS INTEGER) < ${year}
    ORDER BY plays DESC
  `) as { id: string; firstPlayed: string; plays: number }[];
  if (rows.length === 0) return;

  const metaMap = fetchEntityMetadata(db, 'artist', rows.map(r => r.id));
  for (const row of rows) {
    const meta = metaMap.get(row.id);
    if (!meta) continue;
    const years = year - parseInt(row.firstPlayed.slice(0, 4), 10);
    const msg = firstListenAnniversaryMessage(locale, meta.name, years);
    const payload: PushPayload = {
      title: msg.title,
      body: msg.body,
      data: {
        type: EVENT_FIRST_LISTEN_ANNIVERSARY,
        entityType: 'artist',
        entityId: row.id,
        period: String(year),
        route: entityRoute('artist', row.id),
      },
    };
    dispatchEvent(userId, EVENT_FIRST_LISTEN_ANNIVERSARY, row.id, String(year), null, payload);
  }
}

// milestones de reproducciones: entidades cuyo total cruzó un umbral de la escalera
// entre el último check (cutoff) y ahora. comparar contra el cutoff hace la detección
// agnóstica a la fuente (spotify, last.fm, scrobbles manuales) y robusta a imports:
// los plays históricos entran en ambos conteos y no producen cruce.
function emitMilestones(db: Db, userId: number, locale: NotifyLocale, cutoff: string): void {
  const minThreshold = MILESTONE_THRESHOLDS[0];
  const uf = userFilter(userId);

  type MilestoneRow = { eid: string; playsNow: number; playsBefore: number };
  const crossings: { entityType: EntityType; id: string; threshold: number }[] = [];

  for (const entityType of MILESTONE_ENTITY_TYPES) {
    let rows: MilestoneRow[];
    if (entityType === 'artist') {
      rows = db.all(sql`
        WITH plays_dedup AS (
          SELECT DISTINCT ${resolvedEntityId('artist', userId)} as eid, lh.id as play_id, lh.played_at as played_at
          FROM listening_history lh
          JOIN track_artists ta ON ta.track_id = lh.track_id
          ${entityMergeJoin('artist', userId)}
          WHERE lh.user_id = ${userId}
        )
        SELECT eid, count(*) as playsNow,
               sum(CASE WHEN played_at < ${cutoff} THEN 1 ELSE 0 END) as playsBefore
        FROM plays_dedup
        GROUP BY eid
        HAVING playsNow >= ${minThreshold} AND playsBefore < playsNow
      `) as MilestoneRow[];
    } else {
      // alias 'eid' (no 'id'): un alias 'id' sería ambiguo con lh.id en el GROUP BY
      rows = db.all(sql`
        SELECT ${entityGroupCol(entityType, userId)} as eid, count(*) as playsNow,
               sum(CASE WHEN lh.played_at < ${cutoff} THEN 1 ELSE 0 END) as playsBefore
        FROM listening_history lh
        ${resolvedPlayJoins(entityType, userId)}
        WHERE 1=1 ${uf} ${albumNullFilter(entityType)}
        GROUP BY eid
        HAVING playsNow >= ${minThreshold} AND playsBefore < playsNow
      `) as MilestoneRow[];
    }

    for (const row of rows) {
      // el umbral más alto cruzado en la ventana; los inferiores quedan cubiertos
      const threshold = [...MILESTONE_THRESHOLDS].reverse().find(t => row.playsBefore < t && t <= row.playsNow);
      if (threshold) crossings.push({ entityType, id: row.eid, threshold });
    }
  }
  if (crossings.length === 0) return;

  // los hitos más altos primero: si el throttle diario corta, que sobrevivan los grandes
  crossings.sort((a, b) => b.threshold - a.threshold);

  const metaByType = new Map<EntityType, ReturnType<typeof fetchEntityMetadata>>();
  for (const entityType of MILESTONE_ENTITY_TYPES) {
    const ids = crossings.filter(c => c.entityType === entityType).map(c => c.id);
    if (ids.length > 0) metaByType.set(entityType, fetchEntityMetadata(db, entityType, ids));
  }

  for (const { entityType, id, threshold } of crossings) {
    const meta = metaByType.get(entityType)?.get(id);
    if (!meta) continue;
    const msg = milestoneMessage(locale, meta.name, meta.artistName, threshold);
    const payload: PushPayload = {
      title: msg.title,
      body: msg.body,
      data: {
        type: EVENT_MILESTONE,
        entityType,
        entityId: id,
        period: String(threshold),
        route: entityRoute(entityType, id),
      },
    };
    // dedup period = umbral: cada hito de una entidad se notifica una sola vez
    dispatchEvent(userId, EVENT_MILESTONE, id, String(threshold), null, payload);
  }
}

// comprueba una vez al día (time-driven) aniversarios y milestones. mismo patrón que
// checkChartClosings: notification_period_state (granularity 'day') detecta el cambio
// de día; la primera vez inicializa sin disparar (backfill-safe). debe llamarse en
// cada ciclo de polling aunque no haya datos nuevos.
export function checkDailyEvents(userId: number, spotifyId: string): void {
  const db = getDb();
  const settings = getUserSettingsMap(db, spotifyId);

  if (!boolPref(settings, PREF_ENABLED, false)) return;

  // sin canal entregable no se avanza el estado: el día pendiente se procesa
  // cuando existan dispositivo + credenciales (los dedup por año/umbral evitan spam)
  if (!hasDeliverableChannel(userId)) return;

  const today = currentUtcDate();
  const stored = db.all(sql`
    SELECT last_period as p FROM notification_period_state
    WHERE user_id = ${userId} AND granularity = ${GRANULARITY_DAY}
  `)[0] as { p: string } | undefined;

  // primera vez: inicializar sin disparar (evita firing en primer arranque / backfill)
  if (!stored) {
    db.run(sql`
      INSERT OR IGNORE INTO notification_period_state (user_id, granularity, last_period)
      VALUES (${userId}, ${GRANULARITY_DAY}, ${today})
    `);
    return;
  }

  // sin cambio de día: nada que comprobar
  if (stored.p === today) return;

  const locale = resolveLocale(settings.get(PREF_LOCALE));

  if (boolPref(settings, PREF_ANNIVERSARIES, true)) {
    emitReleaseAnniversaries(db, userId, locale, today);
    emitFirstListenAnniversaries(db, userId, locale, today);
  }

  // cutoff = último día procesado: cubre huecos si la app estuvo caída varios días
  if (boolPref(settings, PREF_MILESTONES, true)) {
    emitMilestones(db, userId, locale, stored.p);
  }

  db.run(sql`
    UPDATE notification_period_state SET last_period = ${today}
    WHERE user_id = ${userId} AND granularity = ${GRANULARITY_DAY}
  `);
}

// --- D) auto-regeneración de playlist -> 'playlist_regenerated' ---

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
