import { tryLoadImage } from '$lib/canvas-export';
import type { Block, BoardMatch, BracketBlock, ListBlock, Slot, TablesBlock } from '$lib/tournament';

// paleta del canvas exportado, alineada con el resto de generators: los png se
// quedan oscuros aunque la app esté en claro (son imágenes para compartir)
const CANVAS_BG = '#080a0c';
const CANVAS_SLOT = '#161a1d';
const CANVAS_EMPTY = '#0e1113';
const CANVAS_THUMB = '#22282b';
const CANVAS_TEXT = '#e0e8e8';
const CANVAS_MUTED = '#6a7a7a';
const CANVAS_DIM = '#555';
const CANVAS_ACCENT = '#1db954';
const CANVAS_LINE = '#2a3033';

// geometría: un partido son dos filas de contendiente apiladas
const SLOT_H = 30;
const MATCH_H = SLOT_H * 2;
const MATCH_GAP = 12;
const COL_W = 230;
const COL_GAP = 34;
const THUMB = 22;
const PAD = 32;
const HEADER_H = 84;
const FOOTER_H = 54;
const MIN_CONTENT_W = 640;
const BLOCK_GAP = 40;
const BLOCK_TITLE_H = 30;
const COL_LABEL_H = 26;
// tablas: grupos y clasificación del suizo
const ROW_H = 30;
const ROW_GAP = 4;
const TABLE_W = 300;
const TABLE_TITLE_H = 26;
const CELL_W = 46;
const TABLE_MAX_ROWS = 16;
const GRID_COLS = 4;
const GRID_GAP = 24;
const QUALIFIED_BAR = 3;
// rey de la pista: partidos en columnas de como mucho LIST_PER_COL
const LIST_PER_COL = 12;

export interface BoardEntry {
  name: string;
  seed: number;
  imageUrl: string | null;
  // cifra ya formateada con la métrica elegida
  stat: string;
}

export interface BoardRender {
  blocks: Block[];
  entries: BoardEntry[];
  title: string;
  subtitle: string;
  owner: string;
  // oculta seeds y cifras (modo a ciegas mientras el torneo sigue abierto)
  blind: boolean;
}

// cssWidth/cssHeight son las dimensiones lógicas, sin el factor de escala
export interface RenderResult {
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
}

type Tone = 'normal' | 'win' | 'lose' | 'champion';

// primitivas de dibujo compartidas por los tres tipos de bloque
class Painter {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    private readonly entries: BoardEntry[],
    private readonly images: Map<string, HTMLImageElement | null>,
    private readonly blind: boolean,
  ) {}

  // recorta un texto al ancho disponible añadiendo elipsis
  fit(text: string, maxW: number): string {
    const { ctx } = this;
    if (ctx.measureText(text).width <= maxW) return text;
    let txt = text;
    while (txt.length > 1 && ctx.measureText(`${txt}…`).width > maxW) txt = txt.slice(0, -1);
    return `${txt}…`;
  }

  text(text: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') {
    const { ctx } = this;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }

  box(x: number, y: number, w: number, h: number, color: string, radius = 6) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  }

  blockTitle(title: string, x: number, y: number) {
    this.text(title.toUpperCase(), x, y + BLOCK_TITLE_H / 2 - 4, '700 14px sans-serif', CANVAS_TEXT);
  }

  columnLabel(label: string, x: number, y: number) {
    this.text(label.toUpperCase(), x, y, '600 12px sans-serif', CANVAS_MUTED);
  }

  // conector en codo de la salida de un partido a la entrada del siguiente
  elbow(fromX: number, fromY: number, toX: number, toY: number) {
    const { ctx } = this;
    const midX = fromX + (toX - fromX) / 2;
    ctx.strokeStyle = CANVAS_LINE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(midX, fromY);
    ctx.lineTo(midX, toY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  }

  // fila de contendiente: miniatura, prefijo (seed o puesto), nombre y a la
  // derecha la cifra o las celdas de la tabla
  entry(x: number, y: number, w: number, c: Slot, tone: Tone, lead: string, right: string[]) {
    if (c === null) return;
    const { ctx } = this;
    const e = this.entries[c];
    const mid = y + SLOT_H / 2;
    const thumbY = y + (SLOT_H - THUMB) / 2;
    const img = e.imageUrl ? this.images.get(e.imageUrl) : null;
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + 6, thumbY, THUMB, THUMB, 3);
      ctx.clip();
      ctx.drawImage(img, x + 6, thumbY, THUMB, THUMB);
      ctx.restore();
    } else {
      this.box(x + 6, thumbY, THUMB, THUMB, CANVAS_THUMB, 3);
    }

    ctx.textBaseline = 'middle';
    // celdas de derecha a izquierda, cada una en su columna fija
    right.forEach((cell, i) => this.text(cell, x + w - 8 - i * CELL_W, mid, '12px sans-serif', CANVAS_MUTED, 'right'));
    // la celda de más a la izquierda marca dónde tiene que acabar el nombre
    const rightW = right.length ? (right.length - 1) * CELL_W + ctx.measureText(right[right.length - 1]).width + 16 : 8;

    this.text(lead, x + THUMB + 13, mid, '600 11px sans-serif', CANVAS_MUTED);
    const nameX = x + THUMB + 13 + (lead ? ctx.measureText(lead).width + 6 : 0);
    const font = tone === 'win' || tone === 'champion' ? '600 13px sans-serif' : '13px sans-serif';
    const color = tone === 'champion' ? CANVAS_ACCENT : tone === 'lose' ? CANVAS_DIM : CANVAS_TEXT;
    ctx.font = font;
    this.text(this.fit(e.name, x + w - rightW - nameX), nameX, mid, font, color);
  }

  // seed y cifra de un contendiente de cuadro; a ciegas no se enseña ninguna
  seedOf(c: Slot): string {
    return c === null || this.blind ? '' : String(this.entries[c].seed);
  }

  statOf(c: Slot): string[] {
    return c === null || this.blind ? [] : [this.entries[c].stat];
  }

  match(x: number, y: number, m: BoardMatch) {
    const { ctx } = this;
    this.box(x, y, COL_W, MATCH_H, m.a === null && m.b === null ? CANVAS_EMPTY : CANVAS_SLOT);
    ctx.strokeStyle = CANVAS_BG;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + SLOT_H);
    ctx.lineTo(x + COL_W, y + SLOT_H);
    ctx.stroke();
    const tone = (c: Slot): Tone => (m.winner === null ? 'normal' : c === m.winner ? 'win' : 'lose');
    this.entry(x, y, COL_W, m.a, tone(m.a), this.seedOf(m.a), this.statOf(m.a));
    this.entry(x, y + SLOT_H, COL_W, m.b, tone(m.b), this.seedOf(m.b), this.statOf(m.b));
  }

  champion(x: number, y: number, c: Slot) {
    const { ctx } = this;
    this.box(x, y, COL_W, SLOT_H, c === null ? CANVAS_EMPTY : CANVAS_SLOT);
    if (c === null) return;
    ctx.strokeStyle = CANVAS_ACCENT;
    ctx.lineWidth = 2;
    ctx.stroke();
    this.entry(x, y, COL_W, c, 'champion', this.seedOf(c), this.statOf(c));
  }
}

// un bloque ya medido: el tamaño se conoce antes de crear el canvas
interface Laid {
  w: number;
  h: number;
  draw(p: Painter, x: number, y: number): void;
}

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

function layBracket(b: BracketBlock): Laid {
  const step = MATCH_H + MATCH_GAP;
  // centro de cada partido: la primera columna se apila; cada siguiente se alinea
  // con su alimentador si tiene los mismos partidos, o se centra entre sus dos
  // alimentadores si tiene la mitad
  const centers: number[][] = [];
  b.columns.forEach((col, r) => {
    const prev = centers[r - 1];
    const same = r > 0 && b.columns[r - 1].matches.length === col.matches.length;
    centers.push(col.matches.map((_, j) =>
      r === 0 ? j * step + MATCH_H / 2 : same ? prev[j] : (prev[2 * j] + prev[2 * j + 1]) / 2));
  });
  const cols = b.columns.length + (b.crowns ? 1 : 0);
  const top = (b.title ? BLOCK_TITLE_H : 0) + COL_LABEL_H;
  const last = b.columns.length - 1;
  return {
    w: cols * COL_W + (cols - 1) * COL_GAP,
    h: top + b.columns[0].matches.length * step - MATCH_GAP,
    draw(p, x, y) {
      const colX = (r: number) => x + r * (COL_W + COL_GAP);
      const cy = (r: number, j: number) => y + top + centers[r][j];
      if (b.title) p.blockTitle(b.title, x, y);
      b.columns.forEach((col, r) => p.columnLabel(col.label, colX(r), y + top - COL_LABEL_H / 2));
      if (b.crowns) p.columnLabel('Champion', colX(cols - 1), y + top - COL_LABEL_H / 2);

      b.columns.forEach((col, r) => {
        const next = b.columns[r + 1];
        col.matches.forEach((_, j) => {
          if (next) p.elbow(colX(r) + COL_W, cy(r, j), colX(r + 1), cy(r + 1, next.matches.length === col.matches.length ? j : j >> 1));
          else if (b.crowns) p.elbow(colX(r) + COL_W, cy(r, j), colX(r + 1), cy(r, j));
        });
      });
      b.columns.forEach((col, r) => col.matches.forEach((m, j) => p.match(colX(r), cy(r, j) - MATCH_H / 2, m)));
      if (b.crowns) p.champion(colX(cols - 1), cy(last, 0) - SLOT_H / 2, b.champion);
    },
  };
}

function layTables(b: TablesBlock): Laid {
  // paneles de como mucho TABLE_MAX_ROWS filas: la clasificación de 64 se parte
  // en columnas en vez de dar una tira kilométrica
  const panels = b.tables.flatMap((t) =>
    chunk(t.rows, TABLE_MAX_ROWS).map((rows, i) => ({ title: i === 0 ? t.title : '', rows, offset: i * TABLE_MAX_ROWS })));
  const cols = Math.min(panels.length, GRID_COLS);
  const panelH = (rows: number) => TABLE_TITLE_H + rows * (ROW_H + ROW_GAP) - ROW_GAP;
  const gridRows = chunk(panels, cols);
  const rowHeights = gridRows.map((row) => Math.max(...row.map((pnl) => panelH(pnl.rows.length))));
  const top = b.title ? BLOCK_TITLE_H : 0;
  return {
    w: cols * TABLE_W + (cols - 1) * GRID_GAP,
    h: top + rowHeights.reduce((sum, h) => sum + h, 0) + (gridRows.length - 1) * GRID_GAP,
    draw(p, x, y) {
      if (b.title) p.blockTitle(b.title, x, y);
      let rowY = y + top;
      gridRows.forEach((row, gr) => {
        row.forEach((pnl, gc) => {
          const px = x + gc * (TABLE_W + GRID_GAP);
          p.ctx.textBaseline = 'middle';
          p.columnLabel(pnl.title, px, rowY + TABLE_TITLE_H / 2 - 2);
          b.headers.forEach((h, i) =>
            p.text(h.toUpperCase(), px + TABLE_W - 8 - (b.headers.length - 1 - i) * CELL_W, rowY + TABLE_TITLE_H / 2 - 2, '600 11px sans-serif', CANVAS_MUTED, 'right'));
          pnl.rows.forEach((r, i) => {
            const ry = rowY + TABLE_TITLE_H + i * (ROW_H + ROW_GAP);
            p.box(px, ry, TABLE_W, ROW_H, CANVAS_SLOT, 4);
            if (r.qualified) p.box(px, ry, QUALIFIED_BAR, ROW_H, CANVAS_ACCENT, 1);
            // las celdas se pintan de derecha a izquierda
            p.entry(px, ry, TABLE_W, r.c, r.qualified ? 'win' : 'normal', String(pnl.offset + i + 1), [...r.cells].reverse());
          });
        });
        rowY += rowHeights[gr] + GRID_GAP;
      });
    },
  };
}

function layList(b: ListBlock): Laid {
  const step = MATCH_H + MATCH_GAP;
  const perCol = Math.min(b.matches.length, LIST_PER_COL);
  const cols = Math.ceil(b.matches.length / LIST_PER_COL);
  const top = b.title ? BLOCK_TITLE_H : 0;
  return {
    w: cols * COL_W + (cols - 1) * COL_GAP,
    h: top + perCol * step - MATCH_GAP,
    // en orden cronológico, columna a columna
    draw(p, x, y) {
      if (b.title) p.blockTitle(b.title, x, y);
      b.matches.forEach((m, i) =>
        p.match(x + Math.floor(i / perCol) * (COL_W + COL_GAP), y + top + (i % perCol) * step, m));
    },
  };
}

const lay = (b: Block): Laid => (b.kind === 'bracket' ? layBracket(b) : b.kind === 'tables' ? layTables(b) : layList(b));

// dibuja en unidades lógicas sobre un buffer escalado: sin esto el canvas
// tiene menos píxeles que la pantalla en displays HiDPI y el texto se ve dentado
export async function renderBoard(input: BoardRender, scale: number): Promise<RenderResult | null> {
  if (input.blocks.length === 0) return null;
  const laid = input.blocks.map(lay);
  const contentW = Math.max(MIN_CONTENT_W, ...laid.map((l) => l.w));
  const contentH = laid.reduce((sum, l) => sum + l.h, 0) + (laid.length - 1) * BLOCK_GAP;
  const width = PAD * 2 + contentW;
  const height = PAD * 2 + HEADER_H + contentH + FOOTER_H;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, width, height);

  // una sola carga por url aunque la entrada aparezca en varias rondas
  const urls = [...new Set(input.entries.map((e) => e.imageUrl).filter((u): u is string => !!u))];
  const loaded = await Promise.all(urls.map((u) => tryLoadImage(u)));
  const p = new Painter(ctx, input.entries, new Map(urls.map((u, i) => [u, loaded[i]])), input.blind);

  ctx.textBaseline = 'middle';
  p.text(input.title, PAD, PAD + 22, 'bold 34px sans-serif', CANVAS_TEXT);
  p.text(input.subtitle, PAD, PAD + 52, '16px sans-serif', CANVAS_MUTED);

  laid.reduce((y, l) => {
    l.draw(p, PAD, y);
    return y + l.h + BLOCK_GAP;
  }, PAD + HEADER_H);

  ctx.textBaseline = 'middle';
  const footerY = height - PAD - FOOTER_H / 2;
  p.text(input.owner, PAD, footerY, '600 16px sans-serif', CANVAS_MUTED);
  p.text('sis', width - PAD, footerY, '600 16px sans-serif', CANVAS_DIM, 'right');

  return { canvas, cssWidth: width, cssHeight: height };
}
