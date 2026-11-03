import adapter from '@sveltejs/adapter-static';
import { appVersion } from '@platform/config/version';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      fallback: '200.html',
    }),
    // misma versión que la api: `version` de $app/environment, con la que la telemetría de
    // cliente etiqueta cada error y traza con el build que lo produjo
    version: { name: appVersion() },
  },
};

export default config;
