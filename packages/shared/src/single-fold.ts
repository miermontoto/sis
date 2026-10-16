// a qué álbum pertenece un single de adelanto, como decisión pura: el barrido automático
// (api/services/single-fold.ts) carga el catálogo y esto decide, así que las reglas se
// prueban sin base de datos. Un single se pliega en un álbum sólo si:
//   - el álbum sale después del single (o el mismo día) y dentro de la ventana de adelanto;
//   - TODOS sus temas están en el álbum. Un B-side, un instrumental o un remix que el álbum
//     no lleva deja el single como lanzamiento propio: sus plays no son del álbum.
// Entre varios álbumes que cumplen gana el primero en salir: una deluxe posterior repite los
// mismos temas y no es a la que el single adelantaba.

export interface FoldTrack {
  id: string;
  // título sin créditos (creditBaseKey en la api): "Song (feat. X)" ≡ "Song", pero
  // "Song (Remix)" conserva su qualifier y no casa con "Song"
  key: string;
  durationMs: number;
  isrc: string | null;
  // ya forma parte de otro merge de track del usuario: cuenta para saber si el tema está
  // en el álbum, pero no puede entrar en un merge nuevo (validateMergeRule lo rechazaría)
  locked?: boolean;
}

export interface FoldRelease {
  id: string;
  // fecha de spotify con su precisión: 'YYYY', 'YYYY-MM' o 'YYYY-MM-DD'
  releaseDate: string;
  tracks: FoldTrack[];
}

export interface FoldTrackPair { sourceTrackId: string; targetTrackId: string }

export interface SingleFold { albumId: string; trackPairs: FoldTrackPair[] }

export interface SingleFoldOptions {
  maxLeadMs: number;
  durationToleranceMs: number;
}

const DATE_PARTS = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/;

// primer o último instante del periodo que cubre una fecha parcial: '2024' va del 1 de
// enero al 31 de diciembre. Comparar los dos extremos hace la ventana indulgente con la
// precisión, que un álbum con sólo el año no quede "antes" de su single de septiembre
const releaseEdge = (date: string, edge: 'start' | 'end'): number | null => {
  const m = DATE_PARTS.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  if (edge === 'start') return Date.UTC(year, m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1);
  if (m[3]) return Date.UTC(year, Number(m[2]) - 1, Number(m[3]));
  // día 0 del mes siguiente = último día del mes (o del año sin mes)
  return m[2] ? Date.UTC(year, Number(m[2]), 0) : Date.UTC(year, 11, 31);
};

/** El álbum sale con el single o después, y no más tarde que `maxLeadMs` tras él. */
export function inFoldWindow(single: FoldRelease, album: FoldRelease, maxLeadMs: number): boolean {
  const singleStart = releaseEdge(single.releaseDate, 'start');
  const singleEnd = releaseEdge(single.releaseDate, 'end');
  const albumStart = releaseEdge(album.releaseDate, 'start');
  const albumEnd = releaseEdge(album.releaseDate, 'end');
  if (singleStart === null || singleEnd === null || albumStart === null || albumEnd === null) return false;
  return albumEnd >= singleStart && albumStart - singleEnd <= maxLeadMs;
}

const containsAll = (single: FoldRelease, album: FoldRelease) => {
  const keys = new Set(album.tracks.map(t => t.key));
  return single.tracks.length > 0 && single.tracks.every(t => t.key !== '' && keys.has(t.key));
};

// misma grabación: misma clave, duraciones conocidas y dentro de tolerancia, y sin dos
// isrc distintos (dos grabaciones registradas aparte). Es la regla de isSameRecording en
// dedup.ts: la versión de radio o el single de 5:39 de "Runaway" no se funden con el corte
// de álbum aunque se llamen igual
const sameRecording = (a: FoldTrack, b: FoldTrack, toleranceMs: number) =>
  a.key === b.key && a.durationMs > 0 && b.durationMs > 0
  && Math.abs(a.durationMs - b.durationMs) <= toleranceMs
  && !(a.isrc && b.isrc && a.isrc !== b.isrc);

const recordingPairs = (single: FoldRelease, album: FoldRelease, toleranceMs: number): FoldTrackPair[] => {
  const used = new Set<string>();
  return single.tracks
    .filter(st => !st.locked)
    .flatMap(st => {
      const target = album.tracks
        .filter(at => !at.locked && !used.has(at.id) && sameRecording(st, at, toleranceMs))
        .sort((a, b) => Math.abs(a.durationMs - st.durationMs) - Math.abs(b.durationMs - st.durationMs))[0];
      if (!target) return [];
      used.add(target.id);
      return [{ sourceTrackId: st.id, targetTrackId: target.id }];
    });
};

/** Álbum en el que plegar el single y los merges de track que lo acompañan (sólo los
 *  temas que son la misma grabación; una versión distinta sigue su camino como track
 *  aunque el single entero pase a contar para el álbum). null = no se pliega. */
export function pickSingleFold(single: FoldRelease, albums: FoldRelease[], opts: SingleFoldOptions): SingleFold | null {
  const album = albums
    .filter(a => a.id !== single.id && inFoldWindow(single, a, opts.maxLeadMs) && containsAll(single, a))
    .sort((a, b) =>
      (releaseEdge(a.releaseDate, 'start') ?? 0) - (releaseEdge(b.releaseDate, 'start') ?? 0)
      || b.tracks.length - a.tracks.length
      || a.id.localeCompare(b.id))[0];
  return album ? { albumId: album.id, trackPairs: recordingPairs(single, album, opts.durationToleranceMs) } : null;
}
