// ciclo de unidades de una cifra de tiempo: se pulsa la tarjeta y la cifra pasa
// a la siguiente unidad (min → h → d → sem → mes → año). el estado es por vista
// a propósito, no se recuerda entre páginas ni entre recargas.
// la unidad inicial es la que ya pintaba cada tarjeta: `formatDuration` es
// exactamente `formatDurationAs(ms, 'minutes')` y `formatHours` lo mismo con
// 'hours', así que adoptar el ciclo no cambia lo que se ve de entrada
import { DURATION_UNITS, durationRoundsToZero, formatDurationAs, type DurationUnit } from './format';

export function createDurationUnit(initial: DurationUnit) {
  let unit = $state<DurationUnit>(initial);

  // las demás unidades en orden de ciclo desde la actual, saltándose las que
  // dejan la cifra en cero: un total de 40 minutos no tiene nada que decir en
  // semanas ("0.0w") y una media diaria menos aún en años ("0.00y")
  const candidates = (ms: number) =>
    DURATION_UNITS
      .map((_, i) => DURATION_UNITS[(DURATION_UNITS.indexOf(unit) + 1 + i) % DURATION_UNITS.length])
      .filter(u => u !== unit && !durationRoundsToZero(ms, u));

  return {
    get unit() { return unit; },
    /** ¿queda alguna unidad que no deje la cifra en cero? si no, la tarjeta no se pulsa */
    canCycle: (ms: number) => candidates(ms).length > 0,
    next: (ms: number) => { const [next] = candidates(ms); if (next) unit = next; },
    format: (ms: number) => formatDurationAs(ms, unit),
  };
}
