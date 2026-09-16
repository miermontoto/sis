// ciclo de unidades de una cifra de tiempo: se pulsa la tarjeta y la cifra pasa
// a la siguiente unidad (min → h → d → sem → mes → año). el estado es por vista
// a propósito, no se recuerda entre páginas ni entre recargas.
// la unidad inicial es la que ya pintaba cada tarjeta: `formatDuration` es
// exactamente `formatDurationAs(ms, 'minutes')` y `formatHours` lo mismo con
// 'hours', así que adoptar el ciclo no cambia lo que se ve de entrada
import { DURATION_UNITS, formatDurationAs, type DurationUnit } from './format';

export function createDurationUnit(initial: DurationUnit) {
  let unit = $state<DurationUnit>(initial);

  return {
    get unit() { return unit; },
    next: () => { unit = DURATION_UNITS[(DURATION_UNITS.indexOf(unit) + 1) % DURATION_UNITS.length]; },
    format: (ms: number) => formatDurationAs(ms, unit),
  };
}
