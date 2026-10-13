// Disegno delle primitive su canvas.
import type { Ent, InsertE, Prim, PrimCtx } from '../model/entities';
import { prims, primsBox, textLines, expandInsert, CHAR_W } from '../model/entities';
import type { Doc, Layer } from '../model/document';
import { LT_PATTERNS, UNIT_MM } from '../model/document';
import { Box, TAU, boxOverlap, boxValid } from '../model/geom';
import type { View } from './view';

const CTX_TYPES = new Set<Ent['t']>(['dim', 'wall', 'door', 'window', 'room', 'insert']);
const fixedCache = new WeakMap<Ent, { p: Prim[]; b: Box }>();
const ctxCache = new WeakMap<Ent, { ctx: PrimCtx; p: Prim[]; b: Box }>();

function cached(e: Ent, ctx: PrimCtx): { p: Prim[]; b: Box } {
  if (CTX_TYPES.has(e.t)) {
    const c = ctxCache.get(e);
    if (c && c.ctx === ctx) return c;
    const p = prims(e, ctx);
    const r = { ctx, p, b: primsBox(p, e) };
    ctxCache.set(e, r);
    return r;
  }
  let c = fixedCache.get(e);
  if (!c) {
    const p = prims(e, ctx);
    c = { p, b: primsBox(p, e) };
    fixedCache.set(e, c);
  }
  return c;
}

const kidsCache = new WeakMap<Ent, { ctx: PrimCtx; kids: Ent[] }>();

/**
 * Contenuto di un blocco inserito, come entità da disegnare ciascuna con il proprio layer e colore.
 * Un inserimento senza definizione resta se stesso (si disegna come crocetta).
 */
export function insertKids(e: InsertE, ctx: PrimCtx): Ent[] {
  const c = kidsCache.get(e);
  if (c && c.ctx === ctx) return c.kids;
  const kids = ctx.blocks?.[e.name] ? expandInsert(e, ctx.blocks) : [e];
  kidsCache.set(e, { ctx, kids });
  return kids;
}

/** Entità visibili da disegnare, con i blocchi aperti nel loro contenuto. */
export function drawList(doc: Doc, ctx: PrimCtx, only?: Set<number>): Ent[] {
  const out: Ent[] = [];
  for (const e of doc.ents) {
    if (only && !only.has(e.id)) continue;
    if (!doc.layer(e.layer).visible) continue;
    if (e.t !== 'insert') { out.push(e); continue; }
    for (const k of insertKids(e, ctx)) if (doc.layer(k.layer).visible) out.push(k);
  }
  return out;
}

export const entPrims = (e: Ent, ctx: PrimCtx): Prim[] => cached(e, ctx).p;
export const entBoxCached = (e: Ent, ctx: PrimCtx): Box => cached(e, ctx).b;

export interface PaintStyle {
  color: string;
  lw: number;
  dash: number[];
  /** opacità dei riempimenti dei muri */
  wallAlpha: number;
  tint: boolean;
}

/** Scala di riferimento con cui si vedono a schermo i tipi di linea. */
const LT_REF_SCALE = 50;

export function layerDash(doc: Doc, layer: Layer, view: View): number[] {
  const pat = LT_PATTERNS[layer.lt];
  if (!pat.length) return [];
  const k = (doc.settings.ltScale * LT_REF_SCALE * view.s) / UNIT_MM[doc.settings.units];
  const px = pat.map(x => x * k);
  return px.reduce((a, b) => a + b, 0) < 4 ? [] : px;
}

const images = new Map<string, HTMLImageElement>();
let onImageReady: (() => void) | null = null;
/** Chi disegna chiede di essere avvisato quando un'immagine ha finito di caricarsi, per ridisegnare. */
export function whenImagesLoad(fn: () => void) { onImageReady = fn; }

function imageOf(src: string): HTMLImageElement | null {
  let im = images.get(src);
  if (!im) {
    im = new Image();
    im.onload = () => onImageReady?.();
    im.src = src;
    images.set(src, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}

export function paint(g: CanvasRenderingContext2D, view: View, ps: Prim[], st: PaintStyle) {
  paintPrims(g, view, ps, st);
  // il tratteggio di linea non deve restare impostato per chi disegna dopo (la griglia, il mirino)
  g.setLineDash([]);
}

function paintPrims(g: CanvasRenderingContext2D, view: View, ps: Prim[], st: PaintStyle) {
  g.strokeStyle = st.color;
  g.fillStyle = st.color;
  g.lineWidth = st.lw;
  g.setLineDash(st.dash);
  const s = view.s;
  for (const p of ps) {
    switch (p.k) {
      case 'pl': {
        if (p.pts.length < 2) break;
        g.beginPath();
        const a = view.toScreen(p.pts[0]);
        g.moveTo(a.x, a.y);
        for (let i = 1; i < p.pts.length; i++) {
          const q = view.toScreen(p.pts[i]);
          g.lineTo(q.x, q.y);
        }
        if (p.closed) g.closePath();
        if (p.fill) fill(g, p.fill, st, 'nonzero');
        if (p.stroke !== false) g.stroke();
        break;
      }
      case 'img': {
        const o = view.toScreen(p.p);
        g.save();
        g.translate(o.x, o.y);
        g.rotate(-p.rot);
        const im = imageOf(p.src);
        // l'origine è l'angolo in basso a sinistra, e sullo schermo la Y va verso il basso
        if (im) g.drawImage(im, 0, -p.h * s, p.w * s, p.h * s);
        else { g.setLineDash([4, 3]); g.strokeRect(0, -p.h * s, p.w * s, p.h * s); }
        g.restore();
        break;
      }
      case 'area': {
        g.beginPath();
        for (const l of p.loops) {
          l.forEach((q, i) => {
            const t = view.toScreen(q);
            if (i === 0) g.moveTo(t.x, t.y); else g.lineTo(t.x, t.y);
          });
          g.closePath();
        }
        fill(g, p.fill, st, 'evenodd');
        break;
      }
      case 'arc': {
        const c = view.toScreen(p.c);
        const r = p.r * s;
        if (r < 0.3) break;
        g.beginPath();
        if (p.full) g.arc(c.x, c.y, r, 0, TAU);
        else g.arc(c.x, c.y, r, -p.a0, -p.a1, true);
        g.stroke();
        break;
      }
      case 'text': {
        const hp = p.h * s;
        if (hp < 0.5) break;
        const o = view.toScreen(p.p);
        g.save();
        g.translate(o.x, o.y);
        g.rotate(-p.rot);
        const lines = textLines(p);
        if (hp < 4) {
          g.globalAlpha *= 0.5;
          for (const l of lines) {
            const w = l.s.length * hp * CHAR_W;
            const x = p.ha === 'l' ? 0 : p.ha === 'c' ? -w / 2 : -w;
            g.fillRect(x, -l.y * s - hp * 0.7, w, Math.max(1, hp * 0.7));
          }
        } else {
          g.font = `${hp}px Arial, Helvetica, sans-serif`;
          g.textAlign = p.ha === 'l' ? 'left' : p.ha === 'c' ? 'center' : 'right';
          g.textBaseline = 'alphabetic';
          for (const l of lines) g.fillText(l.s, 0, -l.y * s);
        }
        g.restore();
        break;
      }
    }
  }
}

function fill(g: CanvasRenderingContext2D, f: string, st: PaintStyle, rule: CanvasFillRule) {
  const alpha = f === 'wall' ? st.wallAlpha : f === 'tint' ? (st.tint ? 0.07 : 0) : 1;
  if (alpha <= 0) return;
  const ga = g.globalAlpha;
  g.globalAlpha = ga * alpha;
  g.fill(rule);
  g.globalAlpha = ga;
}

export interface RenderOpts {
  lwt: boolean;
  skip?: Set<number>;
}

const ORDER: Partial<Record<Ent['t'], number>> = { hatch: 0, room: 0, wall: 1 };

export function entColor(doc: Doc, e: Ent): string {
  return e.color ?? doc.layer(e.layer).color;
}

export function renderDoc(g: CanvasRenderingContext2D, view: View, doc: Doc, opts: RenderOpts) {
  const ctx = doc.ctx();
  const vb = view.visibleBox();
  const layers = new Map(doc.layers.map(l => [l.name, l]));
  const dashes = new Map(doc.layers.map(l => [l.name, layerDash(doc, l, view)]));
  const passes: Ent[][] = [[], [], []];
  for (const e of drawList(doc, ctx)) {
    if (opts.skip?.has(e.id)) continue;
    passes[ORDER[e.t] ?? 2].push(e);
  }
  for (const list of passes) {
    for (const e of list) {
      const c = cached(e, ctx);
      if (!boxValid(c.b) || !boxOverlap(c.b, vb)) continue;
      const l = layers.get(e.layer) ?? doc.layers[0];
      paint(g, view, c.p, {
        color: e.color ?? l.color,
        lw: opts.lwt ? Math.max(1, (e.lw ?? l.lw) * 3.2) : 1,
        dash: e.lt ? layerDash(doc, { ...l, lt: e.lt }, view) : dashes.get(e.layer) ?? [],
        wallAlpha: 0.42,
        tint: true,
      });
    }
  }
}
