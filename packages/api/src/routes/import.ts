import { readFileSync } from 'fs';
import { Hono } from 'hono';
import { importHistory, type ImportResult } from '../services/history-import.js';
import type { AppVariables } from '../app.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('import');
const importRoute = new Hono<{ Variables: AppVariables }>();

importRoute.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.parseBody({ all: true });
  const files = body['files'];

  if (!files) {
    return c.json({ error: 'no se recibieron archivos' }, 400);
  }

  // normalizar a array (puede ser un solo archivo o varios)
  const fileList = Array.isArray(files) ? files : [files];
  const jsonFiles = fileList.filter((f): f is File => f instanceof File && f.name.endsWith('.json'));

  if (jsonFiles.length === 0) {
    return c.json({ error: 'no se recibieron archivos .json válidos' }, 400);
  }

  const aggregated: ImportResult = { total: 0, imported: 0, duplicates: 0, skipped: 0 };

  for (const file of jsonFiles) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const result = importHistory(data, userId);
      aggregated.total += result.total;
      aggregated.imported += result.imported;
      aggregated.duplicates += result.duplicates;
      aggregated.skipped += result.skipped;
    } catch (err) {
      log.error(`error procesando ${file.name}:`, err);
      return c.json({ error: `error procesando ${file.name}: ${(err as Error).message}` }, 400);
    }
  }

  return c.json(aggregated);
});

importRoute.post('/file', async (c) => {
  const userId = c.get('userId');
  const { path } = await c.req.json<{ path: string }>();

  if (!path) {
    return c.json({ error: 'se requiere un path al archivo' }, 400);
  }

  try {
    log.info(`leyendo archivo: ${path}`);
    const text = readFileSync(path, 'utf-8');
    const data = JSON.parse(text);
    const result = importHistory(data, userId);
    return c.json(result);
  } catch (err) {
    log.error(`error procesando ${path}:`, err);
    return c.json({ error: `error procesando archivo: ${(err as Error).message}` }, 400);
  }
});

export default importRoute;
