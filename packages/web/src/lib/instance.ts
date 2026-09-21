// instancia contra la que habla la app.
//
// en web es siempre el mismo origen ('' → rutas relativas): la api sirve la spa.
// en el apk el webview corre en https://localhost y la api vive en la instancia
// que el usuario eligió en /connect (localStorage del webview, que es estable
// gracias a androidScheme:'https'). no hay default: la app arranca en el picker
// hasta que se elige una, y la oficial es sólo un atajo.
//
// todo lo que necesite el origen de la api pasa por aquí (apiOrigin en el
// cliente, el canje del deep link, share). no vuelvas a leer VITE_API_BASE:
// era el origen fijado en el build y ya no existe.
import { Capacitor } from '@capacitor/core';
import { clearAll } from './cache/store';
import { instanceHost } from './utils/instance-url';

export const OFFICIAL_INSTANCE = 'https://sis.mier.info';
const STORAGE_KEY = 'sis:instance';
const VERSION_PATH = '/api/version';

// undefined = aún no leído de localStorage
let cached: string | null | undefined;

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

// origen de la instancia ('' en web = mismo origen)
export function instanceOrigin(): string {
  if (!isNativeApp()) return '';
  if (cached === undefined) {
    try {
      cached = localStorage.getItem(STORAGE_KEY);
    } catch {
      cached = null;
    }
  }
  return cached ?? '';
}

// ¿hay instancia con la que hablar? en web siempre; en el apk sólo tras elegirla
export function hasInstance(): boolean {
  return !isNativeApp() || instanceOrigin() !== '';
}

// apk conectado a una instancia que no es la oficial: ahí no hay push (los
// tokens fcm van atados al proyecto firebase del apk, que el servidor ajeno no
// puede firmar) ni login con mier.info (el cliente oidc sólo existe para la
// instancia principal)
export function isForeignInstance(): boolean {
  return isNativeApp() && instanceOrigin() !== OFFICIAL_INSTANCE;
}

// host legible de la instancia actual (web: el propio)
export function instanceLabel(): string {
  return isNativeApp() ? instanceHost(instanceOrigin()) : window.location.host;
}

// comprueba que en ese origen hay una api de sis: /api/version es pública.
// lanza si no responde o no es json con `version`.
export async function probeInstance(origin: string): Promise<string> {
  const res = await fetch(`${origin}${VERSION_PATH}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { version?: unknown } | null;
  if (!body || typeof body.version !== 'string') throw new Error('not a sis instance');
  return body.version;
}

// fija la instancia y borra el cache local entero: las claves del cache no
// llevan el origen y el mismo user id existe en cualquier instancia, así que
// sin esto la app pintaría las cifras de la anterior hasta que caducasen.
// el caller recarga la spa después (window.location), que es lo que vacía
// el L1 en memoria y el espejo de ajustes en localStorage.
export async function switchInstance(origin: string): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, origin);
  } catch {
    // sin storage no hay nada que persistir: la sesión durará lo que dure la página
  }
  cached = origin;
  await clearAll();
}

export async function forgetInstance(): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
  cached = null;
  await clearAll();
}
