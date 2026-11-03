// telemetría de cliente (@platform/observability/browser): errores, web vitals y trazas de
// carga, navegación y fetch hacia la api de la instancia (en el apk, la elegida en /connect).
// sale como servicio `sis-web` en el backend de trazas, con la versión de este bundle.
import type { HandleClientError } from '@sveltejs/kit';
import { version } from '$app/environment';
import { captureError, initBrowserTelemetry } from '@platform/observability/browser';
import { instanceOrigin } from '$lib/instance';

// una ruta inexistente no es un fallo de la app
const NOT_FOUND = 404;

initBrowserTelemetry({ version, apiOrigin: instanceOrigin });

// errores de load y de navegación: sveltekit se los queda y no llegan a window.onerror
export const handleError: HandleClientError = ({ error, status }) => {
  if (status !== NOT_FOUND) captureError(error, { 'http.response.status_code': status });
};
