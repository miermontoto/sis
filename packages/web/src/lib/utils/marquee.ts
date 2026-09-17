// action svelte para textos de una línea que no caben en su caja: mide el
// desborde y, solo si lo hay, activa el marquee clásico de `.marquee-line`
// (app.css): el texto entra por la derecha, cruza hacia la izquierda y vuelve
// a empezar. El nodo recorta y difumina los bordes; su único hijo es el que se
// mueve.
//
// La duración sale del recorrido real (ancho de la caja + ancho del texto), así
// que la velocidad es constante y un título largo no pasa más rápido que uno
// corto.
//
// El parámetro es la dependencia que fuerza la remedida (el texto pintado):
// svelte llama a update() cuando cambia.

const MARQUEE_CLASS = 'is-marquee';
// px por segundo del recorrido
const SPEED_PX_S = 40;

export function marquee(node: HTMLElement, _dep?: unknown) {
  let frame = 0;

  const measure = () => {
    cancelAnimationFrame(frame);
    // sin la clase el hijo vuelve a su ancho natural, que es lo que hay que
    // comparar: con ella el padding y el transform ya están aplicados y la
    // medida miente
    node.classList.remove(MARQUEE_CLASS);
    frame = requestAnimationFrame(() => {
      const textPx = node.scrollWidth;
      const boxPx = node.clientWidth;
      if (textPx <= boxPx) return;
      // el hijo lleva padding-left del 100% de la caja y se desplaza -100% de
      // sí mismo (ver app.css), así que recorre caja + texto por vuelta
      const ms = ((boxPx + textPx) / SPEED_PX_S) * 1000;
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
