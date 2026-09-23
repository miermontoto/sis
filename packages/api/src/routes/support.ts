// página pública de soporte: las stores exigen un support url accesible sin login.
// se sirve a nivel raíz (fuera del gate de /api/*) antes del fallback de la spa.
import { Hono } from 'hono';
import { publicOrigin } from '../services/public-origin.js';

const SUPPORT_EMAIL = 'support@mier.info';

// html autocontenido (sin assets externos) con los tokens de marca de app.css: fondo
// #080a0c, acento verde #1db954, monospace, radios de 2px, sin sombras. el origen se
// resuelve por request porque el .env se carga después de evaluar los imports.
const renderSupport = (origin: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SIS · Support</title>
  <meta name="robots" content="index">
  <style>
    :root { --bg:#080a0c; --fg:#e0e8e8; --mut:#6a7a7a; --accent:#1db954; --panel:#0f1214; --border:#1e2a2a; color-scheme:dark; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      background:var(--bg); color:var(--fg);
      font-family:ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace; line-height:1.6; padding:24px 16px; }
    main { width:100%; max-width:560px; }
    h1 { font-size:40px; margin:0 0 4px; text-align:center; font-weight:700; letter-spacing:0.06em; color:var(--accent); }
    .tagline { color:var(--mut); text-align:center; margin:0 0 32px; font-size:15px; }
    section { background:var(--panel); border:1px solid var(--border); border-radius:2px; padding:24px; margin-bottom:16px; }
    h2 { font-size:13px; letter-spacing:1px; text-transform:uppercase; color:var(--mut); margin:0 0 12px; }
    p { margin:0 0 12px; }
    p:last-child { margin-bottom:0; }
    a { color:var(--accent); text-decoration:none; overflow-wrap:anywhere; }
    a:hover { text-decoration:underline; }
    .email { font-size:18px; font-weight:700; }
    .muted { color:var(--mut); font-size:14px; }
    footer { text-align:center; color:var(--mut); font-size:13px; margin-top:24px; }
  </style>
</head>
<body>
  <main>
    <h1>SIS</h1>
    <p class="tagline">Your Spotify listening history, stats and charts.</p>

    <section>
      <h2>Support</h2>
      <p>Need help, found a bug, or have a question about SIS? Get in touch:</p>
      <p class="email"><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      <p class="muted">We usually reply within a couple of business days. / Solemos responder en un par de días laborables.</p>
    </section>

    <section>
      <h2>The app</h2>
      <p class="muted">SIS records what you listen to on Spotify and turns it into a history, rankings, charts and records, with shareable profiles.</p>
      <p><a href="${origin}">${origin}</a> · <a href="${origin}/privacy">Privacy policy</a></p>
    </section>

    <footer>© SIS</footer>
  </main>
</body>
</html>`;

const support = new Hono();
support.get('/', (c) => c.html(renderSupport(publicOrigin())));

export default support;
