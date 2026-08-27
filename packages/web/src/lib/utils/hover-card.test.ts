import { describe, it, expect } from 'vitest';
import {
  parseEntityPath, densifySeries, placeCard, sparkPath,
  ENTITY_CARD_WIDTH, ENTITY_CARD_GAP, ENTITY_CARD_PAD,
} from './hover-card';
import type { EntityCardPoint } from '$lib/api';

// la tarjeta se dispara con un listener delegado sobre CUALQUIER enlace de la
// app, así que el parseo tiene que rechazar todo lo que no sea exactamente la
// ruta de detalle de una entidad: es lo único que separa "abrir tarjeta" de
// "pedir /api/stats/card de una ruta que no es una entidad".
describe('parseEntityPath', () => {
  it('resuelve las tres rutas de detalle', () => {
    expect(parseEntityPath('/track/abc')).toEqual({ type: 'track', id: 'abc' });
    expect(parseEntityPath('/album/abc')).toEqual({ type: 'album', id: 'abc' });
    expect(parseEntityPath('/artist/abc')).toEqual({ type: 'artist', id: 'abc' });
  });

  it('descodifica los ids sintéticos (import:/local: viajan escapados en la url)', () => {
    expect(parseEntityPath('/track/import%3A1234')).toEqual({ type: 'track', id: 'import:1234' });
  });

  it('rechaza rutas que no son el detalle de una entidad', () => {
    expect(parseEntityPath('/top')).toBeNull();
    expect(parseEntityPath('/track')).toBeNull();
    expect(parseEntityPath('/track/')).toBeNull();
    // /u/:id y /playlists/:id no son entidades aunque tengan la misma forma
    expect(parseEntityPath('/u/mier')).toBeNull();
    expect(parseEntityPath('/playlists/12')).toBeNull();
    // un segmento de más ya no es la página de la entidad
    expect(parseEntityPath('/artist/abc/top/tracks')).toBeNull();
  });
});

describe('densifySeries', () => {
  // 2026-05-20T00:00:00Z, a media mañana para que el truncado a día importe
  const NOW = Date.UTC(2026, 4, 20, 10, 30);
  const points: EntityCardPoint[] = [
    { day: '2026-05-20', playCount: 3, totalMs: 600_000 },
    { day: '2026-05-18', playCount: 1, totalMs: 200_000 },
  ];

  it('rellena a cero los días sin plays y termina en hoy', () => {
    const values = densifySeries(points, 5, 'plays', NOW);
    // 16, 17, 18, 19, 20 de mayo
    expect(values).toEqual([0, 0, 1, 0, 3]);
  });

  it('usa la métrica pedida', () => {
    expect(densifySeries(points, 3, 'time', NOW)).toEqual([200_000, 0, 600_000]);
  });

  it('devuelve exactamente `days` puntos aunque la serie venga vacía', () => {
    const values = densifySeries([], 90, 'plays', NOW);
    expect(values).toHaveLength(90);
    expect(values.every(v => v === 0)).toBe(true);
  });
});

describe('placeCard', () => {
  const VIEWPORT = { width: 1200, height: 800 };
  const CARD_H = 160;

  it('se coloca debajo del ancla cuando cabe', () => {
    const { top } = placeCard({ top: 100, bottom: 130 }, 600, CARD_H, VIEWPORT);
    expect(top).toBe(130 + ENTITY_CARD_GAP);
  });

  it('salta encima del ancla cuando no cabe debajo', () => {
    const { top } = placeCard({ top: 700, bottom: 730 }, 600, CARD_H, VIEWPORT);
    expect(top).toBe(700 - ENTITY_CARD_GAP - CARD_H);
  });

  it('nunca se sale del viewport aunque no quepa ni arriba ni abajo', () => {
    const tall = VIEWPORT.height - 20;
    const { top } = placeCard({ top: 5, bottom: 780 }, 600, tall, VIEWPORT);
    expect(top).toBeGreaterThanOrEqual(ENTITY_CARD_PAD);
    expect(top + tall).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('se centra en el puntero, no en el ancla', () => {
    // ancla ancha (una fila de lista ocupa todo el ancho) con el puntero a la derecha
    const { left } = placeCard({ top: 100, bottom: 130 }, 900, CARD_H, VIEWPORT);
    expect(left).toBe(900 - ENTITY_CARD_WIDTH / 2);
  });

  it('clampa en horizontal en ambos bordes', () => {
    expect(placeCard({ top: 100, bottom: 130 }, 4, CARD_H, VIEWPORT).left).toBe(ENTITY_CARD_PAD);
    expect(placeCard({ top: 100, bottom: 130 }, 1196, CARD_H, VIEWPORT).left)
      .toBe(VIEWPORT.width - ENTITY_CARD_WIDTH - ENTITY_CARD_PAD);
  });
});

describe('sparkPath', () => {
  it('normaliza contra el máximo: el pico toca el techo y el cero el suelo', () => {
    const path = sparkPath([0, 5, 10]);
    expect(path).not.toBeNull();
    expect(path!.line).toBe('M0,1.0000 L1,0.5000 L2,0.0000');
    // el área cierra por el suelo para poder rellenarla
    expect(path!.area.endsWith(' L2,1 L0,1 Z')).toBe(true);
    expect(path!.lastX).toBe(2);
  });

  it('no dibuja nada sin actividad en la ventana', () => {
    expect(sparkPath([0, 0, 0])).toBeNull();
    expect(sparkPath([])).toBeNull();
    expect(sparkPath([7])).toBeNull();
  });
});
