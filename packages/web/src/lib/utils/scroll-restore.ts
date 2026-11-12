import type { AfterNavigate, BeforeNavigate } from '@sveltejs/kit';

// restauración del scroll al volver atrás/adelante. SvelteKit ya guarda la
// posición de cada entrada del historial y la aplica al terminar la navegación,
// pero en ese instante las vistas sólo pintan su spinner (todas piden los datos
// en un efecto), así que el documento es más corto que la posición guardada, el
// scrollTo se queda en 0 y nadie vuelve a intentarlo cuando llegan los datos

// cuánto se persigue la posición guardada mientras la vista carga y se asienta
const SCROLL_RESTORE_TIMEOUT_MS = 5000;
// margen de redondeo del scroll en pantallas con device pixel ratio fraccionario
const SCROLL_EPSILON_PX = 1;
// gestos con los que el usuario toma el scroll: a partir de ahí no se le pisa
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

type NavigationHooks = {
  beforeNavigate: (fn: (nav: BeforeNavigate) => void) => void;
  afterNavigate: (fn: (nav: AfterNavigate) => void) => void;
};

/** Persigue `y` en cada cambio de alto del documento hasta agotar el tiempo o que el usuario mueva el scroll */
function chaseScroll(y: number): () => void {
  // scrollTo recorta al alto actual: con la vista a medio cargar baja todo lo que
  // puede, y eso también acerca el sentinel de los scrolls infinitos (/top,
  // /history), que piden su página siguiente y vuelven a disparar el observer.
  // se sigue fijando aun alcanzada la posición: lo que crece por encima (gráficas,
  // carátulas) empujaría el contenido, y la posición guardada es la del layout final
  const observer = new ResizeObserver(() => window.scrollTo(window.scrollX, y));
  const timer = setTimeout(() => stop(), SCROLL_RESTORE_TIMEOUT_MS);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    USER_SCROLL_EVENTS.forEach(type => window.removeEventListener(type, stop));
  };
  USER_SCROLL_EVENTS.forEach(type => window.addEventListener(type, stop, { passive: true }));
  observer.observe(document.body);
  return stop;
}

/** Registra la restauración diferida del scroll; se llama una vez desde el layout raíz */
export function restoreScrollOnPopstate({ beforeNavigate, afterNavigate }: NavigationHooks): void {
  let target: number | null = null;
  let stop: (() => void) | null = null;

  // la posición guardada sólo viaja en el `to` de beforeNavigate: al llegar a
  // afterNavigate SvelteKit ya la ha sobrescrito con la real (la recortada)
  beforeNavigate(nav => {
    stop?.();
    stop = null;
    target = nav.type === 'popstate' ? nav.to?.scroll?.y ?? null : null;
  });

  afterNavigate(() => {
    const y = target;
    target = null;
    if (!y || window.scrollY >= y - SCROLL_EPSILON_PX) return;
    stop = chaseScroll(y);
  });
}
