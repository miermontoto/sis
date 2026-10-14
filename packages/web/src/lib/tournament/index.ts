import { doubleFormat } from './double';
import { groupsFormat } from './groups';
import { knockoutFormat } from './knockout';
import { kothFormat } from './koth';
import { swissFormat } from './swiss';
import type { FormatId, TournamentFormat } from './types';

// el orden de las claves es el de los botones de la ui
export const FORMATS: Record<FormatId, TournamentFormat> = {
  knockout: knockoutFormat,
  double: doubleFormat,
  groups: groupsFormat,
  swiss: swissFormat,
  koth: kothFormat,
};

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

export * from './types';
export { nextPow2, roundName, seedOrder } from './bracket';
export { DRAW_MODES, drawOrder, type DrawMode } from './draw';
export { groupCount, roundRobin } from './groups';
export { replay, upsets, type Replay, type Upset } from './replay';
export { maxPlayoffCut, pairSwiss, PLAYOFF_CUTS, swissRounds } from './swiss';
