// Entità del disegno, primitive di rappresentazione, snap, grip, trasformazioni.
import {
  Vec, Curve, Mat, Box, TAU, v, add, sub, mul, dot, cross, len, dist, perp, mid, norm, angleOf, polar, dirOf,
  sweep, normAng, bulgeArc, tessArc, seg, arcC, arcStart, arcEnd, arcMid, polygonArea, centroid, clipLineToLoops,
  emptyBox, boxAdd, apply, det, matScale, mapAngle, lineLine,
} from './geom';
import type { WallCtx } from './walls';
import { wallPrims } from './walls';

export type HAlign = 'l' | 'c' | 'r';
export type VAlign = 'b' | 'm' | 't';
export type HatchPattern = 'solid' | 'ansi31' | 'ansi37';

interface Base { id: number; layer: string; color?: string; g?: number }
export interface LineE extends Base { t: 'line'; a: Vec; b: Vec }
export interface PolyE extends Base { t: 'poly'; pts: Vec[]; bulges?: number[]; closed: boolean }
export interface CircleE extends Base { t: 'circle'; c: Vec; r: number }
export interface ArcE extends Base { t: 'arc'; c: Vec; r: number; a0: number; a1: number }
export interface TextE extends Base { t: 'text'; p: Vec; s: string; h: number; rot: number; ha: HAlign; va: VAlign }
/** Quota: ang assente = allineata ai due punti; altrimenti ruotata (0 orizzontale, π/2 verticale). */
export interface DimE extends Base { t: 'dim'; a: Vec; b: Vec; p: Vec; ang?: number; s?: string }
export interface WallE extends Base { t: 'wall'; a: Vec; b: Vec; th: number }
export interface DoorE extends Base { t: 'door'; p: Vec; ang: number; w: number; th: number; sw: 1 | -1; hg: 1 | -1 }
export interface WindowE extends Base { t: 'window'; p: Vec; ang: number; w: number; th: number }
export interface RoomE extends Base { t: 'room'; pts: Vec[]; name: string }
export interface HatchE extends Base { t: 'hatch'; loops: Vec[][]; pat: HatchPattern; sp: number; ang: number }

export type Ent = LineE | PolyE | CircleE | ArcE | TextE | DimE | WallE | DoorE | WindowE | RoomE | HatchE;
export type EntType = Ent['t'];
/** Entità ancora senza id (create da un comando, prima di entrare nel documento). */
export type NewEnt = Ent extends infer E ? (E extends Ent ? Omit<E, 'id'> & { id?: number } : never) : never;

export const TYPE_NAMES: Record<EntType, string> = {
  line: 'Linea', poly: 'Polilinea', circle: 'Cerchio', arc: 'Arco', text: 'Testo', dim: 'Quota',
  wall: 'Muro', door: 'Porta', window: 'Finestra', room: 'Locale', hatch: 'Tratteggio',
};

// ---------------------------------------------------------------- primitive

export type Fill = 'wall' | 'solid' | 'tint';
export type Prim =
  | { k: 'pl'; pts: Vec[]; closed?: boolean; fill?: Fill; stroke?: boolean }
  | { k: 'arc'; c: Vec; r: number; a0: number; a1: number; full?: boolean }
  | { k: 'text'; p: Vec; s: string; h: number; rot: number; ha: HAlign; va: VAlign }
  | { k: 'area'; loops: Vec[][]; fill: Fill };

export interface PrimCtx {
  dimH: number;
  dimDec: number;
  /** unità² per m² */
  areaDiv: number;
  walls?: WallCtx;
}

export const DEFAULT_CTX: PrimCtx = { dimH: 15, dimDec: 0, areaDiv: 10000 };

export function fmtNum(x: number, dec: number): string {
  return x.toFixed(dec).replace('.', ',');
}

/** Disposizione delle righe di un testo, in coordinate locali (prima della rotazione). */
export const LINE_SPACING = 1.5;
export const CHAR_W = 0.62;

export function textLines(p: { s: string; h: number; va: VAlign }): { s: string; y: number }[] {
  const lines = p.s.split('\n');
  const n = lines.length;
  const step = p.h * LINE_SPACING;
  const H = p.h + (n - 1) * step;
  const y0 = p.va === 'b' ? (n - 1) * step : p.va === 't' ? -p.h : H / 2 - p.h;
  return lines.map((s, i) => ({ s, y: y0 - i * step }));
}

export function textCorners(p: { p: Vec; s: string; h: number; rot: number; ha: HAlign; va: VAlign }): Vec[] {
  const lines = textLines(p);
  const W = Math.max(...lines.map(l => l.s.length), 1) * p.h * CHAR_W;
  const x0 = p.ha === 'l' ? 0 : p.ha === 'c' ? -W / 2 : -W;
  const yTop = lines[0].y + p.h;
  const yBot = lines[lines.length - 1].y - p.h * 0.25;
  const co = Math.cos(p.rot), si = Math.sin(p.rot);
  return [v(x0, yBot), v(x0 + W, yBot), v(x0 + W, yTop), v(x0, yTop)].map(q => v(p.p.x + q.x * co - q.y * si, p.p.y + q.x * si + q.y * co));
}

function polySegCurves(e: { pts: Vec[]; bulges?: number[]; closed: boolean }): Curve[] {
  const out: Curve[] = [];
  const n = e.pts.length;
  const m = e.closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = e.pts[i], b = e.pts[(i + 1) % n];
    const bu = e.bulges?.[i] ?? 0;
    out.push(Math.abs(bu) > 1e-9 && dist(a, b) > 1e-12 ? bulgeArc(a, b, bu) : seg(a, b));
  }
  return out;
}

/** Punti di una polilinea con gli archi (bulge) spezzati in segmenti. */
export function polyPoints(e: { pts: Vec[]; bulges?: number[]; closed: boolean }): Vec[] {
  if (!e.bulges || !e.bulges.some(b => Math.abs(b) > 1e-9)) return e.pts;
  const out: Vec[] = [];
  const n = e.pts.length;
  const m = e.closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = e.pts[i], b = e.pts[(i + 1) % n];
    const bu = e.bulges[i] ?? 0;
    if (Math.abs(bu) > 1e-9) {
      const arc = bulgeArc(a, b, bu);
      let pts = tessArc(arc.c, arc.r, arc.a0, sweep(arc.a0, arc.a1));
      if (bu < 0) pts = pts.reverse();
      out.push(...pts.slice(0, -1));
    } else out.push(a);
  }
  if (!e.closed) out.push(e.pts[n - 1]);
  return out;
}

export function dimGeometry(e: DimE): { u: Vec; a2: Vec; b2: Vec; value: number } | null {
  const u = e.ang !== undefined ? dirOf(e.ang) : norm(sub(e.b, e.a));
  if (len(u) < 0.5) return null;
  const a2 = add(e.p, mul(u, dot(sub(e.a, e.p), u)));
  const b2 = add(e.p, mul(u, dot(sub(e.b, e.p), u)));
  return { u, a2, b2, value: Math.abs(dot(sub(e.b, e.a), u)) };
}

/** Rotazione leggibile (testo mai capovolto) per una direzione. */
export function readableAngle(ang: number): number {
  let r = normAng(ang);
  if (r > Math.PI / 2 + 1e-9 && r <= (3 * Math.PI) / 2 + 1e-9) r -= Math.PI;
  return r;
}

function dimPrims(e: DimE, ctx: PrimCtx): Prim[] {
  const g = dimGeometry(e);
  if (!g) return [];
  const H = ctx.dimH;
  const out: Prim[] = [];
  const gap = H * 0.4, ext = H * 0.5;
  for (const [p, q] of [[e.a, g.a2], [e.b, g.b2]] as const) {
    const d = sub(q, p);
    const l = len(d);
    if (l > gap) {
      const n = mul(d, 1 / l);
      out.push({ k: 'pl', pts: [add(p, mul(n, gap)), add(q, mul(n, ext))] });
    }
  }
  const ta = dot(sub(g.a2, e.p), g.u), tb = dot(sub(g.b2, e.p), g.u);
  const lo = add(e.p, mul(g.u, Math.min(ta, tb) - ext));
  const hi = add(e.p, mul(g.u, Math.max(ta, tb) + ext));
  out.push({ k: 'pl', pts: [lo, hi] });
  const tick = mul(dirOf(Math.atan2(g.u.y, g.u.x) + Math.PI / 4), H * 0.45);
  for (const q of [g.a2, g.b2]) out.push({ k: 'pl', pts: [sub(q, tick), add(q, tick)] });
  const rot = readableAngle(Math.atan2(g.u.y, g.u.x));
  const up = perp(dirOf(rot));
  out.push({ k: 'text', p: add(mid(g.a2, g.b2), mul(up, H * 0.3)), s: e.s ?? fmtNum(g.value, ctx.dimDec), h: H, rot, ha: 'c', va: 'b' });
  return out;
}

function doorPrims(e: DoorE, ctx: PrimCtx): Prim[] {
  const th = ctx.walls?.openTh.get(e.id) ?? e.th;
  const u = dirOf(e.ang), n = perp(u);
  const hinge = add(add(e.p, mul(u, (e.hg * e.w) / 2)), mul(n, (e.sw * th) / 2));
  const leafDir = mul(n, e.sw);
  const tip = add(hinge, mul(leafDir, e.w));
  const aLeaf = Math.atan2(leafDir.y, leafDir.x);
  const closedDir = mul(u, -e.hg);
  const aClosed = Math.atan2(closedDir.y, closedDir.x);
  const [a0, a1] = Math.abs(normAng(aClosed - aLeaf) - Math.PI / 2) < 1e-6 ? [aLeaf, aClosed] : [aClosed, aLeaf];
  const out: Prim[] = [{ k: 'pl', pts: [hinge, tip] }, { k: 'arc', c: hinge, r: e.w, a0, a1 }];
  if (!ctx.walls?.openTh.has(e.id)) out.push(...openingJambs(e.p, u, n, e.w, th));
  return out;
}

function openingJambs(p: Vec, u: Vec, n: Vec, w: number, th: number): Prim[] {
  return [-1, 1].map(s => {
    const q = add(p, mul(u, (s * w) / 2));
    return { k: 'pl', pts: [add(q, mul(n, th / 2)), sub(q, mul(n, th / 2))] } as Prim;
  });
}

function windowPrims(e: WindowE, ctx: PrimCtx): Prim[] {
  const th = ctx.walls?.openTh.get(e.id) ?? e.th;
  const u = dirOf(e.ang), n = perp(u);
  const a = sub(e.p, mul(u, e.w / 2)), b = add(e.p, mul(u, e.w / 2));
  const out: Prim[] = [];
  for (const off of [th / 2, th / 6, -th / 6, -th / 2]) out.push({ k: 'pl', pts: [add(a, mul(n, off)), add(b, mul(n, off))] });
  if (!ctx.walls?.openTh.has(e.id)) out.push(...openingJambs(e.p, u, n, e.w, th));
  return out;
}

export function roomArea(e: RoomE): number {
  return Math.abs(polygonArea(e.pts));
}

function roomPrims(e: RoomE, ctx: PrimCtx): Prim[] {
  if (e.pts.length < 3) return [{ k: 'pl', pts: e.pts }];
  const c = centroid(e.pts);
  const H = ctx.dimH;
  const area = `S = ${fmtNum(roomArea(e) / ctx.areaDiv, 2)} m²`;
  const out: Prim[] = [{ k: 'pl', pts: e.pts, closed: true, fill: 'tint', stroke: false }];
  if (e.name) {
    out.push({ k: 'text', p: add(c, v(0, H * 0.35)), s: e.name, h: H * 1.25, rot: 0, ha: 'c', va: 'b' });
    out.push({ k: 'text', p: sub(c, v(0, H * 0.35)), s: area, h: H, rot: 0, ha: 'c', va: 't' });
  } else out.push({ k: 'text', p: c, s: area, h: H, rot: 0, ha: 'c', va: 'm' });
  return out;
}

const MAX_HATCH_LINES = 4000;

function hatchPrims(e: HatchE): Prim[] {
  const loops = e.loops.filter(l => l.length >= 3);
  if (!loops.length) return [];
  if (e.pat === 'solid') return [{ k: 'area', loops, fill: 'solid' }];
  const out: Prim[] = [];
  const angles = e.pat === 'ansi37' ? [e.ang + Math.PI / 4, e.ang - Math.PI / 4] : [e.ang + Math.PI / 4];
  const pts = loops.flat();
  for (const a of angles) {
    const d = dirOf(a), n = perp(d);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
      const s = dot(p, n);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    let sp = Math.max(e.sp, 1e-9);
    if ((hi - lo) / sp > MAX_HATCH_LINES) sp = (hi - lo) / MAX_HATCH_LINES;
    for (let s = Math.ceil(lo / sp) * sp; s <= hi; s += sp) {
      for (const [p, q] of clipLineToLoops(mul(n, s), d, loops)) out.push({ k: 'pl', pts: [p, q] });
    }
  }
  return out;
}

export function prims(e: Ent, ctx: PrimCtx = DEFAULT_CTX): Prim[] {
  switch (e.t) {
    case 'line': return [{ k: 'pl', pts: [e.a, e.b] }];
    case 'poly': return [{ k: 'pl', pts: polyPoints(e), closed: e.closed }];
    case 'circle': return [{ k: 'arc', c: e.c, r: e.r, a0: 0, a1: TAU, full: true }];
    case 'arc': return [{ k: 'arc', c: e.c, r: e.r, a0: e.a0, a1: e.a1 }];
    case 'text': return [{ k: 'text', p: e.p, s: e.s, h: e.h, rot: e.rot, ha: e.ha, va: e.va }];
    case 'dim': return dimPrims(e, ctx);
    case 'wall': return wallPrims(e, ctx.walls);
    case 'door': return doorPrims(e, ctx);
    case 'window': return windowPrims(e, ctx);
    case 'room': return roomPrims(e, ctx);
    case 'hatch': return hatchPrims(e);
  }
}

/** Curve della rappresentazione: per selezione, intersezioni e snap. */
export function primCurves(ps: Prim[]): Curve[] {
  const out: Curve[] = [];
  for (const p of ps) {
    if (p.k === 'pl') {
      for (let i = 0; i + 1 < p.pts.length; i++) out.push(seg(p.pts[i], p.pts[i + 1]));
      if (p.closed && p.pts.length > 2) out.push(seg(p.pts[p.pts.length - 1], p.pts[0]));
    } else if (p.k === 'arc') out.push(arcC(p.c, p.r, p.a0, p.a1, p.full));
    else if (p.k === 'area') {
      for (const l of p.loops) for (let i = 0; i < l.length; i++) out.push(seg(l[i], l[(i + 1) % l.length]));
    } else {
      const c = textCorners(p);
      for (let i = 0; i < 4; i++) out.push(seg(c[i], c[(i + 1) % 4]));
    }
  }
  return out;
}

/** Curve geometriche "vere" per taglia/estendi/raccorda/offset. */
export function editCurves(e: Ent, ctx: PrimCtx = DEFAULT_CTX): Curve[] {
  switch (e.t) {
    case 'line': return [seg(e.a, e.b)];
    case 'poly': return polySegCurves(e);
    case 'circle': return [arcC(e.c, e.r, 0, TAU, true)];
    case 'arc': return [arcC(e.c, e.r, e.a0, e.a1)];
    case 'wall': return [seg(e.a, e.b), ...primCurves(prims(e, ctx))];
    default: return primCurves(prims(e, ctx));
  }
}

export function primsBox(ps: Prim[], e?: Ent): Box {
  const b = emptyBox();
  for (const p of ps) {
    if (p.k === 'pl') p.pts.forEach(q => boxAdd(b, q));
    else if (p.k === 'area') p.loops.forEach(l => l.forEach(q => boxAdd(b, q)));
    else if (p.k === 'text') textCorners(p).forEach(q => boxAdd(b, q));
    else if (p.full) { boxAdd(b, v(p.c.x - p.r, p.c.y - p.r)); boxAdd(b, v(p.c.x + p.r, p.c.y + p.r)); }
    else {
      boxAdd(b, polar(p.c, p.r, p.a0));
      boxAdd(b, polar(p.c, p.r, p.a1));
      const sw = sweep(p.a0, p.a1);
      for (let q = 0; q < 4; q++) {
        const a = (q * Math.PI) / 2;
        if (normAng(a - p.a0) <= sw) boxAdd(b, polar(p.c, p.r, a));
      }
    }
  }
  if (e?.t === 'dim') { boxAdd(b, e.a); boxAdd(b, e.b); }
  return b;
}

export function entBox(e: Ent, ctx: PrimCtx = DEFAULT_CTX): Box {
  return primsBox(prims(e, ctx), e);
}

// ---------------------------------------------------------------- snap

export type SnapKind = 'end' | 'mid' | 'cen' | 'quad' | 'ins' | 'int' | 'perp' | 'near' | 'grid';

export interface SnapPt { p: Vec; k: SnapKind }

export function snapPoints(e: Ent, ctx: PrimCtx = DEFAULT_CTX): SnapPt[] {
  const out: SnapPt[] = [];
  const P = (p: Vec, k: SnapKind) => out.push({ p, k });
  switch (e.t) {
    case 'line': P(e.a, 'end'); P(e.b, 'end'); P(mid(e.a, e.b), 'mid'); break;
    case 'poly': {
      e.pts.forEach(p => P(p, 'end'));
      for (const c of polySegCurves(e)) {
        if (c.k === 's') P(mid(c.a, c.b), 'mid');
        else { P(arcMid(c), 'mid'); P(c.c, 'cen'); }
      }
      if (e.closed && e.pts.length > 2) P(centroid(e.pts), 'cen');
      break;
    }
    case 'circle':
      P(e.c, 'cen');
      for (let q = 0; q < 4; q++) P(polar(e.c, e.r, (q * Math.PI) / 2), 'quad');
      break;
    case 'arc': {
      const a = arcC(e.c, e.r, e.a0, e.a1);
      P(arcStart(a), 'end'); P(arcEnd(a), 'end'); P(arcMid(a), 'mid'); P(e.c, 'cen');
      const sw = sweep(e.a0, e.a1);
      for (let q = 0; q < 4; q++) if (normAng((q * Math.PI) / 2 - e.a0) <= sw) P(polar(e.c, e.r, (q * Math.PI) / 2), 'quad');
      break;
    }
    case 'text': P(e.p, 'ins'); break;
    case 'dim': P(e.a, 'end'); P(e.b, 'end'); P(e.p, 'ins'); break;
    case 'wall':
      P(e.a, 'end'); P(e.b, 'end'); P(mid(e.a, e.b), 'mid');
      for (const p of prims(e, ctx)) if (p.k === 'pl' && p.stroke !== false) p.pts.forEach(q => P(q, 'end'));
      break;
    case 'door': case 'window': {
      const u = dirOf(e.ang);
      P(e.p, 'mid'); P(add(e.p, mul(u, e.w / 2)), 'end'); P(sub(e.p, mul(u, e.w / 2)), 'end');
      break;
    }
    case 'room': e.pts.forEach(p => P(p, 'end')); if (e.pts.length > 2) P(centroid(e.pts), 'cen'); break;
    case 'hatch': e.loops.forEach(l => l.forEach(p => P(p, 'end'))); break;
  }
  return out;
}

// ---------------------------------------------------------------- grip

export function grips(e: Ent): Vec[] {
  switch (e.t) {
    case 'line': return [e.a, mid(e.a, e.b), e.b];
    case 'poly': return e.pts;
    case 'circle': return [e.c, ...[0, 1, 2, 3].map(q => polar(e.c, e.r, (q * Math.PI) / 2))];
    case 'arc': { const a = arcC(e.c, e.r, e.a0, e.a1); return [arcStart(a), arcMid(a), arcEnd(a), e.c]; }
    case 'text': return [e.p];
    case 'dim': return [e.a, e.b, e.p];
    case 'wall': return [e.a, mid(e.a, e.b), e.b];
    case 'door': case 'window': return [e.p];
    case 'room': return e.pts;
    case 'hatch': return e.loops.flat();
  }
}

/** Arco CCW passante per tre punti, nell'ordine p1 → p2 → p3. */
export function arc3(p1: Vec, p2: Vec, p3: Vec): { c: Vec; r: number; a0: number; a1: number } | null {
  const m1 = mid(p1, p2), m2 = mid(p2, p3);
  const r = lineLine(m1, add(m1, perp(sub(p2, p1))), m2, add(m2, perp(sub(p3, p2))));
  if (!r) return null;
  const c = r.p;
  const ccw = cross(sub(p2, p1), sub(p3, p2)) > 0;
  const a1 = angleOf(c, p1), a3 = angleOf(c, p3);
  return { c, r: dist(c, p1), a0: ccw ? a1 : a3, a1: ccw ? a3 : a1 };
}

export function moveGrip(e: Ent, i: number, p: Vec): Ent {
  const d = sub(p, grips(e)[i]);
  switch (e.t) {
    case 'line': case 'wall':
      if (i === 0) return { ...e, a: p };
      if (i === 2) return { ...e, b: p };
      return { ...e, a: add(e.a, d), b: add(e.b, d) };
    case 'poly': return { ...e, pts: e.pts.map((q, j) => (j === i ? p : q)) };
    case 'room': return { ...e, pts: e.pts.map((q, j) => (j === i ? p : q)) };
    case 'circle': return i === 0 ? { ...e, c: p } : { ...e, r: Math.max(1e-9, dist(e.c, p)) };
    case 'arc': {
      if (i === 3) return { ...e, c: p };
      const g = grips(e);
      const pts = [g[0], g[1], g[2]];
      pts[i] = p;
      const a = arc3(pts[0], pts[1], pts[2]);
      return a ? { ...e, ...a } : e;
    }
    case 'text': case 'door': case 'window': return { ...e, p };
    case 'dim': return i === 0 ? { ...e, a: p } : i === 1 ? { ...e, b: p } : { ...e, p };
    case 'hatch': {
      let k = i;
      return { ...e, loops: e.loops.map(l => l.map(q => (k-- === 0 ? p : q))) };
    }
  }
}

// ---------------------------------------------------------------- trasformazioni

function readableAfter(m: Mat, rot: number): number {
  let r = mapAngle(m, rot);
  if (det(m) < 0 && Math.cos(r) < -1e-9) r += Math.PI;
  return r;
}

export function transform<E extends Ent>(e: E, m: Mat): E {
  const P = (p: Vec) => apply(m, p);
  const s = matScale(m);
  const mirror = det(m) < 0;
  const x = e as Ent;
  let r: Ent;
  switch (x.t) {
    case 'line': r = { ...x, a: P(x.a), b: P(x.b) }; break;
    case 'poly': r = { ...x, pts: x.pts.map(P), bulges: x.bulges && (mirror ? x.bulges.map(b => -b) : x.bulges) }; break;
    case 'circle': r = { ...x, c: P(x.c), r: x.r * s }; break;
    case 'arc': {
      const a0 = mapAngle(m, x.a0), a1 = mapAngle(m, x.a1);
      r = { ...x, c: P(x.c), r: x.r * s, a0: mirror ? a1 : a0, a1: mirror ? a0 : a1 };
      break;
    }
    case 'text': r = { ...x, p: P(x.p), h: x.h * s, rot: readableAfter(m, x.rot) }; break;
    case 'dim': r = { ...x, a: P(x.a), b: P(x.b), p: P(x.p), ang: x.ang === undefined ? undefined : mapAngle(m, x.ang) }; break;
    case 'wall': r = { ...x, a: P(x.a), b: P(x.b), th: x.th * s }; break;
    case 'door': r = { ...x, p: P(x.p), ang: mapAngle(m, x.ang), w: x.w * s, th: x.th * s, sw: mirror ? (-x.sw as 1 | -1) : x.sw }; break;
    case 'window': r = { ...x, p: P(x.p), ang: mapAngle(m, x.ang), w: x.w * s, th: x.th * s }; break;
    case 'room': r = { ...x, pts: x.pts.map(P) }; break;
    case 'hatch': r = { ...x, loops: x.loops.map(l => l.map(P)), sp: x.sp * s, ang: mapAngle(m, x.ang) }; break;
  }
  return r as E;
}

/** Spostamento dei soli vertici interni al riquadro (comando STIRA). */
export function stretch(e: Ent, inside: (p: Vec) => boolean, d: Vec): Ent | null {
  const mv = (p: Vec) => (inside(p) ? add(p, d) : p);
  const any = (ps: Vec[]) => ps.some(inside);
  switch (e.t) {
    case 'line': case 'wall': return any([e.a, e.b]) ? { ...e, a: mv(e.a), b: mv(e.b) } : null;
    case 'poly': return any(e.pts) ? { ...e, pts: e.pts.map(mv) } : null;
    case 'room': return any(e.pts) ? { ...e, pts: e.pts.map(mv) } : null;
    case 'hatch': return any(e.loops.flat()) ? { ...e, loops: e.loops.map(l => l.map(mv)) } : null;
    case 'dim': return any([e.a, e.b, e.p]) ? { ...e, a: mv(e.a), b: mv(e.b), p: inside(e.p) || (inside(e.a) && inside(e.b)) ? add(e.p, d) : e.p } : null;
    case 'circle': return inside(e.c) ? { ...e, c: add(e.c, d) } : null;
    case 'arc': return inside(e.c) ? { ...e, c: add(e.c, d) } : null;
    case 'text': case 'door': case 'window': return inside(e.p) ? { ...e, p: add(e.p, d) } : null;
  }
}

/** Esplosione in entità semplici. null = non esplodibile. */
export function explode(e: Ent, ctx: PrimCtx = DEFAULT_CTX): NewEnt[] | null {
  const base = { layer: e.layer, color: e.color };
  if (e.t === 'line' || e.t === 'circle' || e.t === 'arc') return null;
  if (e.t === 'text') {
    if (!e.s.includes('\n')) return null;
    const co = Math.cos(e.rot), si = Math.sin(e.rot);
    return textLines(e).map(l => ({ ...base, t: 'text', p: v(e.p.x - l.y * si, e.p.y + l.y * co), s: l.s, h: e.h, rot: e.rot, ha: e.ha, va: 'b' as VAlign }));
  }
  if (e.t === 'poly') {
    return polySegCurves(e).map(c => (c.k === 's'
      ? { ...base, t: 'line' as const, a: c.a, b: c.b }
      : { ...base, t: 'arc' as const, c: c.c, r: c.r, a0: c.a0, a1: c.a1 }));
  }
  const out: NewEnt[] = [];
  for (const p of prims(e, ctx)) {
    if (p.k === 'pl') {
      if (p.stroke === false) continue;
      if (p.pts.length === 2 && !p.closed) out.push({ ...base, t: 'line', a: p.pts[0], b: p.pts[1] });
      else out.push({ ...base, t: 'poly', pts: p.pts, closed: !!p.closed });
    } else if (p.k === 'arc') {
      out.push(p.full ? { ...base, t: 'circle', c: p.c, r: p.r } : { ...base, t: 'arc', c: p.c, r: p.r, a0: p.a0, a1: p.a1 });
    } else if (p.k === 'text') out.push({ ...base, t: 'text', p: p.p, s: p.s, h: p.h, rot: p.rot, ha: p.ha, va: p.va });
    else for (const l of p.loops) out.push({ ...base, t: 'poly', pts: l, closed: true });
  }
  return out;
}

