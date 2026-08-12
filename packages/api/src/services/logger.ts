// Logger con niveles y scope. Sustituye a los console.* sueltos: el prefijo `[scope]`
// que ya se escribía a mano en cada llamada pasa a ponerlo el propio logger, y el
// nivel permite callar la salida sin tocar código (LOG_LEVEL en el entorno).
//
// El formato de salida es exactamente el de antes —`[scope] mensaje`— para no romper
// los greps sobre los logs del contenedor, y se respeta el canal: info/debug a stdout,
// warn/error a stderr.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

export type LogLevel = keyof typeof LEVELS;

const DEFAULT_LEVEL: LogLevel = 'info';

function resolveThreshold(): number {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  // un LOG_LEVEL inválido no debe dejar el proceso mudo: cae al nivel por defecto
  return LEVELS[raw as LogLevel] ?? LEVELS[DEFAULT_LEVEL];
}

// se lee una vez al cargar el módulo: el nivel no cambia en caliente
const threshold = resolveThreshold();

export interface Logger {
  /** ruido de cada ciclo (polling, cache hits): oculto salvo LOG_LEVEL=debug */
  debug(...args: unknown[]): void;
  /** eventos que interesan en operación normal (arranque, totales de un job) */
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** sub-scope por entidad: createLogger('poll').child(userId) escribe `[poll:12]` */
  child(suffix: string | number): Logger;
}

export function createLogger(scope: string): Logger {
  const tag = `[${scope}]`;
  const emit = (level: LogLevel, sink: (...a: unknown[]) => void) =>
    LEVELS[level] < threshold
      ? () => {}
      : (...args: unknown[]) => sink(tag, ...args);

  return {
    debug: emit('debug', console.log),
    info: emit('info', console.log),
    warn: emit('warn', console.warn),
    error: emit('error', console.error),
    child: (suffix) => createLogger(`${scope}:${suffix}`),
  };
}
