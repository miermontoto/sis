// action: oculta las filas que no caben enteras en la caja del contenedor. Un widget
// tiene un alto fijo (sus filas de rejilla) que cambia con el ancho de la pantalla,
// así que pedir un número fijo de filas dejaba una cortada al pie o un hueco: el
// widget pide un máximo y esto recorta a las que caben. `selector` localiza la
// lista dentro del nodo cuando la pinta un componente ajeno (TrackList); sus hijos
// directos son las filas. Los observers cubren el cambio de tamaño y el de datos
export function fitRows(node: HTMLElement, selector?: string) {
  let sel = selector;
  let frame = 0;

  const fit = () => {
    frame = 0;
    const list = (sel ? node.querySelector<HTMLElement>(sel) : node) ?? node;
    const rows = [...list.children] as HTMLElement[];
    for (const row of rows) row.hidden = false;
    const box = node.getBoundingClientRect();
    // la primera que se sale y todas las de detrás; siempre queda al menos una. Una
    // lista a varias columnas (multicol con alto fijo) no desborda por abajo sino
    // hacia una columna de más a la derecha: también cuenta como fuera
    const out = (r: DOMRect) => r.bottom > box.bottom + 0.5 || r.right > box.right + 0.5;
    const firstOut = rows.findIndex((row, i) => i > 0 && out(row.getBoundingClientRect()));
    if (firstOut > 0) for (const row of rows.slice(firstOut)) row.hidden = true;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };

  const resize = new ResizeObserver(schedule);
  resize.observe(node);
  // childList: la lista llega tarde (carga) o cambia (play optimista). El hidden que
  // pone fit no es childList, así que no se realimenta
  const mutations = new MutationObserver(schedule);
  mutations.observe(node, { childList: true, subtree: true });
  schedule();

  return {
    update(next?: string) { sel = next; schedule(); },
    destroy() {
      resize.disconnect();
      mutations.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
