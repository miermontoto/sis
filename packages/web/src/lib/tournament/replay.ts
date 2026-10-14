import type { Block, Match, Outcome, Played, Spec, TournamentFormat } from './types';

export interface Replay {
  pending: Match | null;
  board: Block[];
  log: Played[];
  outcome: Outcome | null;
  total: number;
}

export interface Upset {
  winner: number;
  loser: number;
  label: string;
  // seeds de diferencia: cuánto contradice la elección a los propios datos
  gap: number;
}

// partidos totales: simula lo que falta dando siempre el partido al lado a.
// Byes y rondas no dependen de quién gane; la única excepción, el reset de la
// gran final, entra en la cuenta en cuanto ocurre
export function countMatches(format: TournamentFormat, spec: Spec, winners: number[]): number {
  const it = format.run(spec, []);
  let step = it.next();
  let count = 0;
  while (!step.done) {
    step = it.next(count < winners.length ? winners[count] : step.value.a);
    count++;
  }
  return count;
}

// rejuega el formato desde cero con las elecciones hechas: todo el estado se
// deriva de la lista de ganadores, así que deshacer es quitar el último y no
// hace falta guardar instantáneas. Un ganador que no está en su partido corta
// la repetición ahí
export function replay(format: TournamentFormat, spec: Spec, winners: number[]): Replay {
  const board: Block[] = [];
  const it = format.run(spec, board);
  const log: Played[] = [];
  let step = it.next();
  for (const w of winners) {
    if (step.done || (w !== step.value.a && w !== step.value.b)) break;
    log.push({ ...step.value, winner: w });
    step = it.next(w);
  }
  return {
    pending: step.done ? null : step.value,
    board,
    log,
    outcome: step.done ? step.value : null,
    total: step.done ? log.length : countMatches(format, spec, log.map((p) => p.winner)),
  };
}

// elecciones contra los propios datos: gana el de peor seed (el seed es el
// puesto real por la métrica, no la posición del sorteo)
export const upsets = (log: Played[], seedOf: (c: number) => number): Upset[] =>
  log
    .map((p) => {
      const loser = p.winner === p.a ? p.b : p.a;
      return { winner: p.winner, loser, label: p.label, gap: seedOf(p.winner) - seedOf(loser) };
    })
    .filter((u) => u.gap > 0);
