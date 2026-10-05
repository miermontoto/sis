// tema claro/oscuro de la interfaz, por dispositivo: vive en localStorage y no
// viaja con los ajustes del usuario (el móvil y el escritorio pueden llevar cada
// uno el suyo). 'system' sigue a prefers-color-scheme y es el default.
//
// el primer pintado lo decide el script inline de app.html, con la misma clave y
// la misma regla, antes de que cargue nada: sin él la página arrancaría oscura y
// saltaría a clara. este store toma el relevo para cambiarlo en caliente y para
// seguir al sistema con la app abierta. el tema resuelto vive en <html data-theme>,
// que es lo que leen app.css y las system bars del apk (observeSystemBars observa
// ese atributo y repinta las barras sola).

export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

// la misma clave y la misma media query que el script inline de app.html
const STORAGE_KEY = 'sis:theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';
const DEFAULT_PREFERENCE: ThemePreference = 'system';

/**
 * réplica en js de los tokens de app.css que pinta un canvas (echarts): el canvas
 * no lee custom properties, así que cada tema repite aquí sus valores. tiene que
 * casar con `:root` y `:root[data-theme='light']`. `fg` es el canal rgb de los
 * trazos translúcidos (`rgba(${fg}, a)`): blanco sobre oscuro, tinta sobre claro.
 * `heat` es la rampa de los heatmaps, del fondo de la tarjeta al verde.
 */
export interface CanvasPalette {
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  sunken: string;
  placeholder: string;
  fg: string;
  heat: readonly string[];
}

const CANVAS_PALETTES: Record<Theme, CanvasPalette> = {
  dark: {
    bg: '#080a0c',
    card: '#0f1214',
    border: '#1e2a2a',
    text: '#e0e8e8',
    muted: '#6a7a7a',
    faint: '#4a5a5a',
    sunken: '#162020',
    placeholder: '#1e2a2a',
    fg: '255, 255, 255',
    heat: ['#0f1214', '#0d3320', '#1a6b3f', '#1db954'],
  },
  light: {
    bg: '#f3f6f6',
    card: '#ffffff',
    border: '#d5dfdf',
    text: '#0d1414',
    muted: '#5a6b6b',
    faint: '#8a9999',
    sunken: '#eef3f3',
    placeholder: '#e3eaea',
    fg: '13, 20, 20',
    heat: ['#ffffff', '#cdeedb', '#6fd197', '#1db954'],
  },
};

const isPreference = (value: unknown): value is ThemePreference =>
  THEME_PREFERENCES.includes(value as ThemePreference);

class ThemeStore {
  #preference = $state<ThemePreference>(DEFAULT_PREFERENCE);
  #systemLight = $state(false);

  readonly resolved: Theme = $derived(
    this.#preference === 'system' ? (this.#systemLight ? 'light' : 'dark') : this.#preference,
  );

  constructor() {
    // fuera del navegador (tests, build) se queda en oscuro, que es el tema base de app.css
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(LIGHT_QUERY);
    this.#systemLight = media.matches;
    this.#preference = this.#read();
    media.addEventListener('change', (e) => {
      this.#systemLight = e.matches;
      this.#apply();
    });
    // otra pestaña cambió el tema: se sigue sin recargar
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      this.#preference = this.#read();
      this.#apply();
    });
    this.#apply();
  }

  get preference(): ThemePreference {
    return this.#preference;
  }

  set preference(value: ThemePreference) {
    this.#preference = value;
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // sin storage (modo privado estricto) el cambio dura lo que la pestaña
    }
    this.#apply();
  }

  /** colores del tema activo para lo que pinta un canvas; leerlo dentro de un $derived lo suscribe al tema */
  get palette(): CanvasPalette {
    return CANVAS_PALETTES[this.resolved];
  }

  #read(): ThemePreference {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return isPreference(stored) ? stored : DEFAULT_PREFERENCE;
    } catch {
      return DEFAULT_PREFERENCE;
    }
  }

  // escribe el tema en <html> y tiñe la barra del navegador con el --bg resultante
  #apply(): void {
    const root = document.documentElement;
    root.dataset.theme = this.resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
  }
}

export const themeStore = new ThemeStore();

/** atajo de `themeStore.palette` para las opciones de echarts y los helpers de chart.ts */
export const canvasColors = (): CanvasPalette => themeStore.palette;
