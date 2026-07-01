// clasificación de "versiones" de un mismo tema (mismo artista principal, título base similar):
// original, live, remix, remaster, etc. el tag es una clave estable para la UI (badge/color);
// el texto humano del qualifier ("Live at Wembley 1985", "2011 Remaster") viaja aparte.
export type VersionTag =
  | 'original'
  | 'live'
  | 'acoustic'
  | 'remix'
  | 'remaster'
  | 'radio'
  | 'extended'
  | 'instrumental'
  | 'demo'
  | 'deluxe'
  | 'edit'
  | 'feat'
  | 'other';

// una versión de un tema con las estadísticas de escucha del usuario, para comparar
// cuál se reproduce más. incluye el propio track visualizado (isCurrent = true).
export interface TrackVersion {
  trackId: string;
  name: string;                 // nombre completo del track (con el qualifier)
  qualifier: string | null;     // texto de la variante para mostrar; null si es el original
  tag: VersionTag;
  playCount: number;
  totalMs: number;
  durationMs: number;
  album: { id: string; name: string; imageUrl: string | null } | null;
  isCurrent: boolean;
}
