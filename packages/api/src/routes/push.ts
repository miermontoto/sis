import { Hono } from 'hono';
import type { AppVariables } from '../app.js';

const push = new Hono<{ Variables: AppVariables }>();

// clave pública VAPID para que el cliente web se suscriba al push.
// vacía si no hay creds configuradas → el cliente omite el registro web.
push.get('/vapid-public-key', (c) => {
  return c.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

export default push;
