import { Hono } from 'hono';
import { dbRead } from '../db/read-pool.js';
import type { AppVariables } from '../app.js';

const exportRoute = new Hono<{ Variables: AppVariables }>();

exportRoute.get('/', async (c) => {
  const isCsv = c.req.query('format') === 'csv';
  const body = await dbRead('getExportBody', c.get('userId'), isCsv ? 'csv' : 'json');

  c.header('Content-Type', isCsv ? 'text/csv' : 'application/json');
  c.header('Content-Disposition', `attachment; filename="sis-export.${isCsv ? 'csv' : 'json'}"`);
  return c.body(body);
});

export default exportRoute;
