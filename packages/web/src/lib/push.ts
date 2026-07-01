import { registerDeviceToken, getVapidPublicKey } from './api/notifications.js';

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
    await PushNotifications.removeAllListeners();
    // el token FCM llega de forma asíncrona por el evento 'registration'
    await PushNotifications.addListener('registration', (t) => {
      void registerDeviceToken(t.value, 'android');
    });
    await PushNotifications.addListener('registrationError', (e) => {
      console.error('[push] error de registro nativo:', e.error);
    });
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
