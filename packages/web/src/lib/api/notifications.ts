import type { DeviceTokenRecord, DevicePlatform } from '@sis/shared';
import { apiFetch, API_BASE } from './client.js';

// cliente tipado para el registro de tokens de dispositivo y la clave VAPID.
// API_BASE (no rutas relativas): en el apk el webview corre en https://localhost
// y las mutaciones deben ir al dominio público (mismo criterio que settings.ts).

// mutación directa contra API_BASE. se evita apiMutate a propósito: registrar o
// borrar un token no debe invalidar todo el cache de la app (apiMutate haría un
// clear total al no existir regla de path para /device-tokens).
async function mutate<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  // 204 No Content: sin cuerpo que parsear
  if (res.status === 204) return undefined as T;
  return res.json();
}

// registra (o reactiva) el token push del dispositivo para el usuario actual.
// userAgent ayuda a distinguir dispositivos en la gestión de tokens.
export function registerDeviceToken(token: string, platform: DevicePlatform) {
  return mutate<DeviceTokenRecord | undefined>('POST', '/device-tokens', {
    token,
    platform,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  });
}

// lista los tokens activos del usuario (sin exponer el token en sí).
export function listDeviceTokens() {
  return apiFetch<DeviceTokenRecord[]>('/device-tokens');
}

// baja lógica (is_active=0) de un token por id.
export function deleteDeviceToken(id: number) {
  return mutate<void>('DELETE', `/device-tokens/${id}`);
}

// clave pública VAPID para suscribir el push web. fetch directo (sin cache) para
// no fijar un '' obsoleto si el server aún no tiene la clave configurada.
export async function getVapidPublicKey(): Promise<{ publicKey: string }> {
  const res = await fetch(`${API_BASE}/push/vapid-public-key`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
