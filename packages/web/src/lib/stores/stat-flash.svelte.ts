// Marca transitoria "esta cifra acaba de cambiar", por id de entidad. El
// parpadeo lo hace el CSS (.stat-flash, en app.css); aquí sólo se lleva quién
// está marcado y durante cuánto.
//
// Es un store global y no una prop porque los mismos ids se pintan en sitios
// muy distintos a la vez — la fila del top, la del chart, la tracklist de un
// álbum, la lista del dashboard — y todos tienen que parpadear sin encadenar
// props por media app. Los componentes preguntan por id, igual que ya hacen con
// nowPlayingStore para pintarse como "live".

// 6 parpadeos de 350 ms. Tiene que cuadrar con la animación de app.css: es este
// temporizador el que retira la marca, así que si allí cambia la duración o el
// número de ciclos, aquí también
const FLASH_CYCLE_MS = 350;
const FLASH_CYCLES = 6;
const FLASH_MS = FLASH_CYCLE_MS * FLASH_CYCLES;

let _flashing = $state<ReadonlySet<string>>(new Set());
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function flash(ids: (string | null | undefined)[]): void {
  const valid = ids.filter((id): id is string => !!id);
  if (valid.length === 0) return;

  const next = new Set(_flashing);
  for (const id of valid) {
    next.add(id);
    // si la cifra vuelve a cambiar antes de acabar, se reinicia la cuenta: la
    // animación en curso sigue su ciclo, pero la marca no se retira a medias
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      const after = new Set(_flashing);
      after.delete(id);
      _flashing = after;
    }, FLASH_MS));
  }
  _flashing = next;
}

export const statFlashStore = {
  isFlashing: (id: string | null | undefined): boolean => !!id && _flashing.has(id),
  flash,
};
