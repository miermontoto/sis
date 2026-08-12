import { isAbortError } from './errors';
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.share;
}

export async function shareEntity(title: string, url: string): Promise<void> {
  if (!canShare()) return;
  try {
    await navigator.share({ title, url });
  } catch (e) {
    if (e instanceof DOMException && isAbortError(e)) return;
    throw e;
  }
}

// url pública de la ruta actual: en el apk window.location.origin es el origen
// local del webview (https://localhost) — la base pública sale de VITE_API_BASE
// (la api sirve la spa en el mismo dominio). en web, href tal cual.
export function publicHref(): string {
  const base = import.meta.env.VITE_API_BASE;
  if (!base) return window.location.href;
  return `${base}${window.location.pathname}${window.location.search}`;
}
