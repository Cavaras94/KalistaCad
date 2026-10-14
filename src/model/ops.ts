// Operazioni di modifica: offset, taglia, estendi, raccorda, unisci, contorni.
import type { Ent, NewEnt, PolyE, LineE, WallE, PrimCtx, HatchPattern } from './entities';
import { primCurves, prims, polyPoints, ellipsePoints, splinePoints, isEllipseArc, DEFAULT_CTX } from './entities';
import {
  Vec, Curve, Mat, v, add, sub, mul, dot, cross, len, dist, perp, norm, angleOf, polar, normAng, sweep, lerp, same,
  bulgeArc, intersect, lineLine, closestOnSeg, distToCurve, arcStart, arcEnd, seg, arcC, polygonArea, pointInPolygon, tessArc, TAU,
  apply, translate, rotateAbout,
} from './geom';

type Base = Pick<Ent, 'layer' | 'color' | 'lt' | 'lw'>;
const baseOf = (e: Ent): Base => ({ layer: e.layer, ...(e.color ? { color: e.color } : {}), ...(e.lt ? { lt: e.lt } : {}), ...(e.lw !== undefined ? { lw: e.lw } : {}) });

/**
 * Ellissi e spline, per le operazioni che lavorano su linee e archi (taglia, estendi, offset, spezza…),
 * diventano la polilinea con cui sono disegnate: il risultato di quelle operazioni è una polilinea.
 */
export function curveAsPoly(e: Ent): Ent {
  if (e.t === 'ellipse') return { ...baseOf(e), id: e.id, t: 'poly', pts: ellipsePoints(e), closed: !isEllipseArc(e) };
  if (e.t === 'spline') return { ...baseOf(e), id: e.id, t: 'poly', pts: splinePoints(e.pts, e.closed), closed: e.closed };
  return e;
}

/** Retino e passo di un muro, da portare sui muri che se ne ricavano (offset, taglio, spezzatura). */
function wallFillOf(e: Ent): { pat?: HatchPattern; sp?: number } {
  if (e.t !== 'wall' || !e.pat) return {};
  return e.sp !== undefined ? { pat: e.pat, sp: e.sp } : { pat: e.pat };
}

// ---------------------------------------------------------------- offset

/** strict: null anche quando la distanza è troppa e un tratto uscirebbe rovesciato. */
export function offsetPolyPts(pts: Vec[], closed: boolean, off: number, strict = false): Vec[] | null {
  const n = pts.length;
  const m = closed ? n : n - 1;
  const lines: [Vec, Vec][] = [];
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = norm(sub(b, a));
    if (len(d) < 0.5) return null;
    const o = mul(perp(d), off);
    lines.push([add(a, o), add(b, o)]);
  }
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && i === 0) { out.push(lines[0][0]); continue; }
    if (!closed && i === n - 1) { out.push(lines[m - 1][1]); continue; }
    const L1 = lines[(i - 1 + m) % m], L2 = lines[i % m];
    const r = lineLine(L1[0], L1[1], L2[0], L2[1]);
    out.push(r ? r.p : L2[0]);
  }
  if (strict) {
    for (let i = 0; i < m; i++) if (dot(sub(out[(i + 1) % n], out[i]), sub(pts[(i + 1) % n], pts[i])) <= 0) return null;
  }
  return out;
}

/**
 * Offset di una polilinea con tratti ad arco: off > 0 a sinistra del verso di percorrenza.
 * Ogni tratto diventa una parallela (o un arco concentrico); agli spigoli i tratti vicini si
 * allungano o si accorciano fino a incontrarsi e, dove non si incontrano, li unisce un arco
 * centrato sul vertice. null se la distanza è troppa per la forma (un arco si annulla o un tratto
 * si rovescia).
 */
export function offsetPolyArcs(e: { pts: Vec[]; bulges?: number[]; closed: boolean }, off: number): { pts: Vec[]; bulges: number[] } | null {
  interface Piece { a: Vec; b: Vec; arc?: { c: Vec; r: number; ccw: boolean }; dir?: Vec; sw0?: number }
  const n = e.pts.length, m = e.closed ? n : n - 1;
  const pieces: Piece[] = [];
  for (let i = 0; i < m; i++) {
    const a = e.pts[i], c = e.pts[(i + 1) % n], bu = e.bulges?.[i] ?? 0;
    if (dist(a, c) < 1e-9) return null;
    if (Math.abs(bu) > 1e-9) {
      const arc = bulgeArc(a, c, bu);
      const ccw = bu > 0;
      const r = arc.r + (ccw ? -off : off);
      if (r <= 1e-9) return null;
      const k = r / arc.r;
      pieces.push({ a: add(arc.c, mul(sub(a, arc.c), k)), b: add(arc.c, mul(sub(c, arc.c), k)), arc: { c: arc.c, r, ccw }, sw0: 4 * Math.atan(bu) });
    } else {
      const dir = norm(sub(c, a));
      const o = mul(perp(dir), off);
      pieces.push({ a: add(a, o), b: add(c, o), dir });
    }
  }
  const full = (p: Piece): Curve => (p.arc ? arcC(p.arc.c, p.arc.r, 0, TAU, true) : seg(p.a, p.b));
  const joins = e.closed ? m : m - 1;
  const links: (Piece | null)[] = pieces.map(() => null);
  for (let j = 0; j < joins; j++) {
    const P = pieces[j], Q = pieces[(j + 1) % m], vtx = e.pts[(j + 1) % n];
    if (same(P.b, Q.a, 1e-9)) continue;
    let X: Vec | null = null, best = Infinity;
    for (const x of intersect(full(P), full(Q), true, true)) {
      const dd = dist(x, P.b) + dist(x, Q.a);
      if (dd < best) { best = dd; X = x; }
    }
    if (X) { P.b = X; Q.a = X; } else links[j] = { a: P.b, b: Q.a, arc: { c: vtx, r: Math.abs(off), ccw: cross(sub(P.b, vtx), sub(Q.a, vtx)) > 0 } };
  }
  const pts: Vec[] = [], bulges: number[] = [];
  const push = (p: Piece): boolean => {
    if (dist(p.a, p.b) < 1e-9) return false;
    let bu = 0;
    if (p.arc) {
      const a0 = angleOf(p.arc.c, p.a), a1 = angleOf(p.arc.c, p.b);
      const sw = p.arc.ccw ? sweep(a0, a1) : -sweep(a1, a0);
      if (p.sw0 !== undefined && Math.abs(sw) > Math.abs(p.sw0) + Math.PI) return false;
      bu = Math.tan(sw / 4);
    } else if (p.dir && dot(sub(p.b, p.a), p.dir) <= 0) return false;
    pts.push(p.a);
    bulges.push(bu);
    return true;
  };
  for (let i = 0; i < m; i++) {
    if (!push(pieces[i])) return null;
    const l = links[i];
    if (l && !push(l)) return null;
  }
  if (!e.closed) { pts.push(pieces[m - 1].b); bulges.push(0); }
  return { pts, bulges };
}

/** Copia parallela a distanza d, dal lato del punto side. */
export function offsetEnt(e0: Ent, d: number, side: Vec): NewEnt | null {
  const e = curveAsPoly(e0);
  const b = baseOf(e);
  switch (e.t) {
    case 'line': case 'wall': {
      const n = perp(norm(sub(e.b, e.a)));
      const o = mul(n, dot(sub(side, e.a), n) >= 0 ? d : -d);
      return e.t === 'line'
        ? { ...b, t: 'line', a: add(e.a, o), b: add(e.b, o) }
        : { ...b, t: 'wall', a: add(e.a, o), b: add(e.b, o), th: e.th, ...wallFillOf(e) };
    }
    case 'circle': case 'arc': {
      const r = e.r + (dist(side, e.c) > e.r ? d : -d);
      if (r <= 1e-9) return null;
      return e.t === 'circle' ? { ...b, t: 'circle', c: e.c, r } : { ...b, t: 'arc', c: e.c, r, a0: e.a0, a1: e.a1 };
    }
    case 'poly': {
      if (e.pts.length < 2) return null;
      if (e.bulges?.some(x => Math.abs(x) > 1e-9)) {
        // lato: a sinistra o a destra del tratto più vicino, nel verso di percorrenza
        const ch = chainOf(e)!;
        let near = ch.curves[0], nd = Infinity;
        for (const c of ch.curves) { const dd = distToCurve(side, c); if (dd < nd) { nd = dd; near = c; } }
        const left = near.k === 's'
          ? cross(sub(near.b, near.a), sub(side, near.a)) >= 0
          : ((near as DArc).sw > 0) === (dist(side, near.c) < near.r);
        const r = offsetPolyArcs(e, left ? d : -d);
        return r ? { ...b, t: 'poly', pts: r.pts, bulges: r.bulges, closed: e.closed } : null;
      }
      // lato: segno rispetto al segmento più vicino
      let best = 0, bd = Infinity;
      const m = e.closed ? e.pts.length : e.pts.length - 1;
      for (let i = 0; i < m; i++) {
        const dd = dist(side, closestOnSeg(side, e.pts[i], e.pts[(i + 1) % e.pts.length]).p);
        if (dd < bd) { bd = dd; best = i; }
      }
      const a = e.pts[best], c = e.pts[(best + 1) % e.pts.length];
      const s = cross(sub(c, a), sub(side, a)) >= 0 ? 1 : -1;
      const pts = offsetPolyPts(e.pts, e.closed, s * d, true);
      return pts ? { ...b, t: 'poly', pts, closed: e.closed } : null;
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- parametri lungo un'entità

/** Rappresentazione a "catena": per linee, archi, polilinee e muri. */
interface Chain { curves: Curve[]; closed: boolean }

function chainOf(e: Ent): Chain | null {
  switch (e.t) {
    case 'line': case 'wall': return { curves: [seg(e.a, e.b)], closed: false };
    case 'arc': return { curves: [arcC(e.c, e.r, e.a0, e.a1)], closed: false };
    case 'circle': return { curves: [arcC(e.c, e.r, 0, TAU, true)], closed: true };
    case 'poly': {
      const n = e.pts.length;
      const m = e.closed ? n : n - 1;
      const curves: Curve[] = [];
      for (let i = 0; i < m; i++) {
        const a = e.pts[i], b = e.pts[(i + 1) % n];
        const bu = e.bulges?.[i] ?? 0;
        curves.push(Math.abs(bu) > 1e-9 ? bulgeArcDirected(a, b, bu) : seg(a, b));
      }
      return { curves, closed: e.closed };
    }
    default: return null;
  }
}

/** Arco di un tratto con bulge, orientato dal primo al secondo punto (sweep negativo se orario). */
interface DArc { k: 'a'; c: Vec; r: number; a0: number; a1: number; full?: boolean; s0: number; sw: number }
function bulgeArcDirected(a: Vec, b: Vec, bu: number): DArc {
  const arc = bulgeArc(a, b, bu);
  const s0 = angleOf(arc.c, a);
  const sw = 4 * Math.atan(bu);
  return { ...arc, s0, sw };
}

/** Parametro locale (0..1) di un punto su una curva della catena. */
function localT(c: Curve, p: Vec): number {
  if (c.k === 's') {
    const d = sub(c.b, c.a);
    const l2 = dot(d, d);
    return l2 < 1e-18 ? 0 : dot(sub(p, c.a), d) / l2;
  }
  const da = c as DArc;
  const ang = angleOf(c.c, p);
  if (da.sw !== undefined) {
    const raw = da.sw > 0 ? normAng(ang - da.s0) : -normAng(da.s0 - ang);
    return raw / da.sw;
  }
  if (c.full) return normAng(ang - c.a0) / TAU;
  return normAng(ang - c.a0) / sweep(c.a0, c.a1);
}

function pointAt(c: Curve, t: number): Vec {
  if (c.k === 's') return lerp(c.a, c.b, t);
  const da = c as DArc;
  if (da.sw !== undefined) return polar(c.c, c.r, da.s0 + da.sw * t);
  return polar(c.c, c.r, c.a0 + (c.full ? TAU : sweep(c.a0, c.a1)) * t);
}

function chainParamOf(ch: Chain, p: Vec): number {
  let best = 0, bd = Infinity;
  ch.curves.forEach((c, i) => {
    let t = localT(c, p);
    // fuori dall'arco: l'estremo più vicino (un angolo un soffio prima dell'inizio varrebbe quasi un giro)
    if (c.k === 'a' && (t < 0 || t > 1)) t = dist(pointAt(c, 0), p) <= dist(pointAt(c, 1), p) ? 0 : 1;
    t = Math.max(0, Math.min(1, t));
    const d = dist(pointAt(c, t), p);
    if (d < bd) { bd = d; best = i + t; }
  });
  return best;
}

function chainPoint(ch: Chain, T: number): Vec {
  const i = Math.min(ch.curves.length - 1, Math.max(0, Math.floor(T)));
  return pointAt(ch.curves[i], T - i);
}

function cutParams(ch: Chain, cutters: Curve[]): number[] {
  const out: number[] = [];
  ch.curves.forEach((c, i) => {
    for (const k of cutters) {
      for (const p of intersect(c, k)) {
        const t = localT(c, p);
        if (t >= -1e-9 && t <= 1 + 1e-9) out.push(i + Math.max(0, Math.min(1, t)));
      }
    }
  });
  out.sort((a, b) => a - b);
  return out.filter((t, i) => i === 0 || t - out[i - 1] > 1e-9);
}

/** Tratto di polilinea fra i parametri t0 < t1 (sulla catena di e). */
function subPoly(e: PolyE, t0: number, t1: number): { pts: Vec[]; bulges: number[] } {
  const ch = chainOf(e)!;
  const N = ch.curves.length;
  const pts: Vec[] = [];
  const bulges: number[] = [];
  let T = t0;
  while (T < t1 - 1e-12) {
    const i = Math.floor(T + 1e-12) % N;
    const segStart = Math.floor(T + 1e-12);
    const tLoc = T - segStart;
    const tEnd = Math.min(1, t1 - segStart);
    const c = ch.curves[i];
    pts.push(pointAt(c, tLoc));
    const bu = e.bulges?.[i] ?? 0;
    bulges.push(Math.abs(bu) > 1e-9 ? Math.tan(Math.atan(bu) * (tEnd - tLoc)) : 0);
    T = segStart + tEnd;
    if (tEnd >= 1) T = segStart + 1;
  }
  pts.push(chainPoint(ch, t1 > N ? t1 - N : t1));
  return { pts, bulges };
}

function polyPiece(e: PolyE, t0: number, t1: number): NewEnt | null {
  if (t1 - t0 < 1e-9) return null;
  const { pts, bulges } = subPoly(e, t0, t1);
  if (pts.length < 2 || dist(pts[0], pts[pts.length - 1]) < 1e-12 && pts.length === 2) return null;
  const out: NewEnt = { ...baseOf(e), t: 'poly', pts, closed: false };
  if (bulges.some(b => Math.abs(b) > 1e-9)) (out as PolyE).bulges = bulges;
  return out;
}

// ---------------------------------------------------------------- taglia

/** Curve usate come bordi di taglio / di estensione. */
export function boundaryCurves(ents: readonly Ent[], ctx: PrimCtx = DEFAULT_CTX): Curve[] {
  const out: Curve[] = [];
  for (const e of ents) {
    if (e.t === 'hatch') continue; // le righe di un tratteggio non sono bordi
    const ps = prims(e, ctx).filter(p => p.k !== 'text' && !(p.k === 'pl' && p.stroke === false) && p.k !== 'area');
    out.push(...primCurves(ps));
  }
  return out;
}

/** Toglie il tratto di e che contiene il punto pick, fra due intersezioni con i bordi. null = niente da tagliare. */
export function trimEnt(e0: Ent, cutters: Curve[], pick: Vec): NewEnt[] | null {
  const e = curveAsPoly(e0);
  const ch = chainOf(e);
  if (!ch) return null;
  const N = ch.curves.length;
  const ts = cutParams(ch, cutters).filter(t => (ch.closed ? true : t > 1e-7 && t < N - 1e-7));
  if (!ts.length) return null;
  const tp = chainParamOf(ch, pick);
  const b = baseOf(e);

  if (ch.closed) {
    const uniq = ts.map(t => (t >= N - 1e-9 ? t - N : t)).sort((a, c) => a - c).filter((t, i, a) => i === 0 || t - a[i - 1] > 1e-9);
    if (uniq.length < 2) return null;
    let lo = -Infinity, hi = Infinity;
    for (const u of uniq) {
      if (u <= tp) lo = u;
      else if (hi === Infinity) hi = u;
    }
    if (lo === -Infinity) lo = uniq[uniq.length - 1] - N;
    if (hi === Infinity) hi = uniq[0] + N;
    // si tiene il giro da hi a lo + N, cioè tutto tranne il tratto (lo, hi)
    let keep0 = hi, keep1 = lo + N;
    if (keep0 >= N) { keep0 -= N; keep1 -= N; }
    if (e.t === 'circle') {
      const a0 = angleOf(e.c, chainPoint(ch, keep0 % N)), a1 = angleOf(e.c, chainPoint(ch, keep1 % N));
      return [{ ...b, t: 'arc', c: e.c, r: e.r, a0, a1 }];
    }
    if (e.t === 'poly') {
      const p = polyPiece(e, keep0, keep1);
      return p ? [p] : [];
    }
    return null;
  }

  let lo = 0, hi = N;
  for (const t of ts) {
    if (t < tp) lo = t;
    else { hi = t; break; }
  }
  if (lo === 0 && hi === N) return null;
  const out: NewEnt[] = [];
  const pieces: [number, number][] = [];
  if (lo > 1e-9) pieces.push([0, lo]);
  if (hi < N - 1e-9) pieces.push([hi, N]);
  for (const [t0, t1] of pieces) {
    const p0 = chainPoint(ch, t0), p1 = chainPoint(ch, t1);
    switch (e.t) {
      case 'line': out.push({ ...b, t: 'line', a: p0, b: p1 }); break;
      case 'wall': out.push({ ...b, t: 'wall', a: p0, b: p1, th: e.th, ...wallFillOf(e) }); break;
      case 'arc': out.push({ ...b, t: 'arc', c: e.c, r: e.r, a0: angleOf(e.c, p0), a1: angleOf(e.c, p1) }); break;
      case 'poly': { const p = polyPiece(e, t0, t1); if (p) out.push(p); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- estendi

export function extendEnt(e0: Ent, bounds: Curve[], pick: Vec): NewEnt | null {
  const e = curveAsPoly(e0);
  const extendSeg = (a: Vec, c: Vec, fromEnd: boolean): Vec | null => {
    // estende il segmento a→c dalla parte di c (fromEnd) o di a
    let best: number | null = null;
    for (const k of bounds) {
      for (const p of intersect(seg(a, c), k, true, false)) {
        const t = localT(seg(a, c), p);
        if (fromEnd && t > 1 + 1e-9 && (best === null || t < best)) best = t;
        if (!fromEnd && t < -1e-9 && (best === null || t > best)) best = t;
      }
    }
    return best === null ? null : lerp(a, c, best);
  };
  switch (e.t) {
    case 'line': case 'wall': {
      const atEnd = dist(pick, e.b) < dist(pick, e.a);
      const p = extendSeg(e.a, e.b, atEnd);
      if (!p) return null;
      return atEnd ? { ...e, b: p } : { ...e, a: p };
    }
    case 'arc': {
      const arc = arcC(e.c, e.r, e.a0, e.a1);
      const atEnd = dist(pick, arcEnd(arc)) < dist(pick, arcStart(arc));
      let best: number | null = null;
      for (const k of bounds) {
        for (const p of intersect(arcC(e.c, e.r, 0, TAU, true), k, false, false)) {
          const ang = angleOf(e.c, p);
          const delta = atEnd ? normAng(ang - e.a1) : normAng(e.a0 - ang);
          if (delta > 1e-9 && delta < TAU - sweep(e.a0, e.a1) - 1e-9 && (best === null || delta < best)) best = delta;
        }
      }
      if (best === null) return null;
      return atEnd ? { ...e, a1: e.a1 + best } : { ...e, a0: e.a0 - best };
    }
    case 'poly': {
      if (e.closed || e.pts.length < 2) return null;
      const n = e.pts.length;
      const atEnd = dist(pick, e.pts[n - 1]) < dist(pick, e.pts[0]);
      const bu = atEnd ? e.bulges?.[n - 2] ?? 0 : e.bulges?.[0] ?? 0;
      if (Math.abs(bu) > 1e-9) return null;
      const p = atEnd ? extendSeg(e.pts[n - 2], e.pts[n - 1], true) : extendSeg(e.pts[0], e.pts[1], false);
      if (!p) return null;
      const pts = e.pts.slice();
      pts[atEnd ? n - 1 : 0] = p;
      return { ...e, pts } as NewEnt;
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- raccorda

type Straight = LineE | WallE;

/** Raccordo fra due linee (o due muri). Restituisce le entità aggiornate e l'eventuale arco. */
export function fillet(e1: Straight, p1: Vec, e2: Straight, p2: Vec, r: number): { a: Straight; b: Straight; arc?: NewEnt } | null {
  const X = lineLine(e1.a, e1.b, e2.a, e2.b);
  if (!X) return null;
  const trimTo = (e: Straight, pick: Vec, q: Vec): Straight => {
    const tx = localT(seg(e.a, e.b), X.p);
    const tp = localT(seg(e.a, e.b), pick);
    return tp < tx ? { ...e, b: q } : { ...e, a: q };
  };
  const keptDir = (e: Straight, pick: Vec): Vec => {
    const tx = localT(seg(e.a, e.b), X.p);
    const tp = localT(seg(e.a, e.b), pick);
    return norm(tp < tx ? sub(e.a, e.b) : sub(e.b, e.a));
  };
  if (r <= 1e-12 || e1.t === 'wall' || e2.t === 'wall') return { a: trimTo(e1, p1, X.p), b: trimTo(e2, p2, X.p) };
  const d1 = keptDir(e1, p1), d2 = keptDir(e2, p2);
  const cosA = Math.max(-1, Math.min(1, dot(d1, d2)));
  const phi = Math.acos(cosA) / 2;
  if (phi < 1e-6 || phi > Math.PI / 2 - 1e-6) return null;
  const dt = r / Math.tan(phi);
  // raggio troppo grande: il punto di tangenza cadrebbe oltre la fine di una delle due linee
  const keptEnd = (e: Straight, pick: Vec): Vec => (localT(seg(e.a, e.b), pick) < localT(seg(e.a, e.b), X.p) ? e.a : e.b);
  if (dist(X.p, keptEnd(e1, p1)) <= dt + 1e-9 || dist(X.p, keptEnd(e2, p2)) <= dt + 1e-9) return null;
  const T1 = add(X.p, mul(d1, dt)), T2 = add(X.p, mul(d2, dt));
  const bis = norm(add(d1, d2));
  const c = add(X.p, mul(bis, r / Math.sin(phi)));
  let a0 = angleOf(c, T1), a1 = angleOf(c, T2);
  if (sweep(a0, a1) > Math.PI) [a0, a1] = [a1, a0];
  return {
    a: trimTo(e1, p1, T1),
    b: trimTo(e2, p2, T2),
    arc: { ...baseOf(e1), t: 'arc', c, r, a0, a1 },
  };
}

// ---------------------------------------------------------------- smusso

/** Smusso fra due linee: d1 lungo la prima e d2 lungo la seconda, misurate dallo spigolo. */
export function chamfer(e1: LineE, p1: Vec, e2: LineE, p2: Vec, d1: number, d2: number): { a: LineE; b: LineE; line?: NewEnt } | 'parallel' | 'short' {
  const X = lineLine(e1.a, e1.b, e2.a, e2.b);
  if (!X) return 'parallel';
  const cut = (e: LineE, pick: Vec, d: number): { e: LineE; q: Vec } | null => {
    const s = seg(e.a, e.b);
    const keepA = localT(s, pick) < localT(s, X.p);
    const far = keepA ? e.a : e.b;
    if (dist(far, X.p) <= d + 1e-9) return null;
    const q = add(X.p, mul(norm(sub(far, X.p)), d));
    return { e: keepA ? { ...e, b: q } : { ...e, a: q }, q };
  };
  const c1 = cut(e1, p1, d1), c2 = cut(e2, p2, d2);
  if (!c1 || !c2) return 'short';
  if (dist(c1.q, c2.q) < 1e-9) return { a: c1.e, b: c2.e };
  return { a: c1.e, b: c2.e, line: { ...baseOf(e1), t: 'line', a: c1.q, b: c2.q } };
}

// ---------------------------------------------------------------- serie

/** Spostamenti delle copie di una serie rettangolare (l'originale, riga 0 colonna 0, è escluso). */
export function arrayRect(rows: number, cols: number, dy: number, dx: number): Mat[] {
  const out: Mat[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (r || c) out.push(translate(c * dx, r * dy));
  return out;
}

/**
 * Trasformazioni delle copie di una serie polare di n elementi (originale compreso) attorno a c.
 * fill = angolo da riempire: sul giro completo gli elementi sono equidistanti, altrimenti il primo
 * e l'ultimo stanno agli estremi. Senza rotazione le copie restano dritte e ruota solo il punto ref.
 */
export function arrayPolar(c: Vec, n: number, fill: number, rotateItems: boolean, ref: Vec): Mat[] {
  const full = Math.abs(Math.abs(fill) - TAU) < 1e-9;
  const step = full ? fill / n : fill / (n - 1);
  const out: Mat[] = [];
  for (let i = 1; i < n; i++) {
    const m = rotateAbout(c, i * step);
    if (rotateItems) out.push(m);
    else { const q = apply(m, ref); out.push(translate(q.x - ref.x, q.y - ref.y)); }
  }
  return out;
}

// ---------------------------------------------------------------- spigoli di una polilinea

/** Tratto dritto o no, lunghezza e indice del tratto più vicino a p. */
function nearestSeg(e: PolyE, p: Vec): number {
  const n = e.pts.length, m = e.closed ? n : n - 1;
  let best = -1, bd = Infinity;
  const ch = chainOf(e)!;
  for (let i = 0; i < m; i++) { const d = distToCurve(p, ch.curves[i]); if (d < bd) { bd = d; best = i; } }
  return best;
}

/**
 * Sostituisce il vertice vi con due punti a distanza dA lungo il tratto che arriva e dB lungo quello
 * che parte, uniti da un arco tangente (arc) o da un tratto dritto. null se i tratti non sono dritti
 * o le distanze non ci stanno.
 */
function cutCorner(e: PolyE, vi: number, dA: number, dB: number, arc: boolean): PolyE | null {
  const n = e.pts.length;
  if (!e.closed && (vi <= 0 || vi >= n - 1)) return null;
  const ip = (vi - 1 + n) % n, inx = (vi + 1) % n;
  const bulges = Array.from({ length: n }, (_, i) => e.bulges?.[i] ?? 0);
  if (Math.abs(bulges[ip]) > 1e-9 || Math.abs(bulges[vi]) > 1e-9) return null;
  const V = e.pts[vi], A = e.pts[ip], B = e.pts[inx];
  if (dA >= dist(V, A) - 1e-9 || dB >= dist(V, B) - 1e-9 || dA < 0 || dB < 0 || dA + dB < 1e-12) return null;
  const T1 = add(V, mul(norm(sub(A, V)), dA)), T2 = add(V, mul(norm(sub(B, V)), dB));
  // angolo di cui gira il percorso nello spigolo: è l'ampiezza dell'arco di raccordo
  const din = sub(V, A), dout = sub(B, V);
  const turn = Math.atan2(cross(din, dout), dot(din, dout));
  const pts = e.pts.slice();
  pts.splice(vi, 1, T1, T2);
  bulges.splice(vi, 0, arc ? Math.tan(turn / 4) : 0);
  const out: PolyE = { ...e, pts };
  if (bulges.some(b => Math.abs(b) > 1e-9)) out.bulges = bulges; else delete out.bulges;
  return out;
}

/** Distanza dallo spigolo dei punti di tangenza di un raccordo di raggio r nel vertice vi; null se non è uno spigolo. */
function filletDist(e: PolyE, vi: number, r: number): number | null {
  const n = e.pts.length;
  const V = e.pts[vi], A = e.pts[(vi - 1 + n) % n], B = e.pts[(vi + 1) % n];
  if (dist(V, A) < 1e-9 || dist(V, B) < 1e-9) return null;
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(A, V)), norm(sub(B, V)))))) / 2;
  if (phi < 1e-6 || phi > Math.PI / 2 - 1e-6) return null;
  return r / Math.tan(phi);
}

/**
 * Raccordo (r) o smusso (d1 sul tratto di p1, d2 su quello di p2) dello spigolo fra due tratti dritti
 * consecutivi di una polilinea, indicati dai punti p1 e p2. null se non sono consecutivi, non sono
 * dritti o la misura non ci sta.
 */
export function cornerPoly(e: PolyE, p1: Vec, p2: Vec, how: { r: number } | { d1: number; d2: number }): PolyE | null {
  const n = e.pts.length, m = e.closed ? n : n - 1;
  const i = nearestSeg(e, p1), j = nearestSeg(e, p2);
  if (i < 0 || j < 0 || i === j) return null;
  // il tratto k va dal vertice k al successivo: due tratti sono consecutivi se uno finisce dove l'altro comincia
  let vi: number, firstIsPrev: boolean;
  if (m < 2) return null;
  if ((i + 1) % n === j) { vi = j; firstIsPrev = true; }
  else if ((j + 1) % n === i) { vi = i; firstIsPrev = false; }
  else return null;
  if ('r' in how) {
    const dt = filletDist(e, vi, how.r);
    return dt === null || dt < 1e-12 ? null : cutCorner(e, vi, dt, dt, true);
  }
  return firstIsPrev ? cutCorner(e, vi, how.d1, how.d2, false) : cutCorner(e, vi, how.d2, how.d1, false);
}

/** Raccorda con raggio r tutti gli spigoli della polilinea in cui il raccordo ci sta. n = quanti. */
export function filletPolyAll(e: PolyE, r: number): { poly: PolyE; n: number } | null {
  if (r <= 1e-12) return null;
  const n = e.pts.length;
  const bulge = (i: number) => Math.abs(e.bulges?.[(i + n) % n] ?? 0) > 1e-9;
  const dts: (number | null)[] = e.pts.map((_, vi) => {
    if (!e.closed && (vi === 0 || vi === n - 1)) return null;
    if (bulge(vi - 1) || bulge(vi)) return null;
    return filletDist(e, vi, r);
  });
  // Su ogni tratto devono starci i raccordi dei suoi due estremi. Quelli che non ci stanno si decidono
  // tutti insieme sulle misure di partenza, così il risultato non dipende dall'ordine dei vertici.
  const fits = dts.map((d, vi) => {
    if (d === null) return false;
    const prev = (vi - 1 + n) % n, next = (vi + 1) % n;
    return d + (dts[prev] ?? 0) <= dist(e.pts[vi], e.pts[prev]) - 1e-9 && d + (dts[next] ?? 0) <= dist(e.pts[vi], e.pts[next]) - 1e-9;
  });
  fits.forEach((ok, vi) => { if (!ok) dts[vi] = null; });
  let poly = e, count = 0;
  for (let vi = n - 1; vi >= 0; vi--) {
    const d = dts[vi];
    if (d === null) continue;
    const r2 = cutCorner(poly, vi, d, d, true);
    if (r2) { poly = r2; count++; }
  }
  return count ? { poly, n: count } : null;
}

// ---------------------------------------------------------------- unisci

interface Piece { id: number; pts: Vec[]; bulges: number[] }

function pieceOf(e: Ent): Piece | null {
  if (e.t === 'line') return { id: e.id, pts: [e.a, e.b], bulges: [0] };
  if (e.t === 'arc') {
    const a = arcC(e.c, e.r, e.a0, e.a1);
    return { id: e.id, pts: [arcStart(a), arcEnd(a)], bulges: [Math.tan(sweep(e.a0, e.a1) / 4)] };
  }
  if (e.t === 'poly' && !e.closed) return { id: e.id, pts: e.pts, bulges: e.pts.slice(0, -1).map((_, i) => e.bulges?.[i] ?? 0) };
  return null;
}

function reversePiece(p: Piece): Piece {
  return { id: p.id, pts: p.pts.slice().reverse(), bulges: p.bulges.slice().reverse().map(b => -b) };
}

/** Concatena linee, archi e polilinee aperte che si toccano agli estremi. */
export function joinEnts(ents: Ent[], eps = 1e-6): { poly: NewEnt; used: number[] } | null {
  const pieces = ents.map(pieceOf).filter((p): p is Piece => !!p);
  if (pieces.length < 2) return null;
  let chain = pieces.shift()!;
  const used = [chain.id];
  let grown = true;
  while (grown && pieces.length) {
    grown = false;
    for (let i = 0; i < pieces.length; i++) {
      let p = pieces[i];
      const s = chain.pts[0], e = chain.pts[chain.pts.length - 1];
      if (same(e, p.pts[0], eps) || same(e, p.pts[p.pts.length - 1], eps)) {
        if (!same(e, p.pts[0], eps)) p = reversePiece(p);
        chain = { id: chain.id, pts: [...chain.pts, ...p.pts.slice(1)], bulges: [...chain.bulges, ...p.bulges] };
      } else if (same(s, p.pts[0], eps) || same(s, p.pts[p.pts.length - 1], eps)) {
        if (!same(s, p.pts[p.pts.length - 1], eps)) p = reversePiece(p);
        chain = { id: chain.id, pts: [...p.pts, ...chain.pts.slice(1)], bulges: [...p.bulges, ...chain.bulges] };
      } else continue;
      used.push(p.id);
      pieces.splice(i, 1);
      grown = true;
      break;
    }
  }
  if (used.length < 2) return null;
  let pts = chain.pts, bulges = chain.bulges;
  // anche due soli pezzi chiudono un contorno, purché non siano due linee sovrapposte (una "D", due semicerchi)
  const closed = same(pts[0], pts[pts.length - 1], eps) && (pts.length > 3 || (pts.length === 3 && bulges.some(b => Math.abs(b) > 1e-9)));
  if (closed) pts = pts.slice(0, -1);
  else bulges = bulges.slice(0, pts.length - 1);
  const first = ents.find(e => e.id === used[0])!;
  const poly: NewEnt = { ...baseOf(first), t: 'poly', pts, closed };
  if (bulges.some(b => Math.abs(b) > 1e-9)) (poly as PolyE).bulges = bulges;
  return { poly, used };
}

// ---------------------------------------------------------------- contorni chiusi

/** Contorno chiuso più piccolo che contiene il punto (polilinee chiuse, cerchi, locali). */
export function closedLoopAt(ents: readonly Ent[], p: Vec): { loop: Vec[]; id: number } | null {
  let best: { loop: Vec[]; id: number; area: number } | null = null;
  for (const e of ents) {
    let loop: Vec[] | null = null;
    if (e.t === 'poly' && e.closed) loop = polyPoints(e);
    else if (e.t === 'room') loop = e.pts;
    else if (e.t === 'circle') loop = tessArc(e.c, e.r, 0, TAU).slice(0, -1);
    else if (e.t === 'ellipse') loop = ellipsePoints(e);
    else if (e.t === 'spline' && e.closed) loop = splinePoints(e.pts, true);
    if (!loop || loop.length < 3 || !pointInPolygon(p, loop)) continue;
    const area = Math.abs(polygonArea(loop));
    if (!best || area < best.area) best = { loop, id: e.id, area };
  }
  return best && { loop: best.loop, id: best.id };
}

/** Isole: contorni chiusi interamente dentro il contorno esterno. */
export function islandsIn(ents: readonly Ent[], outer: Vec[], excludeId: number): Vec[][] {
  const out: Vec[][] = [];
  for (const e of ents) {
    if (e.id === excludeId) continue;
    let loop: Vec[] | null = null;
    if (e.t === 'poly' && e.closed) loop = polyPoints(e);
    else if (e.t === 'circle') loop = tessArc(e.c, e.r, 0, TAU).slice(0, -1);
    else if (e.t === 'ellipse') loop = ellipsePoints(e);
    else if (e.t === 'spline' && e.closed) loop = splinePoints(e.pts, true);
    if (loop && loop.length >= 3 && loop.every(q => pointInPolygon(q, outer))) out.push(loop);
  }
  return out;
}

// ---------------------------------------------------------------- spezza, allunga, dividi

const curveLen = (c: Curve): number => {
  if (c.k === 's') return dist(c.a, c.b);
  const sw = (c as DArc).sw;
  return c.r * (sw !== undefined ? Math.abs(sw) : c.full ? TAU : sweep(c.a0, c.a1));
};

/** Lunghezza di linee, archi, cerchi, polilinee, muri (sull'asse), ellissi e spline. null per il resto. */
export function entLength(e: Ent): number | null {
  const ch = chainOf(curveAsPoly(e));
  return ch ? ch.curves.reduce((s, c) => s + curveLen(c), 0) : null;
}

/**
 * Toglie da e il tratto fra p1 e p2 (i punti più vicini sull'entità). Con p1 = p2 la divide in due
 * in quel punto. Su un contorno chiuso toglie il tratto che va da p1 a p2 nel verso del contorno
 * (antiorario per i cerchi); con p1 = p2 una polilinea chiusa viene aperta lì.
 */
export function breakEnt(e0: Ent, p1: Vec, p2: Vec): NewEnt[] | null {
  const e = curveAsPoly(e0);
  const ch = chainOf(e);
  if (!ch) return null;
  const N = ch.curves.length;
  const b = baseOf(e);
  const piece = (t0: number, t1: number): NewEnt | null => {
    if (t1 - t0 < 1e-9) return null;
    const q0 = chainPoint(ch, t0), q1 = chainPoint(ch, t1);
    switch (e.t) {
      case 'line': return { ...b, t: 'line', a: q0, b: q1 };
      case 'wall': return { ...b, t: 'wall', a: q0, b: q1, th: e.th, ...wallFillOf(e) };
      case 'arc': case 'circle': return { ...b, t: 'arc', c: e.c, r: e.r, a0: angleOf(e.c, q0), a1: angleOf(e.c, q1) };
      case 'poly': return polyPiece(e, t0, t1);
      default: return null;
    }
  };
  const t1 = chainParamOf(ch, p1);
  let t2 = chainParamOf(ch, p2);
  if (ch.closed) {
    if (Math.abs(t1 - t2) < 1e-9) {
      if (e.t !== 'poly') return null;
      const r = piece(t1, t1 + N);
      return r ? [r] : null;
    }
    if (t2 < t1) t2 += N;
    const r = piece(t2, t1 + N);
    return r ? [r] : null;
  }
  const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
  const out = [piece(0, lo), piece(hi, N)].filter((x): x is NewEnt => !!x);
  // niente da fare se resterebbe l'entità intera (punto su un estremo) o non resterebbe nulla
  if (!out.length || (out.length === 1 && hi - lo < 1e-9)) return null;
  return out;
}

/**
 * Allunga o accorcia e dalla parte dell'estremo più vicino a pick: di delta, oppure fino alla
 * lunghezza total. Vale per linee, muri, archi e per l'ultimo tratto dritto delle polilinee aperte.
 */
export function lengthenEnt(e: Ent, pick: Vec, by: { delta?: number; total?: number }): Ent | null {
  const len0 = entLength(e);
  if (len0 === null) return null;
  const delta = by.total !== undefined ? by.total - len0 : by.delta ?? 0;
  if (Math.abs(delta) < 1e-12) return null;
  switch (e.t) {
    case 'line': case 'wall': {
      const L = len0 + delta;
      if (L <= 1e-9) return null;
      const atEnd = dist(pick, e.b) < dist(pick, e.a);
      const u = norm(sub(e.b, e.a));
      return atEnd ? { ...e, b: add(e.a, mul(u, L)) } : { ...e, a: sub(e.b, mul(u, L)) };
    }
    case 'arc': {
      const sw = (len0 + delta) / e.r;
      if (sw <= 1e-9 || sw >= TAU - 1e-9) return null;
      const arc = arcC(e.c, e.r, e.a0, e.a1);
      const atEnd = dist(pick, arcEnd(arc)) < dist(pick, arcStart(arc));
      return atEnd ? { ...e, a1: e.a0 + sw } : { ...e, a0: e.a1 - sw };
    }
    case 'poly': {
      const n = e.pts.length;
      if (e.closed || n < 2) return null;
      const atEnd = dist(pick, e.pts[n - 1]) < dist(pick, e.pts[0]);
      if (Math.abs((atEnd ? e.bulges?.[n - 2] : e.bulges?.[0]) ?? 0) > 1e-9) return null;
      const [from, to] = atEnd ? [e.pts[n - 2], e.pts[n - 1]] : [e.pts[1], e.pts[0]];
      const L = dist(from, to) + delta;
      if (L <= 1e-9) return null;
      const pts = e.pts.slice();
      pts[atEnd ? n - 1 : 0] = add(from, mul(norm(sub(to, from)), L));
      return { ...e, pts };
    }
    default: return null;
  }
}

/**
 * Punti lungo e: con n, quelli che la dividono in n parti uguali; con d, uno ogni d a partire
 * dall'inizio. Gli estremi di un'entità aperta non sono compresi.
 */
export function pointsAlong(e: Ent, by: { n?: number; d?: number }): Vec[] | null {
  const ch = chainOf(curveAsPoly(e));
  if (!ch) return null;
  const lens = ch.curves.map(curveLen);
  const total = lens.reduce((s, x) => s + x, 0);
  if (total < 1e-12) return null;
  const at: number[] = [];
  if (by.n !== undefined) {
    if (!Number.isInteger(by.n) || by.n < 2 || by.n > 5000) return null;
    for (let i = ch.closed ? 0 : 1; i < by.n; i++) at.push((total * i) / by.n);
  } else if (by.d !== undefined && by.d > 1e-12) {
    if (total / by.d > 5000) return null;
    for (let s = by.d; s < total - 1e-9; s += by.d) at.push(s);
  } else return null;
  return at.map(s => {
    let i = 0;
    while (i < lens.length - 1 && s > lens[i]) { s -= lens[i]; i++; }
    return chainPoint(ch, i + (lens[i] > 0 ? Math.min(1, s / lens[i]) : 0));
  });
}

// ---------------------------------------------------------------- vertici delle polilinee

/** Aggiunge un vertice sul tratto dritto più vicino a p. null se cade su un arco o su un vertice. */
export function polyAddVertex(e: PolyE, p: Vec): PolyE | null {
  const n = e.pts.length, m = e.closed ? n : n - 1;
  let best = -1, bd = Infinity, q = p;
  for (let i = 0; i < m; i++) {
    const c = closestOnSeg(p, e.pts[i], e.pts[(i + 1) % n]);
    const d = dist(p, c.p);
    if (d < bd) { bd = d; best = i; q = c.p; }
  }
  if (best < 0 || Math.abs(e.bulges?.[best] ?? 0) > 1e-9) return null;
  if (dist(q, e.pts[best]) < 1e-9 || dist(q, e.pts[(best + 1) % n]) < 1e-9) return null;
  const pts = e.pts.slice();
  pts.splice(best + 1, 0, q);
  const out: PolyE = { ...e, pts };
  if (e.bulges) { const bulges = e.bulges.slice(); while (bulges.length < n) bulges.push(0); bulges.splice(best + 1, 0, 0); out.bulges = bulges; }
  return out;
}

/** Toglie il vertice più vicino a p; i due tratti che vi arrivavano diventano uno, dritto. */
export function polyRemoveVertex(e: PolyE, p: Vec): PolyE | null {
  const n = e.pts.length;
  if (n <= (e.closed ? 3 : 2)) return null;
  let i = 0;
  for (let j = 1; j < n; j++) if (dist(p, e.pts[j]) < dist(p, e.pts[i])) i = j;
  const pts = e.pts.slice();
  pts.splice(i, 1);
  const out: PolyE = { ...e, pts };
  if (e.bulges) {
    const bulges = e.bulges.slice();
    while (bulges.length < n) bulges.push(0);
    if (i > 0 || e.closed) bulges[(i - 1 + n) % n] = 0;
    bulges.splice(i, 1);
    if (bulges.some(x => Math.abs(x) > 1e-9)) out.bulges = bulges; else delete out.bulges;
  }
  return out;
}

export { v };
