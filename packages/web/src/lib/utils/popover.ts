// action svelte que posiciona un popover `position: fixed` respecto a su ancla
// (el elemento padre), evitando que se salga del viewport o lo recorte el
// overflow de un ancestro. prefiere colocarse encima del ancla y cae debajo si
// no hay hueco; alinea el borde derecho del popover con el del ancla y clampa en
// horizontal. reposiciona en scroll/resize mientras el popover esté montado.
const GAP = 4; // separación entre ancla y popover
const PAD = 8; // margen mínimo a los bordes del viewport

export function positionPopover(node: HTMLElement) {
  const anchor = node.parentElement;
  if (!anchor) return;

  function place() {
    const a = anchor!.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    // vertical: encima si cabe, si no debajo, clampado al viewport
    let top = a.top - GAP - h;
    if (top < PAD) {
      const below = a.bottom + GAP;
      top = below + h <= vh - PAD ? below : Math.max(PAD, vh - h - PAD);
    }

    // horizontal: alineado a la derecha del ancla y clampado al viewport
    let left = a.right - w;
    left = Math.max(PAD, Math.min(left, vw - w - PAD));

    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(left)}px`;
  }

  place();
  // capture:true para captar scroll de cualquier contenedor, no solo window
  window.addEventListener('scroll', place, { passive: true, capture: true });
  window.addEventListener('resize', place, { passive: true });

  return {
    destroy() {
      window.removeEventListener('scroll', place, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', place);
    },
  };
}
