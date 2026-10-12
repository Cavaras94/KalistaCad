// Tavola di stampa in SVG con dimensioni in millimetri reali.
import type { Prim } from '../model/entities';
import { textLines } from '../model/entities';
import type { Doc } from '../model/document';
import { LT_PATTERNS, UNIT_MM } from '../model/document';
import { Box, sweep, polar, boxOverlap } from '../model/geom';
import { entPrims, entBoxCached, drawList } from '../view/render';

export type Paper = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export const PAPERS: Record<Paper, [number, number]> = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
export const STD_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 2000, 5000];
export type WallFill = 'grigio' | 'nero' | 'vuoto';

export interface TitleFields {
  progetto: string;
  titolo: string;
  committente: string;
  indirizzo: string;
  disegnatore: string;
  data: string;
  tavola: string;
}

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
  const ents = drawList(doc, ctx).filter(e => boxOverlap(entBoxCached(e, ctx), visible))
    .sort((a, b) => order(a.t) - order(b.t));

  for (const e of ents) {
    const l = layers.get(e.layer) ?? doc.layers[0];
    const color = printColor(e.color ?? l.color, o.mono);
    const lw = o.lineweights ? Math.max(0.05, l.lw) : 0.18;
    const dash = LT_PATTERNS[l.lt].map(x => x * doc.settings.ltScale);
    const strokeAttr = `stroke="${color}" stroke-width="${f(lw)}"${dash.length ? ` stroke-dasharray="${dash.map(f).join(' ')}"` : ''}`;
    for (const p of entPrims(e, ctx)) out.push(primSvg(p, X, Y, k, color, strokeAttr, wallFill));
  }

  const tb = o.title ? titleBlock(W, H, scale, o.fields) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
<defs><clipPath id="vp"><rect x="${f(vp.x)}" y="${f(vp.y)}" width="${f(vp.w)}" height="${f(vp.h)}"/></clipPath></defs>
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
      if (p.fill === 'tint') return '';
      if (p.fill) {
        const fill = p.fill === 'wall' ? wallFill : color;
        if (fill === 'none') return p.stroke === false ? '' : `<path d="${d}" ${stroke}/>`;
        return `<path d="${d}" fill="${fill}" stroke="${p.stroke === false ? fill : color}" stroke-width="${p.stroke === false ? 0.05 : 0.18}"/>`;
      }
      return `<path d="${d}" ${stroke}/>`;
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

function titleBlock(W: number, H: number, scale: number, t: TitleFields): string {
  const w = Math.min(TB_W, W - 2 * MARGIN);
  const x0 = W - MARGIN - w, y0 = H - MARGIN - TB_H;
  const left = w * 0.66;
  const cell = (x: number, y: number, cw: number, ch: number, label: string, value: string, size: number) =>
    `<rect x="${f(x)}" y="${f(y)}" width="${f(cw)}" height="${f(ch)}" fill="none" stroke="#000" stroke-width="0.25"/>` +
    `<text x="${f(x + 1.2)}" y="${f(y + 2.4)}" font-size="1.8" fill="#444">${esc(label)}</text>` +
    `<text x="${f(x + 1.2)}" y="${f(y + ch - 1.6)}" font-size="${size}" fill="#000">${esc(value)}</text>`;
  const rh = TB_H / 4;
  const parts = [
    `<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${TB_H}" fill="#fff" stroke="#000" stroke-width="0.5"/>`,
    cell(x0, y0, left, rh, 'PROGETTO', t.progetto, 3),
    cell(x0, y0 + rh, left, rh * 2, 'OGGETTO', t.titolo, 5),
    cell(x0, y0 + rh * 3, left, rh, 'COMMITTENTE / INDIRIZZO', [t.committente, t.indirizzo].filter(Boolean).join(' – '), 2.6),
    cell(x0 + left, y0, w - left, rh, 'SCALA', `1:${scale}`, 3.2),
    cell(x0 + left, y0 + rh, w - left, rh, 'DATA', t.data, 3),
    cell(x0 + left, y0 + rh * 2, w - left, rh, 'TAVOLA', t.tavola, 3.2),
    cell(x0 + left, y0 + rh * 3, w - left, rh, 'DISEGNATORE', t.disegnatore, 2.8),
  ];
  return parts.join('\n');
}
