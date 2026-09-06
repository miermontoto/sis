// action svelte que posiciona un popover `position: fixed` respecto a su ancla
// (el elemento padre), evitando que se salga del viewport o lo recorte el
// overflow de un ancestro. por defecto (`above`) prefiere colocarse encima del
// ancla y cae debajo si no hay hueco, alineando el borde derecho del popover con
// el del ancla; `right` lo pone a la derecha del ancla alineado arriba
// (desplegables laterales del nav compacto). en ambos casos clampa al viewport,
// y reposiciona en scroll/resize y ante cambios de tamaño del propio popover
// (contenido asíncrono, filtrado de búsqueda) mientras esté montado.
const GAP = 4; // separación entre ancla y popover
const PAD = 8; // margen mínimo a los bordes del viewport

export type PopoverSide = 'above' | 'right';

export function positionPopover(node: HTMLElement, side: PopoverSide = 'above') {
  const anchor = node.parentElement;
  if (!anchor) return;

  function place() {
    const a = anchor!.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let top: number;
    let left: number;

    if (side === 'right') {
      // pegado al borde derecho del ancla, sin GAP: el hueco visual lo pone el
      // padding del propio popover, que así hace de puente para el hover (si
      // hubiera un hueco real el puntero saldría del ancla al cruzarlo)
      top = Math.max(PAD, Math.min(a.top, vh - h - PAD));
      left = Math.min(a.right, vw - w - PAD);
    } else {
      // vertical: encima si cabe, si no debajo, clampado al viewport
      top = a.top - GAP - h;
      if (top < PAD) {
        const below = a.bottom + GAP;
        top = below + h <= vh - PAD ? below : Math.max(PAD, vh - h - PAD);
      }

      // horizontal: alineado a la derecha del ancla y clampado al viewport
      left = Math.max(PAD, Math.min(a.right - w, vw - w - PAD));
    }

    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(left)}px`;
  }

  place();
  // capture:true para captar scroll de cualquier contenedor, no solo window
  window.addEventListener('scroll', place, { passive: true, capture: true });
  window.addEventListener('resize', place, { passive: true });
  // el contenido puede crecer tras montar (carga perezosa, búsqueda): recolocar
  // cuando cambie el tamaño. place() sólo escribe top/left, así que no realimenta
  const ro = new ResizeObserver(place);
  ro.observe(node);

  return {
    update(next: PopoverSide) {
      side = next;
      place();
    },
    destroy() {
      ro.disconnect();
      window.removeEventListener('scroll', place, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', place);
    },
  };
}
