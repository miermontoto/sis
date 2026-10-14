// contendiente = posición en el orden del sorteo (0 = primero del bombo): los
// motores no saben de artistas ni de métricas, solo de posiciones
export type Slot = number | null;

export interface Match {
  a: number;
  b: number;
  // fase legible del enfrentamiento ("Sweet 16", "Group B · Matchday 2")
  label: string;
  // contexto de cada lado (récord, derrotas, racha), alineado con a/b
  notes?: [string, string];
}

export interface Played extends Match {
  winner: number;
}

// un partido en el tablero: null = por decidir, o bye si el cruce ya está cerrado
export interface BoardMatch {
  a: Slot;
  b: Slot;
  winner: Slot;
}

export interface BracketColumn {
  label: string;
  matches: BoardMatch[];
}

export interface BracketBlock {
  kind: 'bracket';
  title: string;
  columns: BracketColumn[];
  // los sub-cuadros de la doble eliminación no coronan a nadie
  crowns: boolean;
  champion: Slot;
}

export interface TableRow {
  c: number;
  cells: string[];
  qualified: boolean;
}

export interface Table {
  title: string;
  rows: TableRow[];
}

export interface TablesBlock {
  kind: 'tables';
  title: string;
  headers: string[];
  tables: Table[];
}

// partidos en orden cronológico, sin estructura de cuadro (rey de la pista)
export interface ListBlock {
  kind: 'list';
  title: string;
  matches: BoardMatch[];
}

export type Block = BracketBlock | TablesBlock | ListBlock;

export interface Outcome {
  champion: Slot;
  runnerUp: Slot;
}

export interface Spec {
  n: number;
  // tamaño del playoff tras el suizo (0 = sin playoff)
  playoffCut: number;
}

export type FormatId = 'knockout' | 'double' | 'groups' | 'swiss' | 'koth';

// un formato es un procedimiento de torneo escrito de corrido: cede cada
// enfrentamiento con yield y recibe al ganador. Rellena `board` sobre la marcha,
// así que al pararse en un partido pendiente el tablero ya refleja lo jugado
export interface TournamentFormat {
  id: FormatId;
  label: string;
  // cómo se llama su tablero en la ui ("bracket", "standings"…)
  board: string;
  minEntries: number;
  // bombo de cada posición del ranking para el sorteo por bombos
  tierOf(i: number, n: number): number;
  // huecos vacíos del cuadro (solo los formatos de cuadro los tienen)
  byes(n: number): number;
  describe(spec: Spec): string;
  run(spec: Spec, board: Block[]): Generator<Match, Outcome, number>;
}
