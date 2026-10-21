// cambios de puesto de la sesión (respuesta de /stats/projected-rankings): qué
// ventanas se enseñan según `sessionRankDisplay`, cuál es el cambio que resume a
// una entidad y qué ha subido entre dos respuestas seguidas (los momentos de la
// tarjeta móvil). Puro y sin estado: lo comparten la tarjeta de escritorio, la
// sección de sesión de la hoja de now playing y su línea en el mini player
import type { CrossoverEntity, EntityType, ProjectedRankingsResponse, ProjectionResult, RankProjection, SessionRankDisplay } from '@sis/shared';

const RANGE_NAMES: Record<string, string> = { thisYear: 'YTD', all: 'ALL' };
const TOP_TABS: Record<string, string> = { track: 'tracks', artist: 'artists', album: 'albums' };
const ALLOWED_RANGES: Record<SessionRankDisplay, ReadonlySet<string>> = {
  none: new Set(),
  all: new Set(['all']),
  'all+ytd': new Set(['all', 'thisYear']),
};

// momentos que puede soltar una sola respuesta: más seguidos dejan de leerse
export const MOMENTS_PER_UPDATE = 3;

export function filterChanges(changes: RankProjection[], mode: SessionRankDisplay): RankProjection[] {
  const allowed = ALLOWED_RANGES[mode] ?? ALLOWED_RANGES.none;
  return changes.filter(c => allowed.has(c.range));
}

// el cambio que resume a una entidad: el de mayor salto (empate = el primero, all)
export function bestChange(changes: RankProjection[]): RankProjection | null {
  if (changes.length === 0) return null;
  return changes.reduce((best, c) => Math.abs(c.delta) > Math.abs(best.delta) ? c : best);
}

export const rangeName = (range: string): string => RANGE_NAMES[range] ?? range;

// prefijo de la ventana delante de un "#5→#4": en modo solo-ALL es redundante
export function rangeLabel(range: string, mode: SessionRankDisplay): string {
  return mode === 'all' ? '' : `${rangeName(range)} `;
}

export function rankingHref(r: Pick<ProjectionResult, 'entityType' | 'entityId'>, range: string): string {
  return `/top?tab=${TOP_TABS[r.entityType] ?? 'tracks'}&range=${range === 'thisYear' ? 'thisYear' : 'all'}&focus=${r.entityId}`;
}

// entidades de la sesión con algún cambio visible, con esos cambios ya filtrados
export function visibleSession(session: ProjectionResult[], mode: SessionRankDisplay): { result: ProjectionResult; changes: RankProjection[] }[] {
  return session.flatMap(result => {
    const changes = filterChanges(result.changes, mode);
    return changes.length > 0 ? [{ result, changes }] : [];
  });
}

// cuántas entidades suben en la sesión (por su cambio resumen)
export function sessionUpCount(session: ProjectionResult[], mode: SessionRankDisplay): number {
  return visibleSession(session, mode).filter(({ changes }) => (bestChange(changes)?.delta ?? 0) > 0).length;
}

export interface RankMoment {
  key: string;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  imageUrl: string | null;
  range: string;
  from: number;
  to: number;
  // a quién acaba de adelantar en ESTE salto (no en toda la sesión)
  passed: CrossoverEntity[];
}

// lo que ha subido entre dos respuestas seguidas. Cada respuesta compara el puesto
// de antes de la sesión (currentRank) con el de ahora (projectedRank), así que el
// salto de un play es la diferencia entre dos proyecciones, no el delta de una.
// Sin respuesta previa no hay con qué comparar: abrir la app a mitad de sesión es
// la línea base, nunca una ráfaga. Una sesión nueva compara contra su propio
// punto de partida. Sólo subidas y un momento por entidad (el mayor salto)
export function rankMoments(
  prev: ProjectedRankingsResponse | null,
  next: ProjectedRankingsResponse,
  mode: SessionRankDisplay,
  limit = MOMENTS_PER_UPDATE,
): RankMoment[] {
  if (!prev) return [];
  const sameSession = prev.sessionStartedAt !== null && prev.sessionStartedAt === next.sessionStartedAt;
  const before = new Map(sameSession
    ? prev.session.flatMap(r => r.changes.map(c => [`${r.entityType}:${r.entityId}:${c.range}`, c] as const))
    : []);

  return next.session.flatMap(r => {
    const jumps = filterChanges(r.changes, mode).flatMap(c => {
      const earlier = before.get(`${r.entityType}:${r.entityId}:${c.range}`);
      const from = earlier?.projectedRank ?? c.currentRank;
      if (c.projectedRank >= from) return [];
      const known = new Set(earlier?.displaced.map(d => d.id) ?? []);
      return [{ c, from, passed: c.displaced.filter(d => !known.has(d.id)) }];
    });
    if (jumps.length === 0) return [];
    const top = jumps.reduce((best, j) => j.from - j.c.projectedRank > best.from - best.c.projectedRank ? j : best);
    return [{
      key: `${r.entityType}:${r.entityId}:${top.c.range}:${top.c.projectedRank}`,
      entityType: r.entityType,
      entityId: r.entityId,
      entityName: r.entityName,
      imageUrl: r.imageUrl,
      range: top.c.range,
      from: top.from,
      to: top.c.projectedRank,
      passed: top.passed,
    }];
  }).slice(0, limit);
}
