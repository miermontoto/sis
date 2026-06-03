// Composición de los sub-routers de /playlists:
// - library.ts:   biblioteca de Spotify sincronizada (V2)
// - generated.ts: playlists generadas por estrategias (V1)
//
// IMPORTANTE: library debe montarse antes que generated; las rutas /:id
// en generated son catch-all y eclipsarían /library, /library/sync, etc.

import { Hono } from 'hono';
import type { AppVariables } from '../app.js';
import library from './playlists/library.js';
import generated from './playlists/generated.js';

const playlists = new Hono<{ Variables: AppVariables }>();

playlists.route('/', library);
playlists.route('/', generated);

export default playlists;
