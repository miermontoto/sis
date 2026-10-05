// Logger con niveles y scope. Sustituye a los console.* sueltos: el prefijo `[scope]`
// que ya se escribía a mano en cada llamada pasa a ponerlo el propio logger, y el
// nivel permite callar la salida sin tocar código (LOG_LEVEL en el entorno).
//
// El formato de salida es exactamente el de antes —`[scope] mensaje`— para no romper
// los greps sobre los logs del contenedor, y se respeta el canal: info/debug a stdout,
// warn/error a stderr.
//
// La implementación vive ahora en @platform/observability con el mismo contrato: añade
// el trace id de la request activa a cada línea, LOG_FORMAT=json y el export otlp.
export { createLogger, type Logger, type LogLevel } from '@platform/observability';
