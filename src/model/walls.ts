// Muri: giunzioni (angoli a quartabuono, incroci a T) e aperture di porte e finestre.
import { Vec, add, sub, mul, dot, cross, len, dist, perp, norm, dirOf, lineLine } from './geom';
import type { Ent, WallE, Prim } from './entities';

export interface WallInfo {
  /** angoli: s/e = inizio/fine, l/r = lato +n / lato −n */
  sl: Vec; sr: Vec; el: Vec; er: Vec;
  capS: boolean; capE: boolean;
  /** tratti tolti a pieno spessore (aperture), in ascissa lungo l'asse */
  cuts: [number, number][];
  /** tratti tolti dal solo bordo sinistro / destro (muri che si innestano) */
  cutsL: [number, number][];
  cutsR: [number, number][];
}

export interface WallCtx {
  walls: Map<number, WallInfo>;
  /** spessore del muro che ospita ciascuna apertura */
  openTh: Map<number, number>;
  /** muro che ospita ciascuna apertura (id apertura → id muro) */
  hosts: Map<number, number>;
}

const KEY = (p: Vec) => `${Math.round(p.x * 1e4)}:${Math.round(p.y * 1e4)}`;

function axes(w: WallE) {
  const u = norm(sub(w.b, w.a));
  return { u, n: perp(u), L: dist(w.a, w.b), h: w.th / 2 };
}

export function buildWallCtx(ents: readonly Ent[]): WallCtx {
  const walls = ents.filter((e): e is WallE => e.t === 'wall' && dist(e.a, e.b) > 1e-9);
  const info = new Map<number, WallInfo>();
  const openTh = new Map<number, number>();
  const hosts = new Map<number, number>();
  const ends = new Map<string, { w: WallE; end: 's' | 'e' }[]>();

  for (const w of walls) {
    const { n, h } = axes(w);
    info.set(w.id, {
      sl: add(w.a, mul(n, h)), sr: sub(w.a, mul(n, h)), el: add(w.b, mul(n, h)), er: sub(w.b, mul(n, h)),
      capS: true, capE: true, cuts: [], cutsL: [], cutsR: [],
    });
    for (const [p, end] of [[w.a, 's'], [w.b, 'e']] as const) {
      const k = KEY(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k)!.push({ w, end });
    }
  }

  // giunzioni d'angolo fra esattamente due muri
  for (const list of ends.values()) {
    if (list.length !== 2) {
      if (list.length > 2) for (const it of list) setCap(info.get(it.w.id)!, it.end, false);
      continue;
    }
    for (let i = 0; i < 2; i++) {
      const W = list[i], N = list[1 - i];
      const P = W.end === 's' ? W.w.a : W.w.b;
      const d = norm(sub(W.end === 's' ? W.w.b : W.w.a, P));
      const e = norm(sub(N.end === 's' ? N.w.b : N.w.a, P));
      const inf = info.get(W.w.id)!;
      const cr = cross(d, e);
      if (Math.abs(cr) < 1e-6) {
        if (dot(d, e) < 0) setCap(inf, W.end, false);
        continue;
      }
      const nW = perp(d), nN = perp(e);
      const hW = W.w.th / 2, hN = N.w.th / 2;
      const s = cr > 0 ? 1 : -1;
      const inner = lineLine(add(P, mul(nW, s * hW)), add(add(P, mul(nW, s * hW)), d), add(P, mul(nN, -s * hN)), add(add(P, mul(nN, -s * hN)), e));
      const outer = lineLine(add(P, mul(nW, -s * hW)), add(add(P, mul(nW, -s * hW)), d), add(P, mul(nN, s * hN)), add(add(P, mul(nN, s * hN)), e));
      if (!inner || !outer) continue;
      const lim = 4 * Math.max(hW, hN) + 1e-9;
      if (dist(inner.p, P) > lim || dist(outer.p, P) > lim) continue;
      const plusSide = s > 0 ? inner.p : outer.p;   // lato +nW
      const minusSide = s > 0 ? outer.p : inner.p;  // lato −nW
      if (W.end === 's') { inf.sl = plusSide; inf.sr = minusSide; } else { inf.er = plusSide; inf.el = minusSide; }
      setCap(inf, W.end, false);
    }
  }

  // innesti a T: estremo di un muro sull'asse di un altro
  for (const W of walls) {
    for (const end of ['s', 'e'] as const) {
      const P = end === 's' ? W.a : W.b;
      if ((ends.get(KEY(P))?.length ?? 0) > 1) continue;
      const other = end === 's' ? W.b : W.a;
      for (const H of walls) {
        if (H === W) continue;
        const { u, n, L, h } = axes(H);
        const s = dot(sub(P, H.a), u);
        const off = dot(sub(P, H.a), n);
        if (s <= 1e-6 || s >= L - 1e-6 || Math.abs(off) > h + 1e-6) continue;
        const side = dot(sub(other, H.a), n) - off >= 0 ? 1 : -1;
        const faceP = add(H.a, mul(n, side * h));
        const inf = info.get(W.id)!;
        const { u: uw } = axes(W);
        const cornL = end === 's' ? inf.sl : inf.el;
        const cornR = end === 's' ? inf.sr : inf.er;
        const iL = lineLine(cornL, add(cornL, uw), faceP, add(faceP, u));
        const iR = lineLine(cornR, add(cornR, uw), faceP, add(faceP, u));
        if (!iL || !iR) continue;
        if (end === 's') { inf.sl = iL.p; inf.sr = iR.p; } else { inf.el = iL.p; inf.er = iR.p; }
        setCap(inf, end, false);
        const s0 = dot(sub(iL.p, H.a), u), s1 = dot(sub(iR.p, H.a), u);
        const hi = info.get(H.id)!;
        (side > 0 ? hi.cutsL : hi.cutsR).push([Math.min(s0, s1), Math.max(s0, s1)]);
        break;
      }
    }
  }

  // aperture
  for (const o of ents) {
    if (o.t !== 'door' && o.t !== 'window') continue;
    const uo = dirOf(o.ang);
    for (const W of walls) {
      const { u, n, L, h } = axes(W);
      if (Math.abs(cross(u, uo)) > 1e-3) continue;
      const s = dot(sub(o.p, W.a), u);
      if (s < -1e-6 || s > L + 1e-6 || Math.abs(dot(sub(o.p, W.a), n)) > h + 1e-6) continue;
      info.get(W.id)!.cuts.push([Math.max(0, s - o.w / 2), Math.min(L, s + o.w / 2)]);
      openTh.set(o.id, W.th);
      hosts.set(o.id, W.id);
      break;
    }
  }
  return { walls: info, openTh, hosts };
}

function setCap(inf: WallInfo, end: 's' | 'e', v: boolean) {
  if (end === 's') inf.capS = v; else inf.capE = v;
}

/** Sottrae gli intervalli gaps da [lo, hi]. */
function subtract(lo: number, hi: number, gaps: [number, number][]): [number, number][] {
  const gs = gaps.filter(g => g[1] > lo && g[0] < hi).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = lo;
  for (const [g0, g1] of gs) {
    if (g0 > cur + 1e-9) out.push([cur, g0]);
    cur = Math.max(cur, g1);
  }
  if (hi > cur + 1e-9) out.push([cur, hi]);
  return out;
}

export function wallPrims(w: WallE, ctx?: WallCtx): Prim[] {
  const L = dist(w.a, w.b);
  if (L < 1e-9) return [];
  const { u, n, h } = axes(w);
  const inf: WallInfo = ctx?.walls.get(w.id) ?? {
    sl: add(w.a, mul(n, h)), sr: sub(w.a, mul(n, h)), el: add(w.b, mul(n, h)), er: sub(w.b, mul(n, h)),
    capS: true, capE: true, cuts: [], cutsL: [], cutsR: [],
  };
  const S = (p: Vec) => dot(sub(p, w.a), u);
  const at = (s: number, side: number) => add(add(w.a, mul(u, s)), mul(n, side * h));
  const out: Prim[] = [];

  // riempimento, a pezzi fra un'apertura e l'altra
  const lo = Math.min(S(inf.sl), S(inf.sr)), hi = Math.max(S(inf.el), S(inf.er));
  for (const [p0, p1] of subtract(lo, hi, inf.cuts)) {
    const startL = p0 <= lo + 1e-9 ? inf.sl : at(p0, 1);
    const startR = p0 <= lo + 1e-9 ? inf.sr : at(p0, -1);
    const endL = p1 >= hi - 1e-9 ? inf.el : at(p1, 1);
    const endR = p1 >= hi - 1e-9 ? inf.er : at(p1, -1);
    out.push({ k: 'pl', pts: [startL, endL, endR, startR], closed: true, fill: 'wall', stroke: false });
  }

  // bordi
  for (const side of [1, -1]) {
    const a = side > 0 ? inf.sl : inf.sr, b = side > 0 ? inf.el : inf.er;
    const sa = S(a), sb = S(b);
    const gaps = [...inf.cuts, ...(side > 0 ? inf.cutsL : inf.cutsR)];
    for (const [p0, p1] of subtract(sa, sb, gaps)) {
      out.push({ k: 'pl', pts: [p0 <= sa + 1e-9 ? a : at(p0, side), p1 >= sb - 1e-9 ? b : at(p1, side)] });
    }
  }
  if (inf.capS) out.push({ k: 'pl', pts: [inf.sl, inf.sr] });
  if (inf.capE) out.push({ k: 'pl', pts: [inf.el, inf.er] });

  // spallette delle aperture
  for (const [c0, c1] of inf.cuts) {
    for (const s of [c0, c1]) {
      if (s > lo + 1e-6 && s < hi - 1e-6) out.push({ k: 'pl', pts: [at(s, 1), at(s, -1)] });
    }
  }
  return out;
}

export const wallLength = (w: WallE) => len(sub(w.b, w.a));
