// Conversione di disegni DXF/DWG nelle entità del programma.
import type { Ent, NewEnt, HAlign, VAlign, Blocks } from '../model/entities';
import { transform, entBox, DEFAULT_CTX } from '../model/entities';
import type { Layer, LineType, Units } from '../model/document';
import { UNIT_MM } from '../model/document';
import {
  Vec, Mat, v, add, dist, len, IDENT, apply, applyDir, compose, translate, rotateAbout, scaleAbout,
  det, matScale, isUniform, mapAngle, bulgeArc, sweep, tessArc, TAU, cross,
} from '../model/geom';
import { aciToHex, rgbIntToHex } from './colors';

// ---------------------------------------------------------------- formato intermedio

interface RawBase { layer: string; colorIndex?: number; trueColor?: number; lineType?: string }
export type RawEnt = RawBase & (
  | { type: 'LINE'; a: Vec; b: Vec }
  | { type: 'POLY'; pts: (Vec & { bulge?: number })[]; closed: boolean }
  | { type: 'CIRCLE'; c: Vec; r: number }
  | { type: 'ARC'; c: Vec; r: number; a0: number; a1: number }
  | { type: 'ELLIPSE'; c: Vec; major: Vec; ratio: number; a0: number; a1: number }
  | { type: 'SPLINE'; ctrl: Vec[]; fit: Vec[]; degree: number; knots: number[]; weights?: number[]; closed: boolean }
  | { type: 'TEXT'; p: Vec; s: string; h: number; rot: number; ha: HAlign; va: VAlign }
  | { type: 'SOLID'; pts: Vec[] }
  | { type: 'HATCH'; loops: Vec[][]; solid: boolean; ang: number; sp: number; cross: boolean }
  | { type: 'INSERT'; name: string; p: Vec; sx: number; sy: number; rot: number; cols: number; rows: number; colSp: number; rowSp: number; attribs: RawEnt[] }
);

export interface RawBlock { base: Vec; ents: RawEnt[] }
export interface RawLayer { name: string; colorIndex?: number; trueColor?: number; off?: boolean; frozen?: boolean; lineType?: string }

export interface RawDrawing {
  ents: RawEnt[];
  blocks: Map<string, RawBlock>;
  layers: RawLayer[];
  insUnits?: number;
}

export interface ImportResult {
  ents: NewEnt[];
  layers: Layer[];
  /** definizioni dei blocchi usati dagli inserimenti in ents */
  blocks: Blocks;
  srcUnits: Units | null;
  scale: number;
  skipped: Map<string, number>;
  warnings: string[];
}

const INSUNITS: Record<number, Units> = { 4: 'mm', 5: 'cm', 6: 'm' };

export function mapLineType(name?: string): LineType {
  const n = (name ?? '').toUpperCase();
  if (/HIDDEN|NASC/.test(n)) return 'hidden';
  if (/CENTER|ASSE|DASHDOT|PHANTOM/.test(n)) return n.includes('DASHDOT') ? 'dashdot' : 'center';
  if (/DASH|TRATT|DOT/.test(n)) return 'dashed';
  return 'continuous';
}

/** Pulizia dei codici di formattazione MTEXT. */
export function cleanMText(s: string): string {
  return s
    .replace(/\\P/g, '\n')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g, '$1/$2')
    .replace(/\\[ACcFfHhQTWp][^;]*;/g, '')
    .replace(/\\[LlOoKkNX]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%')
    .replace(/%%[uUoO]/g, '');
}

// ---------------------------------------------------------------- spline

function deBoor(ctrl: Vec[], degree: number, knots: number[], weights: number[] | undefined, n: number): Vec[] {
  const p = Math.max(1, Math.min(degree, ctrl.length - 1));
  let K = knots;
  if (K.length !== ctrl.length + p + 1) {
    // nodi uniformi "clamped" se mancano o non tornano
    K = [];
    const m = ctrl.length - p;
    for (let i = 0; i <= p; i++) K.push(0);
    for (let i = 1; i < m; i++) K.push(i / m);
    for (let i = 0; i <= p; i++) K.push(1);
  }
  const w = weights && weights.length === ctrl.length ? weights : ctrl.map(() => 1);
  const t0 = K[p], t1 = K[K.length - p - 1];
  const out: Vec[] = [];
  for (let s = 0; s <= n; s++) {
    const t = s === n ? t1 - 1e-12 * Math.max(1, Math.abs(t1)) : t0 + ((t1 - t0) * s) / n;
    let k = p;
    while (k < K.length - p - 2 && t >= K[k + 1]) k++;
    const d: { x: number; y: number; w: number }[] = [];
    for (let j = 0; j <= p; j++) {
      const c = ctrl[k - p + j], ww = w[k - p + j];
      d.push({ x: c.x * ww, y: c.y * ww, w: ww });
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const den = K[i + p - r + 1] - K[i];
        const a = den === 0 ? 0 : (t - K[i]) / den;
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
      }
    }
    out.push(v(d[p].x / d[p].w, d[p].y / d[p].w));
  }
  return out;
}

// ---------------------------------------------------------------- costruzione

class Builder {
  ents: NewEnt[] = [];
  skipped = new Map<string, number>();
  warnings: string[] = [];
  private group = 0;
  /** blocchi del file diventati blocchi di Kalista (quelli inseriti in modo semplice) */
  blocks: Blocks = {};
  private building = new Set<string>();

  /** unit = fattore fra le unità del file e quelle del disegno, già dentro le definizioni dei blocchi */
  constructor(private drawing: RawDrawing, private unit = 1) {}

  /** Costruisce la definizione di un blocco del file. false se non si può (manca, o contiene se stesso). */
  private define(name: string): boolean {
    if (this.blocks[name]) return true;
    const blk = this.drawing.blocks.get(name);
    if (!blk || this.building.has(name)) return false;
    this.building.add(name);
    const outer = this.ents;
    this.ents = [];
    // dentro la definizione il punto base va nell'origine; il layer 0 resta 0 e prenderà quello dell'inserimento
    this.walk(blk.ents, compose(scaleAbout(v(0, 0), this.unit), translate(-blk.base.x, -blk.base.y)), null, undefined, 1, undefined);
    const ents = this.ents.map((e, i) => ({ ...e, id: i + 1 }) as Ent);
    this.ents = outer;
    this.building.delete(name);
    // un blocco senza niente di disegnabile (solo definizioni di attributi) non diventa un blocco
    if (!ents.length) return false;
    this.blocks[name] = { ents };
    return true;
  }

  skip(t: string) { this.skipped.set(t, (this.skipped.get(t) ?? 0) + 1); }

  private colorOf(e: RawBase, inherited: string | undefined): string | undefined {
    const ci = e.colorIndex;
    if (ci === undefined && e.trueColor !== undefined) return rgbIntToHex(e.trueColor);
    if (ci === 0) return inherited; // DaBlocco
    if (ci === undefined || ci === 256 || ci < 0) return undefined; // DaLayer
    return aciToHex(ci);
  }

  walk(list: RawEnt[], m: Mat, parentLayer: string | null, parentColor: string | undefined, depth: number, g: number | undefined) {
    for (const e of list) {
      const layer = parentLayer && (e.layer === '0' || !e.layer) ? parentLayer : e.layer || '0';
      this.one(e, m, layer, this.colorOf(e, parentColor), depth, g);
    }
  }

  private push(e: NewEnt, g: number | undefined) {
    if (g !== undefined) e.g = g;
    this.ents.push(e);
  }

  private one(e: RawEnt, m: Mat, layer: string, color: string | undefined, depth: number, g: number | undefined) {
    const base: { layer: string; color?: string; lt?: LineType } = color ? { layer, color } : { layer };
    // tipo di linea dato alla singola entità (non DaLayer né DaBlocco)
    if (e.lineType && !/^BY(LAYER|BLOCK)$/i.test(e.lineType)) base.lt = mapLineType(e.lineType);
    const P = (p: Vec) => apply(m, p);
    const uniform = isUniform(m);
    const mirror = det(m) < 0;
    switch (e.type) {
      case 'LINE':
        if (dist(e.a, e.b) > 0) this.push({ ...base, t: 'line', a: P(e.a), b: P(e.b) }, g);
        break;
      case 'POLY': {
        // vertici doppi: si tiene il primo, ma con la curvatura del secondo (è quella del tratto che segue)
        const pts: typeof e.pts = [];
        for (const q of e.pts) {
          const last = pts[pts.length - 1];
          if (last && dist(q, last) <= 1e-12) {
            if (Math.abs(q.bulge ?? 0) > 1e-9) pts[pts.length - 1] = { ...last, bulge: q.bulge };
            continue;
          }
          pts.push(q);
        }
        if (pts.length < 2) break;
        if (e.closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-12) pts.pop();
        const hasBulge = pts.some(q => Math.abs(q.bulge ?? 0) > 1e-9);
        if (hasBulge && !uniform) {
          this.push({ ...base, t: 'poly', pts: tessBulges(pts, e.closed).map(P), closed: e.closed }, g);
        } else {
          const ent: NewEnt = { ...base, t: 'poly', pts: pts.map(P), closed: e.closed };
          if (hasBulge) ent.bulges = pts.map(q => (mirror ? -(q.bulge ?? 0) : q.bulge ?? 0));
          this.push(ent, g);
        }
        break;
      }
      case 'CIRCLE':
        if (e.r <= 0) break;
        if (uniform) this.push({ ...base, t: 'circle', c: P(e.c), r: e.r * matScale(m) }, g);
        else this.push({ ...base, t: 'poly', pts: tessArc(e.c, e.r, 0, TAU).slice(0, -1).map(P), closed: true }, g);
        break;
      case 'ARC': {
        if (e.r <= 0) break;
        if (uniform) {
          const a0 = mapAngle(m, e.a0), a1 = mapAngle(m, e.a1);
          this.push({ ...base, t: 'arc', c: P(e.c), r: e.r * matScale(m), a0: mirror ? a1 : a0, a1: mirror ? a0 : a1 }, g);
        } else this.push({ ...base, t: 'poly', pts: tessArc(e.c, e.r, e.a0, sweep(e.a0, e.a1)).map(P), closed: false }, g);
        break;
      }
      case 'ELLIPSE': {
        const R = len(e.major);
        if (R <= 0) break;
        const rot = Math.atan2(e.major.y, e.major.x);
        const full = Math.abs(sweep(e.a0, e.a1) - TAU) < 1e-6 || Math.abs(e.a1 - e.a0) < 1e-9;
        if (uniform) {
          const el: NewEnt = { ...base, t: 'ellipse', c: P(e.c), a: applyDir(m, e.major), k: e.ratio };
          // arco di ellisse: allo specchio il verso di percorrenza si inverte
          if (!full && el.t === 'ellipse') { el.a0 = mirror ? -e.a1 : e.a0; el.a1 = mirror ? -e.a0 : e.a1; }
          this.push(el, g);
          break;
        }
        const sw = full ? TAU : sweep(e.a0, e.a1);
        const n = Math.max(24, Math.ceil(sw / (Math.PI / 48)));
        const pts: Vec[] = [];
        for (let i = 0; i <= n; i++) {
          const t = e.a0 + (sw * i) / n;
          const lx = R * Math.cos(t), ly = R * e.ratio * Math.sin(t);
          pts.push(add(e.c, v(lx * Math.cos(rot) - ly * Math.sin(rot), lx * Math.sin(rot) + ly * Math.cos(rot))));
        }
        if (full) pts.pop();
        this.push({ ...base, t: 'poly', pts: pts.map(P), closed: full }, g);
        break;
      }
      case 'SPLINE': {
        let pts: Vec[];
        if (e.ctrl.length >= 2) pts = deBoor(e.ctrl, e.degree, e.knots, e.weights, Math.min(400, Math.max(16, e.ctrl.length * 8)));
        else if (e.fit.length >= 2) pts = e.fit;
        else break;
        this.push({ ...base, t: 'poly', pts: pts.map(P), closed: e.closed }, g);
        break;
      }
      case 'TEXT': {
        const s = e.s.trim() ? e.s : '';
        if (!s || e.h <= 0) break;
        const rot = mirror ? mapAngle(m, e.rot) + (Math.cos(mapAngle(m, e.rot)) < 0 ? Math.PI : 0) : mapAngle(m, e.rot);
        this.push({ ...base, t: 'text', p: P(e.p), s, h: e.h * matScale(m), rot, ha: e.ha, va: e.va }, g);
        break;
      }
      case 'SOLID': {
        const q = e.pts.length === 4 && dist(e.pts[2], e.pts[3]) > 1e-12 ? [e.pts[0], e.pts[1], e.pts[3], e.pts[2]] : e.pts.slice(0, 3);
        this.push({ ...base, t: 'hatch', loops: [q.map(P)], pat: 'solid', sp: 1, ang: 0 }, g);
        break;
      }
      case 'HATCH': {
        const loops = e.loops.filter(l => l.length >= 3).map(l => l.map(P));
        if (!loops.length) break;
        this.push({
          ...base, t: 'hatch', loops, pat: e.solid ? 'solid' : e.cross ? 'ansi37' : 'ansi31',
          sp: Math.max(1e-6, e.sp * matScale(m)), ang: mapAngle(m, e.ang),
        }, g);
        break;
      }
      case 'INSERT': {
        const blk = this.drawing.blocks.get(e.name);
        if (!blk) { this.skip(`blocco mancante ${e.name}`); break; }
        if (depth > 12) { this.warnings.push(`Blocchi annidati troppo in profondità (${e.name}).`); break; }
        const cols = Math.max(1, e.cols || 1), rows = Math.max(1, e.rows || 1);
        const sx = e.sx || 1, sy = e.sy || 1;
        // Inserimento semplice (una copia, stessa scala nei due versi, senza attributi, blocco con un nome
        // vero): resta un blocco, modificabile. Gli altri casi si aprono nelle loro entità, raggruppate.
        // (un inserimento con un colore suo resta aperto: nel blocco quel colore vale solo per ciò che è
        // DaBlocco, e nella definizione DaBlocco e DaLayer non si distinguono più)
        const simple = g === undefined && color === undefined && cols === 1 && rows === 1 && !e.attribs.length && !e.name.startsWith('*')
          && Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-9 * Math.abs(sx) && uniform && !mirror;
        if (simple && this.define(e.name)) {
          const ins: NewEnt = { ...base, t: 'insert', name: e.name, p: P(e.p), s: (Math.abs(sx) * matScale(m)) / this.unit, rot: mapAngle(m, e.rot) + (sy < 0 ? Math.PI : 0) };
          if (sx < 0 !== sy < 0) ins.flip = true;
          this.push(ins, g);
          break;
        }
        const gid = g ?? ++this.group;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const off = v(c * (e.colSp || 0), r * (e.rowSp || 0));
            const local = compose(
              translate(e.p.x, e.p.y),
              compose(rotateAbout(v(0, 0), e.rot), compose(translate(off.x, off.y), compose(scaleAbout(v(0, 0), e.sx || 1, e.sy || 1), translate(-blk.base.x, -blk.base.y)))),
            );
            this.walk(blk.ents, compose(m, local), layer, color, depth + 1, gid);
          }
        }
        if (e.attribs.length) this.walk(e.attribs, m, layer, color, depth + 1, gid);
        break;
      }
    }
  }

}

function tessBulges(pts: (Vec & { bulge?: number })[], closed: boolean): Vec[] {
  const out: Vec[] = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const bu = a.bulge ?? 0;
    if (Math.abs(bu) > 1e-9) {
      const arc = bulgeArc(a, b, bu);
      let ps = tessArc(arc.c, arc.r, arc.a0, sweep(arc.a0, arc.a1));
      if (bu < 0) ps = ps.reverse();
      out.push(...ps.slice(0, -1));
    } else out.push(v(a.x, a.y));
  }
  if (!closed) out.push(v(pts[n - 1].x, pts[n - 1].y));
  return out;
}

/**
 * Rifà la conversione di un import supponendo che le misure del file siano in src, qualunque cosa
 * il file dichiari: molti DWG dichiarano millimetri pur essendo disegnati in metri o centimetri.
 */
export function rescaleImport(r: ImportResult, src: Units, docUnits: Units): ImportResult {
  const scale = UNIT_MM[src] / UNIT_MM[docUnits];
  const f = scale / r.scale;
  // l'unità ora l'ha scelta chi importa: l'avviso sul file che non la dichiara non serve più
  const warnings = r.warnings.filter(w => !w.includes('non dichiara le unità'));
  if (Math.abs(f - 1) < 1e-12) return { ...r, warnings, srcUnits: src, scale };
  const m = scaleAbout(v(0, 0), f);
  // di un inserimento si sposta solo il punto: la scala la porta la definizione del blocco, riscalata anche lei
  const conv = (e: Ent): Ent => (e.t === 'insert' ? { ...e, p: v(e.p.x * f, e.p.y * f) } : transform(e, m));
  const ents = r.ents.map(e => { const { id: _id, ...rest } = conv({ ...e, id: 0 } as Ent); return rest as NewEnt; });
  const blocks = Object.fromEntries(Object.entries(r.blocks).map(([k, d]) => [k, { ents: d.ents.map(conv) }]));
  return { ...r, ents, blocks, warnings, srcUnits: src, scale };
}

/** Larghezza e altezza del disegno importato, nelle unità del file. */
export function importSize(r: ImportResult): { w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ctx = { ...DEFAULT_CTX, blocks: r.blocks };
  for (const e of r.ents) {
    const b = entBox({ ...e, id: 0 } as Ent, ctx);
    if (b.x0 > b.x1 || b.y0 > b.y1) continue;
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  if (x0 > x1) return null;
  return { w: (x1 - x0) / r.scale, h: (y1 - y0) / r.scale };
}

/**
 * Unità più credibile per un disegno di quelle dimensioni: quella dichiarata, se dà un disegno fra
 * 3 m e 1 km; altrimenti quella che più lo avvicina alla taglia di un edificio. È solo la proposta
 * iniziale: la scelta resta a chi importa, che vede le dimensioni risultanti.
 */
export function guessUnits(size: { w: number; h: number } | null, declared: Units | null, fallback: Units): Units {
  if (!size) return declared ?? fallback;
  const metres = (u: Units) => (Math.max(size.w, size.h) * UNIT_MM[u]) / 1000;
  const ok = (u: Units) => metres(u) >= 3 && metres(u) <= 1000;
  if (declared && ok(declared)) return declared;
  const all: Units[] = ['mm', 'cm', 'm'];
  const good = all.filter(ok);
  if (!good.length) return declared ?? fallback;
  return good.reduce((a, b) => (Math.abs(Math.log10(metres(b) / 20)) < Math.abs(Math.log10(metres(a) / 20)) ? b : a));
}

/** Converte un disegno intermedio nelle unità del documento. */
export function buildImport(d: RawDrawing, docUnits: Units): ImportResult {
  const srcUnits = d.insUnits !== undefined ? INSUNITS[d.insUnits] ?? null : null;
  const scale = srcUnits ? UNIT_MM[srcUnits] / UNIT_MM[docUnits] : 1;
  const layers: Layer[] = d.layers.map(l => ({
    name: l.name,
    color: l.trueColor !== undefined && l.trueColor > 0 && !(l.colorIndex && l.colorIndex > 0 && l.colorIndex < 256) ? rgbIntToHex(l.trueColor) : aciToHex(Math.abs(l.colorIndex ?? 7) || 7),
    lw: 0.25,
    lt: mapLineType(l.lineType),
    visible: !l.off && !l.frozen && (l.colorIndex ?? 1) >= 0,
    locked: false,
  }));
  const lc = new Map(layers.map(l => [l.name, l.color]));
  const b = new Builder(d, scale);
  const m0 = scale === 1 ? IDENT : scaleAbout(v(0, 0), scale);
  b.walk(d.ents, m0, null, undefined, 0, undefined);
  for (const e of [...b.ents, ...Object.values(b.blocks).flatMap(x => x.ents)]) if (!lc.has(e.layer)) {
    lc.set(e.layer, '#ffffff');
    layers.push({ name: e.layer, color: '#ffffff', lw: 0.25, lt: 'continuous', visible: true, locked: false });
  }
  const warnings = [...b.warnings];
  if (!srcUnits) warnings.push('Il file non dichiara le unità: le coordinate sono state prese così come sono.');
  return { ents: b.ents, blocks: b.blocks, layers, srcUnits, scale, skipped: b.skipped, warnings };
}

// ---------------------------------------------------------------- adattatore DXF (dxf-parser)

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = any;

const P2 = (p: AnyObj): Vec => v(p?.x ?? 0, p?.y ?? 0);
const DEG = Math.PI / 180;

function textAlign(halign: number | undefined, valign: number | undefined): { ha: HAlign; va: VAlign } {
  const h = halign ?? 0, vv = valign ?? 0;
  const ha: HAlign = h === 1 || h === 4 ? 'c' : h === 2 ? 'r' : h === 3 || h === 5 ? 'l' : 'l';
  const va: VAlign = h === 4 ? 'm' : vv === 3 ? 't' : vv === 2 ? 'm' : 'b';
  return { ha, va };
}

function mtextAlign(ap: number | undefined): { ha: HAlign; va: VAlign } {
  const a = ap ?? 1;
  const col = (a - 1) % 3, row = Math.floor((a - 1) / 3);
  return { ha: col === 0 ? 'l' : col === 1 ? 'c' : 'r', va: row === 0 ? 't' : row === 1 ? 'm' : 'b' };
}

/** Testo di TEXT e ATTRIB: solo i codi %% e \U+, senza i codici di formato che valgono per MTEXT. */
export function cleanText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%')
    .replace(/%%[uUoO]/g, '');
}

/**
 * Archi, cerchi, polilinee e blocchi con la normale verso -Z (tipici dopo aver esploso un blocco
 * specchiato) hanno le coordinate in un sistema con la X rovesciata: qui si riportano dritte.
 */
function unflip(e: RawEnt): RawEnt {
  const fx = (p: Vec): Vec => v(-p.x, p.y);
  switch (e.type) {
    case 'POLY': return { ...e, pts: e.pts.map(q => ({ x: -q.x, y: q.y, bulge: -(q.bulge ?? 0) })) };
    case 'CIRCLE': return { ...e, c: fx(e.c) };
    case 'ARC': return { ...e, c: fx(e.c), a0: Math.PI - e.a1, a1: Math.PI - e.a0 };
    case 'SOLID': return { ...e, pts: e.pts.map(fx) };
    // l'ellisse ha già centro e asse nel sistema del disegno: cambia solo il verso in cui si percorre l'arco
    case 'ELLIPSE': return { ...e, a0: -e.a1, a1: -e.a0 };
    case 'INSERT': return { ...e, p: fx(e.p), sx: -e.sx, rot: -e.rot };
    default: return e;
  }
}

/** Nomi (di layer) con i caratteri oltre l'ASCII scritti come \U+XXXX. */
const uni = (s: string): string => s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const negZ = (e: AnyObj): boolean => (e.extrusionDirectionZ ?? e.extrusionDirection?.z ?? 1) < 0;

function common(e: AnyObj): RawBase {
  const out: RawBase = { layer: uni(String(e.layer ?? '0')) };
  // con il colore vero (gruppo 420) c'è quasi sempre anche un indice approssimato: vince il colore vero
  const ci = typeof e.colorIndex === 'number' ? e.colorIndex : undefined;
  const isTrue = typeof e.color === 'number' && (ci === undefined || (ci > 0 && ci < 256 && rgbIntToHex(e.color) !== aciToHex(ci)));
  if (isTrue) out.trueColor = e.color;
  else if (ci !== undefined) out.colorIndex = ci;
  if (e.lineType) out.lineType = e.lineType;
  return out;
}

function fromDxfEntity(e: AnyObj, out: RawEnt[], skip: (t: string) => void) {
  if (e.visible === false) return; // entità resa invisibile nel file (gruppo 60)
  const first = out.length;
  dxfEntity(e, out, skip);
  if (negZ(e)) for (let i = first; i < out.length; i++) out[i] = unflip(out[i]);
}

function dxfEntity(e: AnyObj, out: RawEnt[], skip: (t: string) => void) {
  const c = common(e);
  switch (e.type) {
    case 'LINE': out.push({ ...c, type: 'LINE', a: P2(e.vertices?.[0]), b: P2(e.vertices?.[1]) }); break;
    case 'LWPOLYLINE': case 'POLYLINE':
      if (e.is3dPolyline === undefined && (e.isPolyfaceMesh || e.is3dPolygonMesh)) { skip('mesh 3D'); break; }
      out.push({ ...c, type: 'POLY', pts: (e.vertices ?? []).filter((q: AnyObj) => !q.splineControlPoint).map((q: AnyObj) => ({ x: q.x, y: q.y, bulge: q.bulge ?? 0 })), closed: !!e.shape });
      break;
    case 'CIRCLE': out.push({ ...c, type: 'CIRCLE', c: P2(e.center), r: e.radius }); break;
    case 'ARC': out.push({ ...c, type: 'ARC', c: P2(e.center), r: e.radius, a0: e.startAngle, a1: e.endAngle }); break;
    case 'ELLIPSE': out.push({ ...c, type: 'ELLIPSE', c: P2(e.center), major: P2(e.majorAxisEndPoint), ratio: e.axisRatio, a0: e.startAngle ?? 0, a1: e.endAngle ?? TAU }); break;
    case 'SPLINE': out.push({ ...c, type: 'SPLINE', ctrl: (e.controlPoints ?? []).map(P2), fit: (e.fitPoints ?? []).map(P2), degree: e.degreeOfSplineCurve ?? 3, knots: e.knotValues ?? [], closed: !!e.closed }); break;
    case 'TEXT': {
      const al = textAlign(e.halign, e.valign);
      // con Allinea (3) e Adatta (5) il secondo punto è la fine del testo, non l'ancoraggio
      const useEnd = e.endPoint && (e.valign || [1, 2, 4].includes(e.halign));
      out.push({ ...c, type: 'TEXT', p: P2(useEnd ? e.endPoint : e.startPoint), s: cleanText(String(e.text ?? '')), h: e.textHeight ?? 1, rot: (e.rotation ?? 0) * DEG, ...al });
      break;
    }
    case 'MTEXT': {
      const rot = e.directionVector && (e.directionVector.x || e.directionVector.y) ? Math.atan2(e.directionVector.y, e.directionVector.x) : (e.rotation ?? 0) * DEG;
      out.push({ ...c, type: 'TEXT', p: P2(e.position), s: cleanMText(String(e.text ?? '')), h: e.height ?? 1, rot, ...mtextAlign(e.attachmentPoint) });
      break;
    }
    case 'ATTRIB': case 'ATTDEF': break;
    case 'INSERT':
      out.push({
        ...c, type: 'INSERT', name: e.name, p: P2(e.position), sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: (e.rotation ?? 0) * DEG,
        cols: e.columnCount ?? 1, rows: e.rowCount ?? 1, colSp: e.columnSpacing ?? 0, rowSp: e.rowSpacing ?? 0, attribs: [],
      });
      break;
    case 'DIMENSION':
      if (e.block) out.push({ ...c, type: 'INSERT', name: e.block, p: v(0, 0), sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, colSp: 0, rowSp: 0, attribs: [] });
      break;
    case 'SOLID': out.push({ ...c, type: 'SOLID', pts: (e.points ?? []).map(P2) }); break;
    case 'POINT': break;
    default: skip(String(e.type));
  }
}

export function fromDxfParser(dxf: AnyObj): { drawing: RawDrawing; skipped: Map<string, number> } {
  const skipped = new Map<string, number>();
  const skip = (t: string) => skipped.set(t, (skipped.get(t) ?? 0) + 1);
  const ents: RawEnt[] = [];
  for (const e of dxf.entities ?? []) if (!e.inPaperSpace) fromDxfEntity(e, ents, skip);
  const blocks = new Map<string, RawBlock>();
  for (const [name, b] of Object.entries<AnyObj>(dxf.blocks ?? {})) {
    const list: RawEnt[] = [];
    for (const e of b.entities ?? []) fromDxfEntity(e, list, skip);
    blocks.set(name, { base: P2(b.position), ents: list });
  }
  const layers: RawLayer[] = Object.values<AnyObj>(dxf.tables?.layer?.layers ?? {}).map(l => ({
    name: uni(String(l.name)), colorIndex: l.colorIndex, off: l.visible === false, frozen: !!l.frozen, lineType: l.lineType,
  }));
  const insUnits = dxf.header?.$INSUNITS;
  return { drawing: { ents, blocks, layers, insUnits: typeof insUnits === 'number' && insUnits > 0 ? insUnits : undefined }, skipped };
}

// ---------------------------------------------------------------- adattatore DWG (libredwg-web)

function dwgCommon(e: AnyObj): RawBase {
  const out: RawBase = { layer: String(e.layer ?? '0') };
  if (typeof e.colorIndex === 'number') out.colorIndex = e.colorIndex;
  if (typeof e.color === 'number' && e.color >= 0 && out.colorIndex === undefined) out.trueColor = e.color;
  if (e.lineType) out.lineType = e.lineType;
  return out;
}

function hatchLoops(e: AnyObj): Vec[][] {
  const loops: Vec[][] = [];
  for (const path of e.boundaryPaths ?? []) {
    if (path.vertices) {
      const pts = (path.vertices as AnyObj[]).map(q => ({ x: q.x, y: q.y, bulge: q.bulge ?? 0 }));
      if (pts.length >= 2) loops.push(tessBulges(pts, true));
      continue;
    }
    const loop: Vec[] = [];
    for (const ed of path.edges ?? []) {
      if (ed.start && ed.end && ed.radius === undefined && ed.lengthOfMinorAxis === undefined) { loop.push(P2(ed.start)); continue; }
      if (ed.radius !== undefined) {
        const ccw = ed.isCCW !== false;
        let a0 = ed.startAngle, a1 = ed.endAngle;
        if (!ccw) { a0 = -a0; a1 = -a1; }
        const sw = ccw ? sweep(a0, a1) : -sweep(a1, a0);
        loop.push(...tessArc(P2(ed.center), ed.radius, a0, sw).slice(0, -1));
        continue;
      }
      if (ed.lengthOfMinorAxis !== undefined) {
        const c = P2(ed.center), maj = P2(ed.end);
        // libredwg-web mette qui il rapporto fra gli assi, non una lunghezza
        const R = len(maj), ratio = ed.lengthOfMinorAxis;
        const rot = Math.atan2(maj.y, maj.x);
        const ccw = ed.isCCW !== false;
        const sw = ccw ? sweep(ed.startAngle, ed.endAngle) : -sweep(ed.endAngle, ed.startAngle);
        for (let i = 0; i < 32; i++) {
          const t = ed.startAngle + (sw * i) / 32;
          const lx = R * Math.cos(t), ly = R * ratio * Math.sin(t);
          loop.push(add(c, v(lx * Math.cos(rot) - ly * Math.sin(rot), lx * Math.sin(rot) + ly * Math.cos(rot))));
        }
        continue;
      }
      if (ed.controlPoints) loop.push(...deBoor((ed.controlPoints as AnyObj[]).map(P2), ed.degree ?? 3, ed.knots ?? [], undefined, 24).slice(0, -1));
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function fromDwgEntity(e: AnyObj, out: RawEnt[], skip: (t: string) => void) {
  if (e.isVisible === false) return; // entità resa invisibile nel file
  const first = out.length;
  dwgEntity(e, out, skip);
  if (negZ(e)) for (let i = first; i < out.length; i++) out[i] = unflip(out[i]);
}

function dwgEntity(e: AnyObj, out: RawEnt[], skip: (t: string) => void) {
  const c = dwgCommon(e);
  switch (e.type) {
    case 'LINE': out.push({ ...c, type: 'LINE', a: P2(e.startPoint), b: P2(e.endPoint) }); break;
    case 'LWPOLYLINE':
      out.push({ ...c, type: 'POLY', pts: (e.vertices ?? []).map((q: AnyObj) => ({ x: q.x, y: q.y, bulge: q.bulge ?? 0 })), closed: ((e.flag ?? 0) & 0x200) !== 0 });
      break;
    case 'POLYLINE2D': case 'POLYLINE3D':
      out.push({ ...c, type: 'POLY', pts: (e.vertices ?? []).filter((q: AnyObj) => !((q.flag ?? 0) & 16)).map((q: AnyObj) => ({ x: q.x, y: q.y, bulge: q.bulge ?? 0 })), closed: !!((e.flag ?? 0) & 1) });
      break;
    case 'CIRCLE': out.push({ ...c, type: 'CIRCLE', c: P2(e.center), r: e.radius }); break;
    case 'ARC': out.push({ ...c, type: 'ARC', c: P2(e.center), r: e.radius, a0: e.startAngle, a1: e.endAngle }); break;
    case 'ELLIPSE': out.push({ ...c, type: 'ELLIPSE', c: P2(e.center), major: P2(e.majorAxisEndPoint), ratio: e.axisRatio, a0: e.startAngle ?? 0, a1: e.endAngle ?? TAU }); break;
    case 'SPLINE': out.push({ ...c, type: 'SPLINE', ctrl: (e.controlPoints ?? []).map(P2), fit: (e.fitPoints ?? []).map(P2), degree: e.degree ?? 3, knots: e.knots ?? [], weights: e.weights, closed: !!((e.flag ?? 0) & 1) }); break;
    case 'TEXT': case 'ATTRIB': {
      if (e.type === 'ATTRIB' && (e.flags ?? 0) & 1) break;
      // negli ATTRIB di libredwg-web i dati del testo stanno dentro e.text
      const t: AnyObj = e.text && typeof e.text === 'object' ? e.text : e;
      const al = textAlign(t.halign, t.valign);
      const useEnd = t.endPoint && (t.valign || [1, 2, 4].includes(t.halign));
      out.push({ ...c, type: 'TEXT', p: P2(useEnd ? t.endPoint : t.startPoint), s: cleanText(String(t.text ?? '')), h: t.textHeight ?? 1, rot: t.rotation ?? 0, ...al });
      break;
    }
    case 'MTEXT': {
      const d = e.direction;
      const rot = d && (d.x || d.y) ? Math.atan2(d.y, d.x) : e.rotation ?? 0;
      out.push({ ...c, type: 'TEXT', p: P2(e.insertionPoint), s: cleanMText(String(e.text ?? '')), h: e.textHeight ?? 1, rot, ...mtextAlign(e.attachmentPoint) });
      break;
    }
    case 'INSERT': {
      const attribs: RawEnt[] = [];
      for (const a of e.attribs ?? []) fromDwgEntity(a, attribs, skip);
      out.push({
        ...c, type: 'INSERT', name: e.name, p: P2(e.insertionPoint), sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: e.rotation ?? 0,
        cols: e.columnCount ?? 1, rows: e.rowCount ?? 1, colSp: e.columnSpacing ?? 0, rowSp: e.rowSpacing ?? 0, attribs,
      });
      break;
    }
    case 'DIMENSION':
      if (e.name) out.push({ ...c, type: 'INSERT', name: e.name, p: v(0, 0), sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, colSp: 0, rowSp: 0, attribs: [] });
      break;
    case 'SOLID': {
      const pts = [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(P2);
      out.push({ ...c, type: 'SOLID', pts });
      break;
    }
    case 'HATCH': {
      const loops = hatchLoops(e);
      const solid = e.solidFill === 1;
      const dl = (e.definitionLines ?? []) as AnyObj[];
      let sp = 10, ang = 0;
      if (dl.length) {
        const dir = v(Math.cos(dl[0].angle ?? 0), Math.sin(dl[0].angle ?? 0));
        sp = Math.abs(cross(dir, P2(dl[0].offset))) || 10;
        ang = (dl[0].angle ?? 0) - Math.PI / 4;
      } else if (e.patternScale) sp = e.patternScale * 3.175;
      out.push({ ...c, type: 'HATCH', loops, solid, ang, sp, cross: dl.length >= 2 });
      break;
    }
    case 'POINT': break;
    default: skip(String(e.type));
  }
}

export function fromDwgDatabase(db: AnyObj): { drawing: RawDrawing; skipped: Map<string, number> } {
  const skipped = new Map<string, number>();
  const skip = (t: string) => skipped.set(t, (skipped.get(t) ?? 0) + 1);
  const ents: RawEnt[] = [];
  // Solo lo spazio modello: db.entities contiene anche i layout di stampa (cartigli, squadrature) e
  // ripete gli attributi dei blocchi, che arrivano già dal loro inserimento.
  const records: AnyObj[] = db.tables?.BLOCK_RECORD?.entries ?? [];
  const model = records.find(b => /^\*MODEL_SPACE$/i.test(String(b.name)));
  const top: AnyObj[] = model?.entities ?? (db.entities ?? []).filter((e: AnyObj) => !e.isInPaperSpace);
  for (const e of top) if (e.type !== 'ATTRIB') fromDwgEntity(e, ents, skip);
  const blocks = new Map<string, RawBlock>();
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (/^\*(MODEL|PAPER)_SPACE/i.test(b.name)) continue;
    const list: RawEnt[] = [];
    for (const e of b.entities ?? []) fromDwgEntity(e, list, skip);
    blocks.set(b.name, { base: P2(b.basePoint), ents: list });
  }
  const layers: RawLayer[] = (db.tables?.LAYER?.entries ?? []).map((l: AnyObj) => ({
    name: String(l.name), colorIndex: l.colorIndex, trueColor: typeof l.color === 'number' && l.color > 0 ? l.color : undefined,
    off: !!l.off, frozen: !!l.frozen, lineType: l.lineType,
  }));
  const u = db.header?.INSUNITS;
  return { drawing: { ents, blocks, layers, insUnits: typeof u === 'number' && u > 0 ? u : undefined }, skipped };
}

