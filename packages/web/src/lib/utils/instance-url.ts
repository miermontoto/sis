// normalización de la url que el usuario escribe en /connect: devuelve el
// origen canónico (`https://host[:puerto]`) o null si no sirve. pura y con
// tests: la validación decide si el apk puede hablar con esa instancia.
//
// sólo https: spotify exige redirect uris https (salvo loopback) y la cookie
// de sesión lleva `secure` cuando el redirect lo es, así que una instancia
// http nunca completaría el login desde el móvil — mejor rechazarla aquí que
// dejar que falle a medias.
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const HTTPS = 'https:';

export function normalizeInstanceUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = SCHEME_RE.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== HTTPS || !url.hostname) return null;
  return url.origin;
}

export function instanceHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
