// action svelte para textos de una línea que no caben en su caja: mide el
// desborde y, solo si lo hay, activa el vaivén de `.marquee-line` (app.css).
// El nodo recorta y difumina los bordes; su único hijo es el que se mueve.
//
// El desplazamiento es exactamente lo que sobra (`--marquee-shift`), no el
// ancho entero: el título se lee desde el primer frame en vez de entrar desde
// la derecha con la fila vacía media animación. La duración sale de esa misma
// cifra, así que la velocidad es constante y un título largo no pasa más
// rápido que uno corto.
//
// El parámetro es la dependencia que fuerza la remedida (el texto pintado):
// svelte llama a update() cuando cambia.

const MARQUEE_CLASS = 'is-marquee';
// px por segundo del tramo en movimiento
const SPEED_PX_S = 30;
// suelo de duración: un desborde de pocos px no debe ir y volver a tirones
const MIN_MS = 3_500;
// parte de la animación que pasa moviéndose; el resto son las pausas en cada
// extremo. Tiene que casar con los tramos del @keyframes marquee de app.css
const SCROLL_FRACTION = 0.7;

export function marquee(node: HTMLElement, _dep?: unknown) {
  let frame = 0;

  const measure = () => {
    cancelAnimationFrame(frame);
    // sin la clase el hijo vuelve a su ancho natural, que es lo que hay que
    // comparar: con ella el transform ya está aplicado y la medida miente
    node.classList.remove(MARQUEE_CLASS);
    frame = requestAnimationFrame(() => {
      const overflowPx = node.scrollWidth - node.clientWidth;
      if (overflowPx <= 0) return;
      const ms = Math.max(MIN_MS, (overflowPx / SPEED_PX_S) * 1000 / SCROLL_FRACTION);
      node.style.setProperty('--marquee-shift', `${-overflowPx}px`);
      node.style.setProperty('--marquee-ms', `${Math.round(ms)}ms`);
      node.classList.add(MARQUEE_CLASS);
    });
  };

  measure();
  // el ancho del sidebar cambia (colapsar el rail, redimensionar la ventana) y
  // con él lo que desborda
  const ro = new ResizeObserver(measure);
  ro.observe(node);

  return {
    update: measure,
    destroy: () => { cancelAnimationFrame(frame); ro.disconnect(); },
  };
}
