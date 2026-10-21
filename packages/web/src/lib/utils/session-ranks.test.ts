import { describe, it, expect } from 'vitest';
import type { ProjectedRankingsResponse, ProjectionResult, RankProjection } from '@sis/shared';
import { bestChange, filterChanges, rangeLabel, rankMoments, rankingHref, sessionUpCount, MOMENTS_PER_UPDATE } from './session-ranks';

const who = (id: string) => ({ id, name: id, imageUrl: null, artistName: null });
const change = (range: string, currentRank: number, projectedRank: number, displaced: string[] = []): RankProjection =>
  ({ range, currentRank, projectedRank, delta: currentRank - projectedRank, displaced: displaced.map(who) });
const entity = (entityType: ProjectionResult['entityType'], entityId: string, changes: RankProjection[]): ProjectionResult =>
  ({ entityType, entityId, entityName: entityId, imageUrl: null, changes });
const response = (session: ProjectionResult[], sessionStartedAt = '2026-10-21T16:00:00.000Z'): ProjectedRankingsResponse =>
  ({ nowPlaying: [], session, sessionTrackCount: 3, sessionTotalMs: 600_000, sessionStartedAt });

describe('filterChanges / bestChange / rangeLabel', () => {
  const changes = [change('all', 5, 4), change('thisYear', 9, 6)];

  it('enseña las ventanas de cada modo', () => {
    expect(filterChanges(changes, 'all').map(c => c.range)).toEqual(['all']);
    expect(filterChanges(changes, 'all+ytd').map(c => c.range)).toEqual(['all', 'thisYear']);
    expect(filterChanges(changes, 'none')).toEqual([]);
  });

  it('resume con el mayor salto y, en empate, con el primero', () => {
    expect(bestChange(changes)?.range).toBe('thisYear');
    expect(bestChange([change('all', 5, 4), change('thisYear', 3, 2)])?.range).toBe('all');
    expect(bestChange([])).toBeNull();
  });

  it('omite la etiqueta de ventana en solo-ALL', () => {
    expect(rangeLabel('all', 'all')).toBe('');
    expect(rangeLabel('thisYear', 'all+ytd')).toBe('YTD ');
  });

  it('enlaza al ranking de la ventana con la entidad enfocada', () => {
    expect(rankingHref({ entityType: 'album', entityId: 'x' }, 'thisYear')).toBe('/top?tab=albums&range=thisYear&focus=x');
  });

  it('cuenta las entidades que suben por su cambio resumen', () => {
    const session = [entity('artist', 'a', [change('all', 5, 4)]), entity('album', 'b', [change('thisYear', 4, 5)]), entity('track', 'c', [change('thisYear', 9, 7)])];
    expect(sessionUpCount(session, 'all+ytd')).toBe(2);
    expect(sessionUpCount(session, 'all')).toBe(1);
  });
});

describe('rankMoments', () => {
  it('sin respuesta previa es la línea base: abrir a mitad de sesión no suelta nada', () => {
    expect(rankMoments(null, response([entity('artist', 'a', [change('all', 5, 4, ['b'])])]), 'all+ytd')).toEqual([]);
  });

  it('el salto es contra la proyección anterior, no contra el puesto previo a la sesión', () => {
    const prev = response([entity('track', 't', [change('all', 9, 8, ['p8'])])]);
    const next = response([entity('track', 't', [change('all', 9, 7, ['p8', 'p7'])])]);
    const [m] = rankMoments(prev, next, 'all');
    expect([m.from, m.to]).toEqual([8, 7]);
    expect(m.passed.map(p => p.id)).toEqual(['p7']);
  });

  it('una entidad que aún no había cambiado sube desde su puesto de antes de la sesión', () => {
    const prev = response([]);
    const [m] = rankMoments(prev, response([entity('artist', 'a', [change('all', 5, 4, ['b'])])]), 'all');
    expect([m.from, m.to, m.passed.length]).toEqual([5, 4, 1]);
  });

  it('una sesión nueva no se compara con la anterior', () => {
    const prev = response([entity('artist', 'a', [change('all', 5, 4)])], '2026-10-21T10:00:00.000Z');
    const next = response([entity('artist', 'a', [change('all', 5, 4, ['b'])])], '2026-10-21T16:00:00.000Z');
    expect(rankMoments(prev, next, 'all')).toHaveLength(1);
  });

  it('sin cambio o con una bajada no hay momento', () => {
    const same = response([entity('artist', 'a', [change('all', 5, 4)])]);
    expect(rankMoments(same, same, 'all')).toEqual([]);
    const down = response([entity('album', 'r', [change('thisYear', 4, 5)])]);
    expect(rankMoments(response([]), down, 'all+ytd')).toEqual([]);
  });

  it('respeta las ventanas del modo', () => {
    const next = response([entity('artist', 'a', [change('thisYear', 3, 2, ['x'])])]);
    expect(rankMoments(response([]), next, 'all')).toEqual([]);
    expect(rankMoments(response([]), next, 'none')).toEqual([]);
    expect(rankMoments(response([]), next, 'all+ytd')).toHaveLength(1);
  });

  it('un momento por entidad, el del mayor salto', () => {
    const next = response([entity('album', 'd', [change('all', 31, 24), change('thisYear', 6, 4)])]);
    const moments = rankMoments(response([]), next, 'all+ytd');
    expect(moments).toHaveLength(1);
    expect(moments[0].range).toBe('all');
  });

  it('se queda en el tope por respuesta, en el orden de la sesión', () => {
    const next = response(['a', 'b', 'c', 'd', 'e'].map(id => entity('track', id, [change('all', 10, 9)])));
    const moments = rankMoments(response([]), next, 'all');
    expect(moments.map(m => m.entityId)).toEqual(['a', 'b', 'c'].slice(0, MOMENTS_PER_UPDATE));
  });
});
