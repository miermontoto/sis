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
  /** cada adelantamiento, en orden; `index` es su mes en el calendario. Ponerse primero al
   *  empezar no es adelantar a nadie */
  changes: { month: string; index: number; leader: VersusSide }[];
  /** quién iba delante en cada tramo, [start, end) en índices del calendario */
  spans: { leader: VersusSide; start: number; end: number }[];
}

/**
 * adelantamientos entre los dos. El ranking all-time ordena por el acumulado de la métrica,
 * así que A pasa a B en el ranking justo cuando lo pasa en el acumulado: salen de la serie
 * mensual, sin el escaneo de ranking. Un mes empatado no cambia al que iba delante.
 */
export function leadHistory(a: TimelineBucket[], b: TimelineBucket[], metric: RankingMetric): LeadHistory {
  const cumulative = (bucket: TimelineBucket) => (metric === 'plays' ? bucket.cumPlays : bucket.cumMs);
  const history: LeadHistory = { leader: null, since: null, changes: [], spans: [] };
  a.forEach((bucket, i) => {
    const side = leaderOf(cumulative(bucket), cumulative(b[i]));
    if (!side || side === history.leader) return;
    if (history.leader) history.changes.push({ month: bucket.key, index: i, leader: side });
    const open = history.spans.at(-1);
    if (open) open.end = i;
    history.spans.push({ leader: side, start: i, end: a.length });
    history.leader = side;
    history.since = bucket.key;
  });
  return history;
}

/**
 * Carril y lado de cada etiqueta de la línea de tiempo, para que en un racimo no se pisen ni
 * los tallos atraviesen el texto. Una etiqueta baja por debajo de TODAS con las que choca:
 * rellenar el primer hueco libre dejaba una anterior por encima de otra posterior y el tallo
 * de ésta la cruzaba. Crecen hacia la derecha desde su marca, así que se reparten de la última
 * a la primera, y un tallo siempre pasa a la izquierda de lo que tiene encima; las que no caben
 * crecen hacia la izquierda (`flip`) y por lo mismo van al revés, de la primera a la última.
 * Una derecha y una izquierda muy juntas tienen cada una su tallo dentro de la otra: ese cruce
 * no se puede evitar, y por eso los tallos se pintan debajo del texto.
 * En un eje más estrecho que dos etiquetas, la que no cabe por ningún lado se encoge (`width`).
 */
export function placeTimelineLabels(offsets: number[], trackWidth: number, labelWidth: number, gap: number) {
  const boxes = offsets.map(x => {
    const flip = x + labelWidth > trackWidth && x > trackWidth - x;
    const width = Math.min(labelWidth, flip ? x : trackWidth - x);
    return { flip, width, start: flip ? x - width : x, lane: 0 };
  });
  const order = [...boxes.filter(box => !box.flip).reverse(), ...boxes.filter(box => box.flip)];
  order.forEach((box, i) => {
    const hit = order.slice(0, i).filter(other => other.start < box.start + box.width + gap && box.start < other.start + other.width + gap);
    box.lane = hit.length ? Math.max(...hit.map(other => other.lane)) + 1 : 0;
  });
  return boxes.map(({ flip, width, lane }) => ({ flip, width, lane }));
}

/**
 * Marcas de año de la línea de tiempo: cada enero, saltándose las que no dejan `minGap` px con
 * la anterior (en un móvil caben unas de cada dos). El año del primer mes sólo va si le queda
 * sitio antes del primer enero: un 2018 de dos meses no debe echar al 2019.
 */
export function yearTicks(months: string[], trackWidth: number, minGap: number) {
  const pxPerMonth = trackWidth / months.length;
  const january = months.findIndex(month => month.endsWith('-01'));
  const ticks: { index: number; label: string }[] = [];
  months.forEach((month, index) => {
    const first = index === 0 && (january < 0 || january * pxPerMonth >= minGap);
    if (!first && !month.endsWith('-01')) return;
    const previous = ticks.at(-1);
    if (!previous || (index - previous.index) * pxPerMonth >= minGap) ticks.push({ index, label: month.slice(0, 4) });
  });
  return ticks;
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
