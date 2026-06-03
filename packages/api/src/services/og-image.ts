import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { dbRead } from '../db/read-pool.js';
import { getRangeStart } from '../db/queries/index.js';
import type { ProfileSummaryRow } from '../db/queries/index.js';
import { OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, OG_IMAGE_CACHE_MS } from '../constants.js';
import type { TimeRange } from '../constants.js';
import type { User } from './user-manager.js';

// genera la tarjeta OG 1200×630 de un share link: fondo oscuro, avatar circular,
// displayName, línea de stats y las 3 portadas top del rango.

// caché en memoria por token: regenerar en cada hit de crawler es un desperdicio
const imageCache = new Map<string, { buf: Buffer; expires: number }>();

// layout de la tarjeta (px)
const LAYOUT = {
  pad: 72,
  avatarSize: 140,
  coverSize: 232,
  coverGap: 24,
  coverRadius: 16,
} as const;

// mismo fondo que el body del SPA
const BG_COLOR = '#080a0c';
const ACCENT_COLOR = '#1db954';
const TEXT_COLOR = '#ffffff';
const MUTED_COLOR = '#9aa3ad';

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

// carga una imagen desde URL remota o ruta local /api/covers/*
async function loadImage(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    if (url.startsWith('/api/covers/')) {
      // misma resolución de coversDir que app.ts
      const coversDir = path.resolve(process.env.DATABASE_PATH || './data/sis.db', '..', 'covers');
      return fs.readFileSync(path.join(coversDir, path.basename(url)));
    }
    if (url.startsWith('http')) {
      const res = await fetch(url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}

// recorta una imagen en círculo (avatar)
async function circleImage(buf: Buffer, size: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  return sharp(buf)
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// redondea las esquinas de una portada
async function roundedImage(buf: Buffer, size: number, radius: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`
  );
  return sharp(buf)
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// placeholder cuando una portada no se puede cargar
function placeholderCover(size: number, radius: number): Buffer {
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#1a1f26"/></svg>`
  );
}

function formatHours(ms: number): string {
  return `${Math.round(ms / 3_600_000).toLocaleString('en-US')} h`;
}

const RANGE_LABELS: Record<TimeRange, string> = {
  week: 'última semana',
  month: 'último mes',
  '3months': 'últimos 3 meses',
  '6months': 'últimos 6 meses',
  year: 'último año',
  thisYear: 'este año',
  all: 'todo el tiempo',
};

export async function generateOgImage(token: string, user: User, range: TimeRange): Promise<Buffer> {
  const cached = imageCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.buf;

  const rangeStart = getRangeStart(range);
  const [summary, albumRows] = await Promise.all([
    dbRead<ProfileSummaryRow>('getProfileSummary', user.id, rangeStart, null),
    dbRead<{ entity_id: string; play_count: number; total_ms: number }[]>('getTopEntities', 'album', rangeStart, 'time', 3, null, user.id),
  ]);
  const albums = await Promise.all(albumRows.map(row => dbRead<{ album: { name: string; imageUrl: string | null } | null }>('formatTopAlbumRow', row)));

  const { pad, avatarSize, coverSize, coverGap, coverRadius } = LAYOUT;
  const name = escapeXml(user.displayName ?? user.spotifyId);
  const statsLine = escapeXml(
    `${summary.play_count.toLocaleString('en-US')} plays · ${formatHours(summary.total_ms)} · ${summary.distinct_artists.toLocaleString('en-US')} artistas`
  );
  const rangeLabel = escapeXml(RANGE_LABELS[range] ?? '');

  // base: fondo + textos (las imágenes van por composite)
  const textX = pad + avatarSize + 36;
  const baseSvg = `<svg width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${BG_COLOR}"/>
    <rect x="0" y="0" width="100%" height="6" fill="${ACCENT_COLOR}"/>
    <text x="${textX}" y="${pad + 62}" font-family="DejaVu Sans, sans-serif" font-size="56" font-weight="bold" fill="${TEXT_COLOR}">${name}</text>
    <text x="${textX}" y="${pad + 112}" font-family="DejaVu Sans, sans-serif" font-size="30" fill="${MUTED_COLOR}">${statsLine}</text>
    <text x="${pad}" y="${OG_IMAGE_HEIGHT - pad + 18}" font-family="DejaVu Sans, sans-serif" font-size="26" fill="${MUTED_COLOR}">${rangeLabel}</text>
    <text x="${OG_IMAGE_WIDTH - pad}" y="${OG_IMAGE_HEIGHT - pad + 18}" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="bold" fill="${ACCENT_COLOR}" text-anchor="end">SIS</text>
  </svg>`;

  const composites: sharp.OverlayOptions[] = [];

  // avatar circular arriba a la izquierda
  const avatarBuf = await loadImage(user.imageUrl);
  if (avatarBuf) {
    try {
      composites.push({ input: await circleImage(avatarBuf, avatarSize), left: pad, top: pad - 10 });
    } catch { /* avatar corrupto: omitir */ }
  }

  // fila de portadas top, centrada verticalmente en la mitad inferior
  const coversY = pad + avatarSize + 56;
  for (let i = 0; i < 3; i++) {
    const coverUrl = albums[i]?.album?.imageUrl ?? null;
    const buf = await loadImage(coverUrl);
    let input: Buffer;
    try {
      input = buf ? await roundedImage(buf, coverSize, coverRadius) : placeholderCover(coverSize, coverRadius);
    } catch {
      input = placeholderCover(coverSize, coverRadius);
    }
    composites.push({ input, left: pad + i * (coverSize + coverGap), top: coversY });
  }

  const png = await sharp(Buffer.from(baseSvg)).composite(composites).png().toBuffer();
  imageCache.set(token, { buf: png, expires: Date.now() + OG_IMAGE_CACHE_MS });
  return png;
}
