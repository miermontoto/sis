// navegación de la app, en un solo sitio: la lee el sidebar y la barra móvil del
// layout, y el buscador (⌘K) para saltar a una página por nombre. Un item con
// `mobileHidden` no sale en las pestañas móviles; un grupo con `desktopHidden`, no
// en el sidebar (el feed entra por el contenedor de friends)

export interface NavItem {
  href: string;
  label: string;
  // glifo monospace del sidebar (no hay iconos svg para las páginas)
  icon: string;
  mobileHidden?: true;
}

export interface NavGroup {
  label: string;
  // sf symbol de la barra nativa de ios (sólo símbolos de ios <= 15)
  symbol: string;
  desktopHidden?: true;
  items: NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  // el dashboard es también el logo de la cabecera; history estuvo fuera del nav
  // (sólo enlaces del dashboard y el atajo `h`) hasta 2026-10-23, cuando el nav
  // compacto dejó de hacer falta ahorrar la fila
  {
    label: 'Listen',
    symbol: 'house',
    items: [
      { href: '/', label: 'Dashboard', icon: '~' },
      { href: '/history', label: 'History', icon: '#' },
    ],
  },
  {
    label: 'Stats',
    symbol: 'chart.bar',
    items: [
      { href: '/top', label: 'Rankings', icon: '*' },
      { href: '/charts', label: 'Charts', icon: '%' },
    ],
  },
  {
    label: 'Highlights',
    symbol: 'star',
    items: [
      { href: '/insights', label: 'Insights', icon: '!' },
      { href: '/records', label: 'Records', icon: '^' },
      { href: '/reports', label: 'Reports', icon: '¶' },
    ],
  },
  {
    label: 'Library',
    symbol: 'square.stack',
    items: [
      { href: '/playlists', label: 'Playlists', icon: '+' },
      { href: '/concerts', label: 'Concerts', icon: '@' },
      { href: '/generators', label: 'Generators', icon: '&' },
    ],
  },
  // el feed entra por el contenedor de friends del sidebar (desktop); en móvil
  // no hay sidebar, así que conserva un tab propio
  {
    label: 'Feed',
    symbol: 'person.2',
    desktopHidden: true,
    items: [
      { href: '/feed', label: 'Feed', icon: '=' },
    ],
  },
];

// páginas a las que se puede saltar desde el buscador: todo el nav más lo que
// cuelga del menú de usuario
export const NAV_PAGES: readonly NavItem[] = [
  ...NAV_GROUPS.flatMap(g => g.items),
  { href: '/settings', label: 'Settings', icon: '⚙' },
];
