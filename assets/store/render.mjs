// exporta las capturas de tienda a png: sirve assets/store por http, abre chromium headless por cdp
// y captura cada entrada del manifiesto (window.STORE.manifest) a su tamaño y escala de tienda.
// uso: node assets/store/render.mjs [filtro-de-ruta] [--out <dir>]   (CHROME_PATH para otro binario)
//      node assets/store/render.mjs --serve   (solo sirve la galería, para revisarla en un navegador)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..');
// puerto de depuración de chromium: CDP_PORT para no chocar con otro export en marcha
const CDP_PORT = Number(process.env.CDP_PORT ?? 9472);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const SETTLE_MS = 150;

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? resolve(args[outIdx + 1]) : ASSETS;
const filter = args.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1)) ?? '';

// el binario: CHROME_PATH o el chromium que cachea playwright
const findChrome = async () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(base) ? (await readdir(base)).filter((d) => d.startsWith('chromium-')).sort().reverse() : [];
  const hit = dirs.map((d) => join(base, d, 'chrome-linux64/chrome')).find(existsSync);
  if (!hit) throw new Error('chromium no encontrado: define CHROME_PATH');
  return hit;
};

// la página se publica sin esqueleto (lo pone el artifact); aquí se envuelve igual. las fuentes
// (inter + jetbrains mono) llegan de google fonts como en el artifact
const skeleton = (body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${body}</body></html>`;

const serve = () =>
  new Promise((ok) => {
    const srv = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      try {
        if (path === '/') {
          res.writeHead(200, { 'content-type': MIME['.html'] });
          res.end(skeleton(await readFile(join(HERE, 'index.html'), 'utf8')));
          return;
        }
        const file = join(HERE, path);
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch (e) {
        // el favicon lo pide chromium solo; el resto de 404 son rutas mal escritas en la página
        if (path !== '/favicon.ico') console.error(`[store] 404 ${path}: ${e.message}`);
        res.writeHead(404).end();
      }
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });

// cliente cdp mínimo sobre el WebSocket global de node 22
const cdp = async (wsUrl) => {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, ko) => {
    ws.onopen = ok;
    ws.onerror = ko;
  });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, ko } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? ko(new Error(`${msg.error.message}`)) : ok(msg.result);
    } else if (msg.method) {
      waiters.filter((w) => w.method === msg.method).forEach((w) => w.ok(msg.params));
    }
  };
  const send = (method, params = {}) =>
    new Promise((ok, ko) => {
      pending.set(++id, { ok, ko });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method) => new Promise((ok) => waiters.push({ method, ok }));
  return { send, once, close: () => ws.close() };
};

const main = async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  if (args.includes('--serve')) {
    console.log(`galería en ${base}`);
    return;
  }
  const chrome = spawn(await findChrome(), ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json(), () => []);
    }
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('chromium arrancó sin pestaña');
    const c = await cdp(page.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    const evaluate = (expression) => c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result.value);

    const load = async (url) => {
      const loaded = c.once('Page.loadEventFired');
      await c.send('Page.navigate', { url });
      await loaded;
      await evaluate('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
    };
    await load(base);
    const manifest = await evaluate('window.STORE.manifest()');
    const jobs = manifest.flatMap((m) => m.outputs.map((o) => ({ ...m, ...o }))).filter((j) => j.path.includes(filter));
    let n = 0;
    for (const j of jobs) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: j.w, height: j.h, deviceScaleFactor: j.scale, mobile: false });
      await load(`${base}?r=${++n}#${j.hash}`);
      if (!(await evaluate("document.fonts.check('16px Inter') && document.fonts.check('12px \"JetBrains Mono\"')"))) throw new Error(`fuentes sin cargar en ${j.hash}`);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const { data } = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: j.w, height: j.h, scale: 1 } });
      const file = join(OUT, j.path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(data, 'base64'));
      console.log(`${j.path}  ${Math.round(j.w * j.scale)}x${Math.round(j.h * j.scale)}`);
    }
    c.close();
  } finally {
    chrome.kill();
    srv.close();
  }
};

main().catch((e) => {
  console.error(`[store] export fallido: ${e.message}`);
  process.exit(1);
});
