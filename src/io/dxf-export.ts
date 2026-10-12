// Scrittura DXF R12 (AC1009).
import type { Ent, Prim } from '../model/entities';
import { prims, textLines, flatEnts } from '../model/entities';
import type { Doc, LineType } from '../model/document';
import { LT_PATTERNS, UNIT_MM } from '../model/document';
import { v, sweep } from '../model/geom';
import { hexToAci } from './colors';

const INSUNITS: Record<string, number> = { mm: 4, cm: 5, m: 6 };
const LT_DXF: Record<LineType, string> = { continuous: 'CONTINUOUS', dashed: 'DASHED', hidden: 'HIDDEN', center: 'CENTER', dashdot: 'DASHDOT' };

const num = (x: number) => (Math.abs(x) < 1e-12 ? '0' : Number(x.toFixed(9)).toString());
const deg = (r: number) => num((((r * 180) / Math.PI) % 360 + 360) % 360);

/** Caratteri oltre l'ASCII come \U+XXXX, che AutoCAD e DraftSight interpretano. */
function enc(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c < 128 ? ch : `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

function layerName(n: string): string {
  return enc(n).replace(/[<>/\\":;?*|=`]/g, '_') || '0';
}

class W {
  private out: string[] = [];
  g(code: number, val: string | number) {
    this.out.push(String(code), typeof val === 'number' ? num(val) : val);
  }
  text() { return this.out.join('\r\n') + '\r\n'; }
}

export function exportDxf(doc: Doc): string {
  const w = new W();
  const ext = doc.extents() ?? { x0: 0, y0: 0, x1: 100, y1: 100 };
  const ltUnit = (doc.settings.ltScale * 50) / UNIT_MM[doc.settings.units];

  w.g(0, 'SECTION'); w.g(2, 'HEADER');
  w.g(9, '$ACADVER'); w.g(1, 'AC1009');
  w.g(9, '$INSUNITS'); w.g(70, INSUNITS[doc.settings.units]);
  w.g(9, '$EXTMIN'); w.g(10, ext.x0); w.g(20, ext.y0); w.g(30, 0);
  w.g(9, '$EXTMAX'); w.g(10, ext.x1); w.g(20, ext.y1); w.g(30, 0);
  w.g(9, '$LTSCALE'); w.g(40, 1);
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION'); w.g(2, 'TABLES');
  const lts = Object.keys(LT_DXF) as LineType[];
  w.g(0, 'TABLE'); w.g(2, 'LTYPE'); w.g(70, lts.length);
  for (const lt of lts) {
    const pat = LT_PATTERNS[lt].map(x => x * ltUnit);
    w.g(0, 'LTYPE'); w.g(2, LT_DXF[lt]); w.g(70, 0); w.g(3, lt === 'continuous' ? 'Solid line' : LT_DXF[lt]);
    w.g(72, 65); w.g(73, pat.length); w.g(40, pat.reduce((a, b) => a + b, 0));
    pat.forEach((x, i) => w.g(49, i % 2 ? -x : x));
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE'); w.g(2, 'LAYER'); w.g(70, doc.layers.length);
  for (const l of doc.layers) {
    w.g(0, 'LAYER'); w.g(2, layerName(l.name)); w.g(70, 0);
    const c = hexToAci(l.color);
    w.g(62, l.visible ? c : -c); w.g(6, LT_DXF[l.lt]);
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE'); w.g(2, 'STYLE'); w.g(70, 1);
  w.g(0, 'STYLE'); w.g(2, 'STANDARD'); w.g(70, 0); w.g(40, 0); w.g(41, 1); w.g(50, 0); w.g(71, 0); w.g(42, 2.5); w.g(3, 'txt'); w.g(4, '');
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION'); w.g(2, 'BLOCKS'); w.g(0, 'ENDSEC');

  w.g(0, 'SECTION'); w.g(2, 'ENTITIES');
  const ctx = doc.ctx();
  // i blocchi escono aperti nel loro contenuto: il DXF R12 scritto qui non ha definizioni di blocco
  for (const e of flatEnts(doc.ents, doc.blocks)) writeEnt(w, e, prims(e, ctx));
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return w.text();
}

function head(w: W, type: string, e: Ent) {
  w.g(0, type);
  w.g(8, layerName(e.layer));
  if (e.color) w.g(62, hexToAci(e.color));
}

function writeEnt(w: W, e: Ent, ps: Prim[]) {
  switch (e.t) {
    case 'line':
      head(w, 'LINE', e);
      w.g(10, e.a.x); w.g(20, e.a.y); w.g(30, 0); w.g(11, e.b.x); w.g(21, e.b.y); w.g(31, 0);
      return;
    case 'poly':
      head(w, 'POLYLINE', e); w.g(66, 1); w.g(10, 0); w.g(20, 0); w.g(30, 0); w.g(70, e.closed ? 1 : 0);
      e.pts.forEach((p, i) => {
        head(w, 'VERTEX', e); w.g(10, p.x); w.g(20, p.y); w.g(30, 0);
        const b = e.bulges?.[i] ?? 0;
        if (Math.abs(b) > 1e-12) w.g(42, b);
      });
      head(w, 'SEQEND', e);
      return;
    case 'circle':
      head(w, 'CIRCLE', e); w.g(10, e.c.x); w.g(20, e.c.y); w.g(30, 0); w.g(40, e.r);
      return;
    case 'arc':
      head(w, 'ARC', e); w.g(10, e.c.x); w.g(20, e.c.y); w.g(30, 0); w.g(40, e.r); w.g(50, deg(e.a0)); w.g(51, deg(e.a0 + sweep(e.a0, e.a1)));
      return;
  }
  for (const p of ps) writePrim(w, e, p);
}

function writePrim(w: W, e: Ent, p: Prim) {
  switch (p.k) {
    case 'pl': {
      if (p.stroke === false && p.fill !== 'solid') return;
      if (p.pts.length === 2 && !p.closed) {
        head(w, 'LINE', e);
        w.g(10, p.pts[0].x); w.g(20, p.pts[0].y); w.g(30, 0); w.g(11, p.pts[1].x); w.g(21, p.pts[1].y); w.g(31, 0);
        return;
      }
      head(w, 'POLYLINE', e); w.g(66, 1); w.g(10, 0); w.g(20, 0); w.g(30, 0); w.g(70, p.closed ? 1 : 0);
      for (const q of p.pts) { head(w, 'VERTEX', e); w.g(10, q.x); w.g(20, q.y); w.g(30, 0); }
      head(w, 'SEQEND', e);
      return;
    }
    case 'area':
      for (const l of p.loops) writePrim(w, e, { k: 'pl', pts: l, closed: true });
      return;
    case 'arc':
      if (p.full) { head(w, 'CIRCLE', e); w.g(10, p.c.x); w.g(20, p.c.y); w.g(30, 0); w.g(40, p.r); return; }
      head(w, 'ARC', e); w.g(10, p.c.x); w.g(20, p.c.y); w.g(30, 0); w.g(40, p.r); w.g(50, deg(p.a0)); w.g(51, deg(p.a0 + sweep(p.a0, p.a1)));
      return;
    case 'text': {
      const co = Math.cos(p.rot), si = Math.sin(p.rot);
      const ha = p.ha === 'l' ? 0 : p.ha === 'c' ? 1 : 2;
      for (const l of textLines(p)) {
        if (!l.s) continue;
        const q = v(p.p.x - l.y * si, p.p.y + l.y * co);
        head(w, 'TEXT', e);
        w.g(10, q.x); w.g(20, q.y); w.g(30, 0); w.g(40, p.h); w.g(1, enc(l.s)); w.g(50, deg(p.rot));
        if (ha) { w.g(72, ha); w.g(11, q.x); w.g(21, q.y); w.g(31, 0); }
      }
      return;
    }
  }
}
