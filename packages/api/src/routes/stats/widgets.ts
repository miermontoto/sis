// endpoints que sólo existen para widgets del dashboard (web/lib/widgets):
// - memories:     tal día como hoy en años anteriores + aniversarios del día
// - discoveries:  estrenos de un rango (lo nuevo para el usuario), en la forma de top-*
import { toWallTime } from '@sis/shared';
import { dbRead } from '../../db/read-pool.js';
import { statsRouter, parseCalendar, parseParams, parseSort } from './_shared.js';

const widgets = statsRouter();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DISCOVERIES = 50;

// la fecha la manda el cliente (su "hoy" local) para que la cache del cliente lleve el
// día en la clave; sin ella, el hoy de la zona guardada del usuario
widgets.get('/memories', async (c) => {
  const userId = c.get('userId');
  const { timeZone } = parseCalendar(c);
  const raw = c.req.query('date');
  const date = raw && DATE_PATTERN.test(raw) ? raw : new Date(toWallTime(timeZone, Date.now())).toISOString().slice(0, 10);
  return c.json(await dbRead('getMemories', userId, date, timeZone));
});

widgets.get('/discoveries', async (c) => {
  const userId = c.get('userId');
  const { limit, rangeStart, rangeEnd } = parseParams(c);
  const type = c.req.query('type');
  const entityType = type === 'album' || type === 'track' ? type : 'artist';
  // "nuevo" se mide contra lo anterior al rango: sin inicio (all time) todo lo sería
  if (!rangeStart) return c.json([]);
  // getNewEntities cierra el rango con `<`; el de parseParams es inclusivo o abierto
  const end = rangeEnd ? new Date(Date.parse(rangeEnd) + 1).toISOString() : new Date(Date.now() + 1000).toISOString();
  const rows = await dbRead('getNewEntities', entityType, userId, rangeStart, end, parseSort(c), Math.min(limit, MAX_DISCOVERIES));
  if (entityType === 'track') return c.json(await dbRead('formatTopTrackRows', rows, userId));
  if (entityType === 'album') return c.json(await Promise.all(rows.map(row => dbRead('formatTopAlbumRow', row, userId))));
  return c.json(await Promise.all(rows.map(row => dbRead('formatTopArtistRow', row))));
});

export default widgets;
