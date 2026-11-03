// rum nativo de openobserve (@platform/observability/browser): vistas por ruta, llamadas a la
// api enlazadas con su traza, errores y web vitals, como `sis-web` en la org sis. sale
// por el proxy de la api (VITE_API_BASE en las apps nativas, mismo origen en la web).
import type { HandleClientError } from '@sveltejs/kit';
import { version } from '$app/environment';
import { captureError, initBrowserTelemetry } from '@platform/observability/browser';
import { instanceOrigin } from '$lib/instance';

// una ruta inexistente no es un fallo de la app
const NOT_FOUND = 404;
const SERVICE = 'sis-web';

initBrowserTelemetry({ service: SERVICE, version, apiOrigin: instanceOrigin });

// errores de load y de navegación: sveltekit se los queda y no llegan a window.onerror
export const handleError: HandleClientError = ({ error, status }) => {
  if (status !== NOT_FOUND) captureError(error, { status });
};
