// exporta las capturas de tienda a png con el renderer compartido de platform (tooling/store):
// sirve assets/store, captura cada entrada del manifiesto (window.STORE.manifest) a su tamaño y
// escala de tienda y la valida contra las specs de app store / google play.
// uso: node assets/store/render.mjs [filtro-de-ruta] [--out <dir>]   (CHROME_PATH / CDP_PORT opcionales)
//      node assets/store/render.mjs --check   (valida los png ya exportados)
//      node assets/store/render.mjs --serve   (solo sirve la galería, para revisarla en un navegador)
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStore } from '../../platform/tooling/store/render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// puerto de depuración de chromium: CDP_PORT lo cambia para no chocar con otro export en marcha.
// las fuentes (inter + jetbrains mono) llegan de google fonts como en el artifact
renderStore({ dir: HERE, port: 9472, fonts: { families: ['Inter', 'JetBrains Mono'] } });
