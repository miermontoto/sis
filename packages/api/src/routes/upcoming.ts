// álbumes que vienen (services/upcoming-albums.ts): el usuario pega el enlace de spotify
// de un álbum anunciado y sus singles pasan a rankear como él hasta que sale. Spotify no
// lista esos álbumes en ningún sitio, así que el enlace es la vía exacta; el barrido de
// fondo cubre el resto con las preventas de iTunes.
import { Hono } from 'hono';
import type { AppVariables } from '../app.js';
import { linkUpcomingAlbum } from '../services/upcoming-albums.js';

const upcoming = new Hono<{ Variables: AppVariables }>();

upcoming.post('/', async (c) => {
  const body = await c.req.json<{ url?: unknown }>().catch(() => null);
  if (!body || typeof body.url !== 'string' || !body.url.trim()) return c.json({ error: 'url is required' }, 400);

  const outcome = await linkUpcomingAlbum(c.get('userId'), body.url);
  return 'error' in outcome ? c.json({ error: outcome.error }, outcome.status) : c.json(outcome.result, 201);
});

export default upcoming;
