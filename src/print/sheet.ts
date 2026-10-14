// Tavola di stampa in SVG con dimensioni in millimetri reali.
import type { Prim } from '../model/entities';
import { textLines } from '../model/entities';
import type { Doc, Cartiglio } from '../model/document';
import { LT_PATTERNS, UNIT_MM } from '../model/document';
import { Box, sweep, polar, boxOverlap } from '../model/geom';
import { entPrims, entBoxCached, drawList } from '../view/render';

export type Paper = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export const PAPERS: Record<Paper, [number, number]> = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
export const STD_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 2000, 5000];
export type WallFill = 'grigio' | 'nero' | 'vuoto';

export type TitleFields = Cartiglio;

export interface PrintOpts {
  paper: Paper;
  landscape: boolean;
  /** denominatore della scala; 0 = adatta al foglio con una scala standard */
  scale: number;
  area: Box;
  mono: boolean;
  lineweights: boolean;
  wallFill: WallFill;
  title: boolean;
  fields: TitleFields;
  /** stampa solo ciò che sta dentro l'area (finestra scelta), non tutto quello che entra nel foglio */
  clip?: boolean;
  /** stampa solo queste entità (oggetti selezionati) */
  only?: Set<number>;
  /** logo da mettere nel cartiglio (dati dell'immagine) */
  logo?: string;
}

export interface Sheet {
  svg: string;
  scale: number;
  fits: boolean;
  w: number;
  h: number;
}

const MARGIN = 10;
const TB_H = 36;
const TB_W = 180;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (x: number) => (Math.round(x * 1000) / 1000).toString();

function printColor(c: string, mono: boolean): string {
  if (mono) return '#000';
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return '#000';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // i colori chiari, pensati per lo sfondo scuro, su carta non si vedrebbero
  return 0.299 * r + 0.587 * g + 0.114 * b > 200 ? '#000' : `#${m[1]}`;
}

export function sheetSize(o: Pick<PrintOpts, 'paper' | 'landscape'>): [number, number] {
  const [a, b] = PAPERS[o.paper];
  return o.landscape ? [b, a] : [a, b];
}

export function viewport(o: PrintOpts): { x: number; y: number; w: number; h: number } {
  const [W, H] = sheetSize(o);
  const x = MARGIN, y = MARGIN, w = W - 2 * MARGIN;
  const h = H - 2 * MARGIN - (o.title ? TB_H : 0);
  return { x, y, w, h };
}

export function fitScale(doc: Doc, o: PrintOpts): number {
  const vp = viewport(o);
  const aw = Math.max(o.area.x1 - o.area.x0, 1e-9), ah = Math.max(o.area.y1 - o.area.y0, 1e-9);
  const k = Math.min(vp.w / aw, vp.h / ah); // mm di carta per unità
  const exact = UNIT_MM[doc.settings.units] / k;
  return STD_SCALES.find(s => s >= exact - 1e-9) ?? Math.ceil(exact);
}

export function buildSheet(doc: Doc, o: PrintOpts): Sheet {
  const [W, H] = sheetSize(o);
  const vp = viewport(o);
  const scale = o.scale > 0 ? o.scale : fitScale(doc, o);
  const k = UNIT_MM[doc.settings.units] / scale;
  const cx = (o.area.x0 + o.area.x1) / 2, cy = (o.area.y0 + o.area.y1) / 2;
  const X = (x: number) => vp.x + vp.w / 2 + (x - cx) * k;
  const Y = (y: number) => vp.y + vp.h / 2 - (y - cy) * k;
  const fits = (o.area.x1 - o.area.x0) * k <= vp.w + 1e-6 && (o.area.y1 - o.area.y0) * k <= vp.h + 1e-6;
  const visible: Box = { x0: cx - vp.w / 2 / k, x1: cx + vp.w / 2 / k, y0: cy - vp.h / 2 / k, y1: cy + vp.h / 2 / k };

  const ctx = doc.ctx();
  const layers = new Map(doc.layers.map(l => [l.name, l]));
  const wallFill = o.wallFill === 'nero' ? '#000' : o.wallFill === 'grigio' ? '#9a9a9a' : 'none';
  const out: string[] = [];
  const order = (t: string) => (t === 'hatch' || t === 'room' ? 0 : t === 'wall' ? 1 : 2);
  // con una finestra scelta si vede solo quella: il resto del foglio resta bianco
  const shown: Box = o.clip
    ? { x0: Math.max(visible.x0, o.area.x0), x1: Math.min(visible.x1, o.area.x1), y0: Math.max(visible.y0, o.area.y0), y1: Math.min(visible.y1, o.area.y1) }
    : visible;
  const cr = { x: X(shown.x0), y: Y(shown.y1), w: (shown.x1 - shown.x0) * k, h: (shown.y1 - shown.y0) * k };
  const ents = drawList(doc, ctx, o.only).filter(e => boxOverlap(entBoxCached(e, ctx), shown))
    .sort((a, b) => order(a.t) - order(b.t));

  for (const e of ents) {
    const l = layers.get(e.layer) ?? doc.layers[0];
    const color = printColor(e.color ?? l.color, o.mono);
    const lw = o.lineweights ? Math.max(0.05, e.lw ?? l.lw) : 0.18;
    const dash = LT_PATTERNS[e.lt ?? l.lt].map(x => x * doc.settings.ltScale);
    const strokeAttr = `stroke="${color}" stroke-width="${f(lw)}"${dash.length ? ` stroke-dasharray="${dash.map(f).join(' ')}"` : ''}`;
    // le righe del retino di un muro vanno sottili e continue, qualunque sia il tratto del muro
    const decoAttr = `stroke="${color}" stroke-width="${f(Math.min(lw, 0.13))}"`;
    for (const p of entPrims(e, ctx)) out.push(primSvg(p, X, Y, k, color, p.k === 'pl' && p.deco ? decoAttr : strokeAttr, wallFill));
  }

  const tb = o.title ? titleBlock(W, H, o.fields, o.logo) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
<defs><clipPath id="vp"><rect x="${f(cr.x)}" y="${f(cr.y)}" width="${f(Math.max(cr.w, 0))}" height="${f(Math.max(cr.h, 0))}"/></clipPath></defs>
<g clip-path="url(#vp)" fill="none" stroke-linecap="round" stroke-linejoin="round">
${out.join('\n')}
</g>
<rect x="${MARGIN}" y="${MARGIN}" width="${W - 2 * MARGIN}" height="${H - 2 * MARGIN}" fill="none" stroke="#000" stroke-width="0.5"/>
${tb}
</svg>`;
  return { svg, scale, fits, w: W, h: H };
}

function primSvg(p: Prim, X: (x: number) => number, Y: (y: number) => number, k: number, color: string, stroke: string, wallFill: string): string {
  switch (p.k) {
    case 'pl': {
      if (p.pts.length < 2) return '';
      const d = p.pts.map((q, i) => `${i ? 'L' : 'M'}${f(X(q.x))} ${f(Y(q.y))}`).join('') + (p.closed ? 'Z' : '');
      if (p.fill === 'tint' || p.fill === 'hit') return '';
      if (p.fill) {
        const fill = p.fill === 'wall' ? wallFill : color;
        if (fill === 'none') return p.stroke === false ? '' : `<path d="${d}" ${stroke}/>`;
        return `<path d="${d}" fill="${fill}" stroke="${p.stroke === false ? fill : color}" stroke-width="${p.stroke === false ? 0.05 : 0.18}"/>`;
      }
      return `<path d="${d}" ${stroke}/>`;
    }
    case 'img': {
      const deg = (-p.rot * 180) / Math.PI;
      return `<image href="${esc(p.src)}" x="0" y="${f(-p.h * k)}" width="${f(p.w * k)}" height="${f(p.h * k)}" preserveAspectRatio="none" transform="translate(${f(X(p.p.x))} ${f(Y(p.p.y))}) rotate(${f(deg)})"/>`;
    }
    case 'area': {
      const d = p.loops.map(l => l.map((q, i) => `${i ? 'L' : 'M'}${f(X(q.x))} ${f(Y(q.y))}`).join('') + 'Z').join('');
      if (p.fill === 'tint') return '';
      return `<path d="${d}" fill="${p.fill === 'wall' ? wallFill : color}" fill-rule="evenodd" stroke="none"/>`;
    }
    case 'arc': {
      const r = p.r * k;
      if (p.full) return `<circle cx="${f(X(p.c.x))}" cy="${f(Y(p.c.y))}" r="${f(r)}" ${stroke}/>`;
      const sw = sweep(p.a0, p.a1);
      const a = polar(p.c, p.r, p.a0), b = polar(p.c, p.r, p.a0 + sw);
      return `<path d="M${f(X(a.x))} ${f(Y(a.y))}A${f(r)} ${f(r)} 0 ${sw > Math.PI ? 1 : 0} 0 ${f(X(b.x))} ${f(Y(b.y))}" ${stroke}/>`;
    }
    case 'text': {
      const anchor = p.ha === 'l' ? 'start' : p.ha === 'c' ? 'middle' : 'end';
      const deg = (-p.rot * 180) / Math.PI;
      const lines = textLines(p).map(l => `<text x="0" y="${f(-l.y * k)}" font-size="${f(p.h * k)}" text-anchor="${anchor}" fill="${color}" stroke="none">${esc(l.s)}</text>`).join('');
      return `<g transform="translate(${f(X(p.p.x))} ${f(Y(p.p.y))}) rotate(${f(deg)})">${lines}</g>`;
    }
  }
}

/** Larghezza stimata di una scritta in Arial, in altezze di carattere: le maiuscole sono più larghe. */
export function textEm(s: string): number {
  let w = 0;
  for (const c of s) w += /[MWmw@%]/.test(c) ? 0.9 : /[A-Z0-9ÀÈÉÌÒÙ]/.test(c) ? 0.72 : /[ .,;:'!|ilIjtfr()\-]/.test(c) ? 0.34 : 0.57;
  return w;
}

/** Spezza una riga troppo lunga agli spazi; una parola più lunga della riga viene tagliata. */
function wrapLine(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (let w of s.split(' ')) {
    while (textEm(w) > max) {
      if (cur) { out.push(cur); cur = ''; }
      let n = 1;
      while (n < w.length && textEm(w.slice(0, n + 1)) <= max) n++;
      out.push(w.slice(0, n));
      w = w.slice(n);
    }
    if (!cur) cur = w;
    else if (textEm(cur + ' ' + w) <= max) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  out.push(cur);
  return out;
}

/**
 * Righe di una casella del cartiglio: gli a capo sono quelli scritti, le righe lunghe si spezzano,
 * e se il testo non ci sta il carattere si riduce fino a farcelo stare.
 */
export function fitCell(value: string, cw: number, ch: number, base: number): { size: number; lines: string[] } {
  const src = value.replace(/\s+$/, '').split('\n');
  for (let size = base; ; size *= 0.9) {
    const max = (cw - 2.4) / size;
    const lines = src.flatMap(l => wrapLine(l.trimEnd(), max));
    const room = Math.max(1, Math.floor((ch - 3.4) / (size * 1.2)));
    if (lines.length <= room || size <= 1.3) return { size, lines: lines.slice(0, room) };
  }
}

function titleBlock(W: number, H: number, t: TitleFields, logo?: string): string {
  const full = Math.min(TB_W, W - 2 * MARGIN);
  const xb = W - MARGIN - full, y0 = H - MARGIN - TB_H;
  // con il logo, la prima parte del cartiglio è un riquadro per lui
  const lw = logo ? Math.min(TB_H * 1.4, full * 0.3) : 0;
  const w = full - lw, x0 = xb + lw;
  const left = w * 0.5;
  const cell = (x: number, y: number, cw: number, ch: number, label: string, value: string, base: number) => {
    const { size, lines } = fitCell(value ?? '', cw, ch, base);
    return `<rect x="${f(x)}" y="${f(y)}" width="${f(cw)}" height="${f(ch)}" fill="none" stroke="#000" stroke-width="0.25"/>` +
      `<text x="${f(x + 1.2)}" y="${f(y + 2.4)}" font-size="1.8" fill="#444">${esc(label)}</text>` +
      lines.map((l, i) => `<text x="${f(x + 1.2)}" y="${f(y + 3.2 + size * (0.9 + i * 1.2))}" font-size="${f(size)}" fill="#000">${esc(l)}</text>`).join('');
  };
  const top = TB_H * 0.42;
  const parts = [
    `<rect x="${f(xb)}" y="${f(y0)}" width="${f(full)}" height="${TB_H}" fill="#fff" stroke="#000" stroke-width="0.5"/>`,
    ...(logo ? [`<image href="${esc(logo)}" x="${f(xb + 1.5)}" y="${f(y0 + 1.5)}" width="${f(lw - 3)}" height="${f(TB_H - 3)}" preserveAspectRatio="xMidYMid meet"/>`] : []),
    cell(x0, y0, left, top, 'NOME CLIENTE', t.cliente, 5),
    cell(x0, y0 + top, left, TB_H - top, 'POSA GRES', t.posa, 4.5),
    cell(x0 + left, y0, w - left, TB_H, 'NOTE', t.note, 3.2),
  ];
  return parts.join('\n');
}
