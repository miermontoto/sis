import fs from 'fs';
import path from 'path';
import type { Context } from 'hono';
import { dbRead } from '../db/read-pool.js';
import { findUserBySpotifyId, type User } from './user-manager.js';
import { isUserHidden, publicBase } from './social.js';
import { createLogger } from './logger.js';

const log = createLogger('og');
// HTML shell del SPA con <meta> OG inyectados para crawlers.
// Los navegadores reciben el mismo HTML y arrancan el SPA con normalidad.

let cachedShell: string | null = null;

function readShell(): string | null {
  if (cachedShell) return cachedShell;
  const shellPath = path.resolve(process.cwd(), 'static', '200.html');
  try {
    cachedShell = fs.readFileSync(shellPath, 'utf-8');
    return cachedShell;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatHours(ms: number): string {
  return `${Math.round(ms / 3_600_000).toLocaleString('en-US')}h`;
}

interface OgFields {
  title: string;
  description: string;
  imageUrl: string | null;
  url: string;
}

function buildMetaBlock(fields: OgFields): string {
  const lines = [
    `<meta property="og:title" content="${escapeHtml(fields.title)}">`,
    `<meta property="og:description" content="${escapeHtml(fields.description)}">`,
    `<meta property="og:url" content="${escapeHtml(fields.url)}">`,
    `<meta property="og:type" content="profile">`,
    `<meta property="og:site_name" content="SIS">`,
  ];
  if (fields.imageUrl) {
    lines.push(`<meta property="og:image" content="${escapeHtml(fields.imageUrl)}">`);
    lines.push(`<meta name="twitter:card" content="summary_large_image">`);
  } else {
    lines.push(`<meta name="twitter:card" content="summary">`);
  }
  return lines.join('\n');
}

async function ogFieldsForUser(user: User, opts: { imageUrl: string | null; url: string }): Promise<OgFields> {
  const summary = await dbRead('getProfileSummary', user.id, null, null);
  const name = user.displayName ?? user.spotifyId;
  return {
    title: `${name} en SIS`,
    description: `${summary.play_count.toLocaleString('en-US')} plays · ${formatHours(summary.total_ms)} · ${summary.distinct_artists.toLocaleString('en-US')} artistas`,
    imageUrl: opts.imageUrl,
    url: opts.url,
  };
}

type OgTarget =
  | { kind: 'share'; token: string }
  | { kind: 'profile'; spotifyId: string };

export async function renderOgHtml(c: Context, target: OgTarget): Promise<Response> {
  const shell = readShell();
  if (!shell) return c.notFound();

  let fields: OgFields | null = null;

  try {
    if (target.kind === 'share') {
      // import dinámico para evitar ciclo public.ts ↔ og-html.ts
      const { resolveShareToken } = await import('../routes/public.js');
      const resolution = resolveShareToken(target.token);
      if (resolution.status === 'ok') {
        fields = await ogFieldsForUser(resolution.user, {
          imageUrl: `${publicBase()}/public/share/${target.token}/og.png`,
          url: `${publicBase()}/s/${target.token}`,
        });
      }
    } else {
      const user = findUserBySpotifyId(target.spotifyId);
      // ocultos: tags genéricos, no filtrar existencia
      if (user && user.isActive && !isUserHidden(user.spotifyId)) {
        fields = await ogFieldsForUser(user, {
          imageUrl: null, // los perfiles in-app requieren login; sin tarjeta pública
          url: `${publicBase()}/u/${user.spotifyId}`,
        });
      }
    }
  } catch (err) {
    log.error('error construyendo meta tags:', err);
  }

  // sin datos (token inválido, usuario oculto, error): servir el shell tal cual
  const html = fields ? shell.replace('</head>', `${buildMetaBlock(fields)}\n</head>`) : shell;
  return c.html(html, 200, { 'Cache-Control': 'public, max-age=300' });
}
