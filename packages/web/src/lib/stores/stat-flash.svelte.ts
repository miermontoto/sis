// Marcas transitorias "esto acaba de cambiar en vivo", por id de entidad. Son
// dos, con el mismo temporizador porque cuentan lo mismo desde ángulos
// distintos:
//
//   - flash: la CIFRA de la entidad acaba de cambiar. El parpadeo lo hace el
//     CSS (.stat-flash, en app.css).
//   - move: la entidad acaba de cambiar de PUESTO en una lista reordenada en
//     vivo (+n = ha subido n). Lo pinta RankChange con `live`.
//
// Una fila puede tener una sin la otra: sumar un play sin adelantar a nadie es
// sólo flash, y ser adelantada por otra es sólo move.
//
// Es un store global y no una prop porque los mismos ids se pintan en sitios
// muy distintos a la vez — la fila del top, la del chart, la tracklist de un
// álbum, la lista del dashboard — y todos tienen que reaccionar sin encadenar
// props por media app. Los componentes preguntan por id, igual que ya hacen con
// nowPlayingStore para pintarse como "live".

// 3 parpadeos de 350 ms. Tiene que cuadrar con las animaciones de app.css
// (.stat-flash y .rank-change--live): es este temporizador el que retira la
// marca, así que si allí cambia la duración o el número de ciclos, aquí también
const FLASH_CYCLE_MS = 350;
const FLASH_CYCLES = 3;
const FLASH_MS = FLASH_CYCLE_MS * FLASH_CYCLES;

let _flashing = $state<ReadonlySet<string>>(new Set());
let _moves = $state<ReadonlyMap<string, number>>(new Map());

const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
const moveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// si la marca se renueva antes de acabar, se reinicia la cuenta: la animación
// en curso sigue su ciclo, pero la marca no se retira a medias
function schedule(timers: Map<string, ReturnType<typeof setTimeout>>, id: string, clear: (id: string) => void): void {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    clear(id);
  }, FLASH_MS));
}

function flash(ids: (string | null | undefined)[]): void {
  const valid = ids.filter((id): id is string => !!id);
  if (valid.length === 0) return;

  const next = new Set(_flashing);
  for (const id of valid) {
    next.add(id);
    schedule(flashTimers, id, (done) => {
      const after = new Set(_flashing);
      after.delete(done);
      _flashing = after;
    });
  }
  _flashing = next;
}

// deltas de un reordenamiento en vivo, tal cual los devuelve rankMoves
function move(deltas: ReadonlyMap<string, number>): void {
  if (deltas.size === 0) return;

  const next = new Map(_moves);
  for (const [id, delta] of deltas) {
    next.set(id, delta);
    schedule(moveTimers, id, (done) => {
      const after = new Map(_moves);
      after.delete(done);
      _moves = after;
    });
  }
  _moves = next;
}

export const statFlashStore = {
  isFlashing: (id: string | null | undefined): boolean => !!id && _flashing.has(id),
  moveOf: (id: string | null | undefined): number | null => (id ? _moves.get(id) ?? null : null),
  flash,
  move,
};
