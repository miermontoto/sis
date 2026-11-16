import { MediaQuery } from 'svelte/reactivity';

// layout móvil: la misma query que el @media (max-width: 768px) de app.css. Una sola
// instancia para toda la app (el layout para la barra nativa, las filas para decidir qué
// marcas pintan): el css esconde, pero lo que además pide datos o monta listeners por fila
// tiene que saberlo en js para no montarlo
export const MOBILE_QUERY = '(max-width: 768px)';

export const mobileLayout = new MediaQuery(MOBILE_QUERY);
