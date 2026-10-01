import type { PluginListenerHandle } from '@capacitor/core';
import { registerDeviceToken, getVapidPublicKey } from './api/notifications.js';

// listeners del registro nativo: initPush los recrea en cada llamada sin tocar el de
// las pulsaciones (un removeAllListeners se lo llevaría por delante)
let registrationListeners: PluginListenerHandle[] = [];
let tapListening = false;

// sólo rutas internas: un data.route que no empiece por una única barra se ignora
const isAppRoute = (route: unknown): route is string =>
  typeof route === 'string' && route.startsWith('/') && !route.startsWith('//');

// convierte la clave VAPID (base64url) al Uint8Array que espera
// pushManager.subscribe como applicationServerKey.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// inicializa el push: pide permiso al SO/navegador y registra el token en el
// server. devuelve true si se concedió el permiso (y se inició el registro),
// false si se denegó o el entorno no soporta push. idempotente: reusa la
// suscripción/listeners existentes al llamarse varias veces.
//
// solo debe llamarse tras el opt-in explícito del usuario (master toggle ON).
export async function initPush(): Promise<boolean> {
  const { Capacitor } = await import('@capacitor/core');

  // --- ruta nativa (apk android): @capacitor/push-notifications ---
  if (Capacitor.isNativePlatform()) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return false;
    // evita listeners duplicados si initPush se llama más de una vez
    await Promise.all(registrationListeners.map((h) => h.remove()));
    registrationListeners = await Promise.all([
      // el token FCM llega de forma asíncrona por el evento 'registration'
      PushNotifications.addListener('registration', (t) => {
        void registerDeviceToken(t.value, 'android');
      }),
      PushNotifications.addListener('registrationError', (e) => {
        console.error('[push] error de registro nativo:', e.error);
      }),
    ]);
    await PushNotifications.register();
    return true;
  }

  // --- ruta web (navegador): Web Push vía service worker + VAPID ---
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[push] el navegador no soporta push; se omite');
    return false;
  }

  // permiso de notificaciones del navegador
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  // clave pública VAPID; sin ella no se puede suscribir el push web
  let publicKey = '';
  try {
    publicKey = (await getVapidPublicKey()).publicKey;
  } catch {
    // silencioso: el endpoint puede no responder aún
  }
  if (!publicKey) {
    console.warn('[push] sin clave VAPID en el server; se omite la suscripción web');
    return false;
  }

  const reg = await navigator.serviceWorker.ready;
  // reusa la suscripción si ya existe, si no crea una nueva
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // la lib DOM tipa applicationServerKey como BufferSource sobre ArrayBuffer;
      // el Uint8Array (ArrayBufferLike) es compatible en runtime → cast explícito
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  // para web el token es el PushSubscription serializado (JSON.stringify)
  await registerDeviceToken(JSON.stringify(sub), 'web');
  return true;
}

// al pulsar una push en el apk navega a su data.route, como hace el service worker
// (push-sw.js) en web. Se registra al arrancar la app y no en initPush, que sólo corre
// al activar el master: capacitor retiene la pulsación que abrió la app en frío hasta
// que haya un listener, así que llega igual aunque se registre tras el login.
export async function listenPushTaps(navigate: (route: string) => void): Promise<void> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform() || tapListening) return;
  tapListening = true;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const route: unknown = notification.data?.route;
    if (isAppRoute(route)) navigate(route);
  });
}
