import { existsSync, readFileSync } from 'node:fs';
import type { PushPayload } from '@sis/shared';
import { listActiveTokens, invalidateToken } from './device-token-manager.js';

// ─── despacho de push (FCM android/ios + web push VAPID) ───────────────────
//
// credential-gated: si faltan las env vars de firebase o VAPID, el canal
// correspondiente queda deshabilitado (no-op + un único warn), NUNCA lanza.
// firebase-admin y web-push se cargan con import() dinámico dentro del path de
// envío para que no penalicen el arranque cuando no hay credenciales.

// prefijo de logs del módulo
const LOG = '[push-dispatch]';

// nombres de env vars (sin magic strings)
const ENV_FIREBASE_SERVICE_ACCOUNT = 'FIREBASE_SERVICE_ACCOUNT';
const ENV_VAPID_PUBLIC_KEY = 'VAPID_PUBLIC_KEY';
const ENV_VAPID_PRIVATE_KEY = 'VAPID_PRIVATE_KEY';
const ENV_VAPID_SUBJECT = 'VAPID_SUBJECT';

// plataforma que se enruta por web push; el resto (android/ios) va por FCM
const PLATFORM_WEB = 'web';

// código de error de FCM cuando el token ya no está registrado → invalidar
const FCM_DEAD_TOKEN_CODE = 'messaging/registration-token-not-registered';

// statusCodes de web push que indican suscripción muerta → invalidar
// (404 Not Found, 410 Gone)
const WEB_PUSH_GONE_STATUS = new Set([404, 410]);

// interfaz estructural mínima del cliente de mensajería de firebase-admin que
// usamos (evita acoplarnos a los subpaths de tipos del paquete)
interface FcmMessaging {
  send(message: {
    token: string;
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  }): Promise<string>;
}

// interfaz estructural mínima del módulo web-push que usamos
interface WebPushSender {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(subscription: unknown, payload?: string | null): Promise<{ statusCode: number }>;
}

// singletons de inicialización: se cachea la PROMESA (no un booleano) para que
// varios envíos concurrentes compartan la misma init sin condiciones de carrera
let fcmInit: Promise<FcmMessaging | null> | null = null;
let webInit: Promise<WebPushSender | null> | null = null;

// inicializa firebase-admin una sola vez; null si faltan/fallan las credenciales
async function initFcm(): Promise<FcmMessaging | null> {
  const saPath = process.env[ENV_FIREBASE_SERVICE_ACCOUNT];
  if (!saPath) {
    console.warn(`${LOG} FCM deshabilitado: falta ${ENV_FIREBASE_SERVICE_ACCOUNT}`);
    return null;
  }
  try {
    if (!existsSync(saPath)) {
      console.warn(`${LOG} FCM deshabilitado: no existe el service-account en ${saPath}`);
      return null;
    }
    // export = admin → el default lleva el namespace completo
    const admin = (await import('firebase-admin')).default;
    const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
    // singleton: reutilizar la app ya inicializada si existe
    const app = admin.apps.length > 0
      ? admin.apps[0]!
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log(`${LOG} FCM inicializado`);
    return admin.messaging(app);
  } catch (err) {
    console.warn(`${LOG} FCM deshabilitado: error al inicializar`, err);
    return null;
  }
}

// inicializa web-push (VAPID) una sola vez; null si faltan/fallan las claves
async function initWebPush(): Promise<WebPushSender | null> {
  const publicKey = process.env[ENV_VAPID_PUBLIC_KEY];
  const privateKey = process.env[ENV_VAPID_PRIVATE_KEY];
  const subject = process.env[ENV_VAPID_SUBJECT];
  if (!publicKey || !privateKey || !subject) {
    console.warn(`${LOG} web push deshabilitado: faltan ${ENV_VAPID_PUBLIC_KEY} / ${ENV_VAPID_PRIVATE_KEY} / ${ENV_VAPID_SUBJECT}`);
    return null;
  }
  try {
    // web-push es CommonJS: bajo ESM nativo (dev tsx / prod tsup external) sus
    // funciones viven en .default, no como named exports → tomar el default
    const mod = (await import('web-push')) as unknown as WebPushSender & { default?: WebPushSender };
    const webpush = mod.default ?? mod;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    console.log(`${LOG} web push inicializado`);
    return webpush;
  } catch (err) {
    console.warn(`${LOG} web push deshabilitado: error al inicializar`, err);
    return null;
  }
}

// accesores perezosos con cache de promesa (init única por proceso)
const getFcm = (): Promise<FcmMessaging | null> => (fcmInit ??= initFcm());
const getWebPush = (): Promise<WebPushSender | null> => (webInit ??= initWebPush());

// convierte el mapa de data del payload a Record<string,string> (FCM exige que
// todos los valores de data sean strings; se descartan los undefined)
const toDataMap = (data: PushPayload['data']): Record<string, string> =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));

// envía por FCM; invalida el token si está muerto; nunca lanza
async function sendFcm(token: string, payload: PushPayload): Promise<void> {
  const messaging = await getFcm();
  if (!messaging) return; // canal deshabilitado → no-op
  try {
    await messaging.send({
      token,
      notification: { title: payload.title, body: payload.body },
      data: toDataMap(payload.data),
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === FCM_DEAD_TOKEN_CODE) {
      invalidateToken(token);
      return;
    }
    console.error(`${LOG} fallo FCM:`, err);
  }
}

// envía por web push; el token es el JSON.stringify de una PushSubscription;
// invalida la suscripción si el endpoint responde 404/410; nunca lanza
async function sendWeb(token: string, payload: PushPayload): Promise<void> {
  const sender = await getWebPush();
  if (!sender) return; // canal deshabilitado → no-op
  // parsear la suscripción FUERA del try de envío: un token corrupto (JSON inválido)
  // debe invalidarse una vez, no reintentarse (y re-parsear) en cada despacho
  let subscription: unknown;
  try {
    subscription = JSON.parse(token);
  } catch {
    invalidateToken(token);
    return;
  }
  try {
    await sender.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status != null && WEB_PUSH_GONE_STATUS.has(status)) {
      invalidateToken(token);
      return;
    }
    console.error(`${LOG} fallo web push:`, err);
  }
}

// envía el payload a todos los dispositivos activos del usuario. reparte por
// plataforma (android/ios → FCM, web → web push) y jamás propaga errores para
// no romper el flujo que dispara la notificación (polling / recompute de cache).
export async function sendPush(userId: number, payload: PushPayload): Promise<void> {
  try {
    const tokens = listActiveTokens(userId);
    if (tokens.length === 0) return;
    await Promise.allSettled(
      tokens.map((t) => (t.platform === PLATFORM_WEB ? sendWeb(t.token, payload) : sendFcm(t.token, payload))),
    );
  } catch (err) {
    // salvaguarda final: el envío de push nunca debe lanzar hacia el caller
    console.error(`${LOG} error inesperado enviando a user ${userId}:`, err);
  }
}

// indica qué canales tienen credenciales configuradas (chequeo de env, barato)
export function isPushConfigured(): { fcm: boolean; web: boolean } {
  return {
    fcm: Boolean(process.env[ENV_FIREBASE_SERVICE_ACCOUNT]),
    web: Boolean(process.env[ENV_VAPID_PUBLIC_KEY] && process.env[ENV_VAPID_PRIVATE_KEY] && process.env[ENV_VAPID_SUBJECT]),
  };
}

// true si el usuario tiene al menos un dispositivo activo en un canal CON credenciales.
// gobierna el gating de dedup/estado en notification-events: sin canal entregable no se
// consume el evento (dedup, baseline de records, notification_period_state), de modo que
// se dispare cuando existan credenciales + dispositivo.
export function hasDeliverableChannel(userId: number): boolean {
  const cfg = isPushConfigured();
  if (!cfg.fcm && !cfg.web) return false;
  return listActiveTokens(userId).some((t) => (t.platform === PLATFORM_WEB ? cfg.web : cfg.fcm));
}
