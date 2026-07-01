// una versión de un tema (mismo artista principal, título base similar: live, remix, remaster...)
// con las estadísticas de escucha del usuario, para comparar cuál se reproduce más. incluye el
// propio track visualizado (isCurrent = true).
export interface TrackVersion {
  trackId: string;
  name: string;                 // nombre completo del track (incluye el qualifier: "... - Live Aid")
  playCount: number;
  totalMs: number;
  durationMs: number;
  album: { id: string; name: string; imageUrl: string | null } | null;
  isCurrent: boolean;
}
