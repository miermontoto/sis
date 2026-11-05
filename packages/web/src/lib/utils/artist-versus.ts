import type { Accolade, ArtistDetail, RankingMetric } from '$lib/api';
import { accoladeKey, accoladeLabel, accoladeValue } from './accolades';
import { timelineMonths, type TimelineBucket, type TimelineSources } from './entity-timeline';

// lógica de la comparación de dos artistas (/artist/:a/vs/:b). módulo puro: la página y
// sus gráficas sólo pintan lo que sale de aquí

export type VersusSide = 'a' | 'b';
type Better = 'higher' | 'lower';

/** una cifra de una fila de la comparación, ya formateada, con el lado que la gana */
export interface VersusRow {
  key: string;
  label: string;
  a: string;
  b: string;
  leader: VersusSide | null;
}

export const VERSUS_NO_VALUE = '–';

export const versusHref = (a: string, b: string) =>
  `/artist/${encodeURIComponent(a)}/vs/${encodeURIComponent(b)}`;

/** a dónde lleva elegir el rival: el artista conservado sigue en su lado */
export const pickedVersusHref = (kept: { id: string; side: VersusSide }, picked: string) =>
  kept.side === 'a' ? versusHref(kept.id, picked) : versusHref(picked, kept.id);

/** el id bajo el que rankea un artista: un alias cuenta como el canónico de su merge */
export const canonicalArtistId = (detail: Pick<ArtistDetail, 'artist' | 'relations'>): string =>
  detail.relations.find(r => r.kind === 'alias')?.id ?? detail.artist.id;

/** lado con la mejor cifra. Tener cifra gana a no tenerla; un empate no es de nadie */
export function leaderOf(a: number | null | undefined, b: number | null | undefined, better: Better = 'higher'): VersusSide | null {
  if (a == null || b == null) return a != null ? 'a' : b != null ? 'b' : null;
  if (a === b) return null;
  return (a > b) === (better === 'higher') ? 'a' : 'b';
}

export function versusRow(
  key: string,
  label: string,
  a: number | null | undefined,
  b: number | null | undefined,
  format: (value: number) => string,
  better: Better = 'higher',
): VersusRow {
  const text = (v: number | null | undefined) => (v == null ? VERSUS_NO_VALUE : format(v));
  return { key, label, a: text(a), b: text(b), leader: leaderOf(a, b, better) };
}

/**
 * reparte las cifras de los dos separando lo compartido: un play de un tema a medias cuenta
 * en los dos artistas, así que A + B se pasa del total real justo por lo que comparten.
 * Con min() una respuesta de overlap más nueva que un detalle cacheado no da negativos.
 */
export function listeningSplit(a: number, b: number, shared: number) {
  const together = Math.min(shared, a, b);
  return { a: a - together, together, b: b - together, total: a + b - together };
}

type TimelineSide = Pick<TimelineSources, 'series' | 'rankHistory'>;

/**
 * las líneas de los dos artistas sobre el mismo calendario: del primer mes con datos de
 * cualquiera de los dos al mes en curso, con los dos arrays alineados por índice. Se
 * consigue con una fila a cero en ese primer mes, que el dato real pisa si es suyo: así el
 * arrastre de acumulado y ranking sigue siendo el de timelineMonths.
 */
export function alignTimelines(a: TimelineSide, b: TimelineSide, now: Date): Record<VersusSide, TimelineBucket[]> {
  const first = [a, b]
    .flatMap(s => [s.series[0]?.period, s.rankHistory[0]?.period])
    .filter((p): p is string => !!p)
    .sort()[0];
  if (!first) return { a: [], b: [] };
  const side = (s: TimelineSide) => timelineMonths({
    series: [{ period: first, play_count: 0, total_ms: 0 }, ...s.series],
    rankHistory: s.rankHistory,
    now,
  });
  return { a: side(a), b: side(b) };
}

export interface LeadHistory {
  /** quién va delante en el acumulado all-time; null sin datos o empatados de principio a fin */
  leader: VersusSide | null;
  /** primer mes de la racha actual en cabeza */
  since: string | null;
  /** cada adelantamiento, en orden. Ponerse primero al empezar no es adelantar a nadie */
  changes: { month: string; leader: VersusSide }[];
}

/**
 * adelantamientos entre los dos. El ranking all-time ordena por el acumulado de la métrica,
 * así que A pasa a B en el ranking justo cuando lo pasa en el acumulado: salen de la serie
 * mensual, sin el escaneo de ranking. Un mes empatado no cambia al que iba delante.
 */
export function leadHistory(a: TimelineBucket[], b: TimelineBucket[], metric: RankingMetric): LeadHistory {
  const cumulative = (bucket: TimelineBucket) => (metric === 'plays' ? bucket.cumPlays : bucket.cumMs);
  const history: LeadHistory = { leader: null, since: null, changes: [] };
  a.forEach((bucket, i) => {
    const side = leaderOf(cumulative(bucket), cumulative(b[i]));
    if (!side || side === history.leader) return;
    if (history.leader) history.changes.push({ month: bucket.key, leader: side });
    history.leader = side;
    history.since = bucket.key;
  });
  return history;
}

/**
 * filas de records de los dos: una por record que tenga alguno (cada año de year-end es el
 * suyo). Gana el mejor puesto en la lista de ese record, que es lo único comparable entre
 * dos entidades. Primero los records, por el mejor puesto de la fila; luego los year-end,
 * del año más reciente al más antiguo.
 */
export function recordRows(a: Accolade[], b: Accolade[], metric: RankingMetric): VersusRow[] {
  const byKey = (list: Accolade[]) => new Map(list.map(item => [accoladeKey(item), item]));
  const [ofA, ofB] = [byKey(a), byKey(b)];
  const bestRank = (x: Accolade | undefined, y: Accolade | undefined) => Math.min(x?.rank ?? Infinity, y?.rank ?? Infinity);
  const year = (x: Accolade | undefined, y: Accolade | undefined) => x?.year ?? y?.year ?? null;

  return [...new Set([...ofA.keys(), ...ofB.keys()])]
    .map(key => ({ key, x: ofA.get(key), y: ofB.get(key) }))
    .sort((l, r) => {
      const [ly, ry] = [year(l.x, l.y), year(r.x, r.y)];
      if ((ly == null) !== (ry == null)) return ly == null ? -1 : 1;
      return ly != null && ry != null ? ry - ly : bestRank(l.x, l.y) - bestRank(r.x, r.y);
    })
    .map(({ key, x, y }) => ({
      key,
      label: accoladeLabel((x ?? y)!),
      a: x ? accoladeValue(x, metric) : VERSUS_NO_VALUE,
      b: y ? accoladeValue(y, metric) : VERSUS_NO_VALUE,
      leader: leaderOf(x?.rank, y?.rank, 'lower'),
    }));
}
