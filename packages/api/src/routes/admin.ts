// Composición de los sub-routers de /admin:
// - merges.ts: reglas de merge (CRUD, preview, batch, suggestions)
// - users.ts:  CRUD de usuarios (requiere isAdmin)
// - tracks.ts: mantenimiento puntual de tracks (corregir duraciones)

import { Hono } from 'hono';
import type { AppVariables } from '../app.js';
import merges from './admin/merges.js';
import users from './admin/users.js';
import tracks from './admin/tracks.js';

const admin = new Hono<{ Variables: AppVariables }>();

admin.route('/', merges);
admin.route('/', users);
admin.route('/', tracks);

export default admin;
