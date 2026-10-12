// Geometria 2D: vettori, archi, intersezioni, trasformazioni affini.

export interface Vec { x: number; y: number }

export const TAU = Math.PI * 2;
export const EPS = 1e-9;

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Vec, b: Vec): Vec => lerp(a, b, 0.5);
export const angleOf = (a: Vec, b: Vec): number => Math.atan2(b.y - a.y, b.x - a.x);
export const polar = (c: Vec, r: number, ang: number): Vec => ({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
export const dirOf = (ang: number): Vec => ({ x: Math.cos(ang), y: Math.sin(ang) });
export const same = (a: Vec, b: Vec, eps = 1e-6): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

export function norm(a: Vec): Vec {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function normAng(a: number): number {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

/** Ampiezza CCW da a0 ad a1, in (0, TAU]. */
export function sweep(a0: number, a1: number): number {
  const s = normAng(a1 - a0);
  return s < 1e-12 ? TAU : s;
}

/** L'angolo a cade nell'arco CCW da a0 ad a1. */
export function angInArc(a: number, a0: number, a1: number, eps = 1e-9): boolean {
  // la tolleranza vale da tutte e due le parti: un angolo un soffio prima di a0 diventa quasi 2π
  const d = normAng(a - a0);
  return d <= sweep(a0, a1) + eps || d >= TAU - eps;
}

// ---------------------------------------------------------------- curve

export interface Seg { k: 's'; a: Vec; b: Vec }
/** Arco CCW da a0 ad a1; full = cerchio intero. */
export interface Arc { k: 'a'; c: Vec; r: number; a0: number; a1: number; full?: boolean }
export type Curve = Seg | Arc;

export const seg = (a: Vec, b: Vec): Seg => ({ k: 's', a, b });
export const arcC = (c: Vec, r: number, a0: number, a1: number, full = false): Arc => ({ k: 'a', c, r, a0, a1, full });

export function arcStart(a: Arc): Vec { return polar(a.c, a.r, a.a0); }
export function arcEnd(a: Arc): Vec { return polar(a.c, a.r, a.a1); }
export function arcMid(a: Arc): Vec { return polar(a.c, a.r, a.a0 + sweep(a.a0, a.a1) / 2); }

/** Arco equivalente a un tratto di polilinea con bulge. */
export function bulgeArc(p1: Vec, p2: Vec, bulge: number): Arc {
  const theta = 4 * Math.atan(bulge);
  const chord = dist(p1, p2);
  const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
  const m = mid(p1, p2);
  const h = r * Math.cos(theta / 2); // distanza centro-corda (con segno)
  const n = norm(perp(sub(p2, p1)));
  const c = add(m, mul(n, bulge > 0 ? h : -h));
  const a1 = angleOf(c, p1);
  const a2 = angleOf(c, p2);
  return bulge > 0 ? arcC(c, r, a1, a2) : arcC(c, r, a2, a1);
}

export function tessArc(c: Vec, r: number, a0: number, sw: number, maxErr = 0): Vec[] {
  let n: number;
  if (maxErr > 0 && r > maxErr) {
    const step = 2 * Math.acos(1 - maxErr / r);
    n = Math.ceil(Math.abs(sw) / step);
  } else n = Math.ceil(Math.abs(sw) / (Math.PI / 32));
  n = Math.max(2, Math.min(720, n));
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) pts.push(polar(c, r, a0 + (sw * i) / n));
  return pts;
}

export function tessCurve(cv: Curve, maxErr = 0): Vec[] {
  if (cv.k === 's') return [cv.a, cv.b];
  return tessArc(cv.c, cv.r, cv.a0, cv.full ? TAU : sweep(cv.a0, cv.a1), maxErr);
}

// ---------------------------------------------------------------- distanze

export function closestOnSeg(p: Vec, a: Vec, b: Vec): { p: Vec; t: number } {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < EPS) return { p: a, t: 0 };
  let t = dot(sub(p, a), d) / l2;
  t = Math.max(0, Math.min(1, t));
  return { p: lerp(a, b, t), t };
}

export function distToSeg(p: Vec, a: Vec, b: Vec): number {
  return dist(p, closestOnSeg(p, a, b).p);
}

export function closestOnCurve(p: Vec, cv: Curve): Vec {
  if (cv.k === 's') return closestOnSeg(p, cv.a, cv.b).p;
  const ang = angleOf(cv.c, p);
  if (cv.full || angInArc(ang, cv.a0, cv.a1)) return polar(cv.c, cv.r, ang);
  const s = arcStart(cv), e = arcEnd(cv);
  return dist(p, s) < dist(p, e) ? s : e;
}

export function distToCurve(p: Vec, cv: Curve): number {
  return dist(p, closestOnCurve(p, cv));
}

/** Piede della perpendicolare da p alla retta/cerchio della curva, se cade sulla curva. */
export function perpFoot(p: Vec, cv: Curve): Vec | null {
  if (cv.k === 's') {
    const d = sub(cv.b, cv.a);
    const l2 = dot(d, d);
    if (l2 < EPS) return null;
    const t = dot(sub(p, cv.a), d) / l2;
    return t >= -1e-9 && t <= 1 + 1e-9 ? lerp(cv.a, cv.b, t) : null;
  }
  if (dist(p, cv.c) < EPS) return null;
  const ang = angleOf(cv.c, p);
  return cv.full || angInArc(ang, cv.a0, cv.a1) ? polar(cv.c, cv.r, ang) : null;
}

// ---------------------------------------------------------------- intersezioni

/** Rette infinite p1p2 e p3p4: parametri t (su p1p2) e u (su p3p4). */
export function lineLine(p1: Vec, p2: Vec, p3: Vec, p4: Vec): { t: number; u: number; p: Vec } | null {
  const d1 = sub(p2, p1), d2 = sub(p4, p3);
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12 * Math.max(1, len(d1) * len(d2))) return null;
  const w = sub(p3, p1);
  const t = cross(w, d2) / den;
  const u = cross(w, d1) / den;
  return { t, u, p: add(p1, mul(d1, t)) };
}

/** Parametri t della retta p1p2 sul cerchio (c, r). */
export function lineCircle(p1: Vec, p2: Vec, c: Vec, r: number): number[] {
  const d = sub(p2, p1);
  const f = sub(p1, c);
  const A = dot(d, d);
  if (A < EPS) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  // tolleranza relativa alle grandezze in gioco: una soglia fissa vedrebbe tangenze false nei disegni in metri
  if (disc < -1e-9 * (B * B + 4 * A * r * r)) return [];
  if (disc < 0) disc = 0;
  const s = Math.sqrt(disc);
  if (s < 1e-12) return [-B / (2 * A)];
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}

export function circleCircle(c1: Vec, r1: number, c2: Vec, r2: number): Vec[] {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const u = norm(sub(c2, c1));
  const m = add(c1, mul(u, a));
  if (h < 1e-12) return [m];
  const n = perp(u);
  return [add(m, mul(n, h)), add(m, mul(n, -h))];
}

function onArc(a: Arc, p: Vec): boolean {
  return !!a.full || angInArc(angleOf(a.c, p), a.a0, a.a1, 1e-7);
}

/**
 * Intersezioni fra due curve. Con ext1/ext2 la curva corrispondente è
 * considerata prolungata (retta infinita o cerchio intero).
 */
export function intersect(c1: Curve, c2: Curve, ext1 = false, ext2 = false): Vec[] {
  const T = 1e-9;
  if (c1.k === 's' && c2.k === 's') {
    const r = lineLine(c1.a, c1.b, c2.a, c2.b);
    if (!r) return [];
    if (!ext1 && (r.t < -T || r.t > 1 + T)) return [];
    if (!ext2 && (r.u < -T || r.u > 1 + T)) return [];
    return [r.p];
  }
  if (c1.k === 'a' && c2.k === 's') return intersect(c2, c1, ext2, ext1);
  if (c1.k === 's' && c2.k === 'a') {
    return lineCircle(c1.a, c1.b, c2.c, c2.r)
      .filter(t => ext1 || (t >= -T && t <= 1 + T))
      .map(t => lerp(c1.a, c1.b, t))
      .filter(p => ext2 || onArc(c2, p));
  }
  const a1 = c1 as Arc, a2 = c2 as Arc;
  return circleCircle(a1.c, a1.r, a2.c, a2.r).filter(p => (ext1 || onArc(a1, p)) && (ext2 || onArc(a2, p)));
}

// ---------------------------------------------------------------- poligoni

export function polygonArea(pts: Vec[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) s += cross(pts[i], pts[(i + 1) % n]);
  return s / 2;
}

export function centroid(pts: Vec[]): Vec {
  const A = polygonArea(pts);
  if (Math.abs(A) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), v(0, 0));
    return mul(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const f = cross(p, q);
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return v(cx / (6 * A), cy / (6 * A));
}

export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Tratti della retta (p, dir) interni ai contorni (regola pari-dispari). */
export function clipLineToLoops(p: Vec, dir: Vec, loops: Vec[][]): [Vec, Vec][] {
  const ts: number[] = [];
  const q = add(p, dir);
  for (const loop of loops) {
    for (let i = 0, n = loop.length; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      // il lato conta se i suoi estremi stanno da parti opposte della retta: così un vertice che cade
      // proprio sulla retta è contato una volta sola, e non zero o due per gli arrotondamenti
      const sa = cross(dir, sub(a, p)), sb = cross(dir, sub(b, p));
      if ((sa > 0) === (sb > 0)) continue;
      const r = lineLine(p, q, a, b);
      if (r) ts.push(r.t);
    }
  }
  ts.sort((x, y) => x - y);
  const out: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    if (ts[i + 1] - ts[i] > 1e-9) out.push([add(p, mul(dir, ts[i])), add(p, mul(dir, ts[i + 1]))]);
  }
  return out;
}

// ---------------------------------------------------------------- box

export interface Box { x0: number; y0: number; x1: number; y1: number }

export const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export const boxValid = (b: Box): boolean => b.x0 <= b.x1 && b.y0 <= b.y1;

export function boxAdd(b: Box, p: Vec): Box {
  if (p.x < b.x0) b.x0 = p.x;
  if (p.y < b.y0) b.y0 = p.y;
  if (p.x > b.x1) b.x1 = p.x;
  if (p.y > b.y1) b.y1 = p.y;
  return b;
}

export function boxUnion(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function boxOf(a: Vec, b: Vec): Box {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

export const boxOverlap = (a: Box, b: Box): boolean => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
export const boxInside = (inner: Box, outer: Box): boolean =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
export const inBox = (p: Vec, b: Box): boolean => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

export function segHitsBox(a: Vec, b: Vec, bx: Box): boolean {
  if (inBox(a, bx) || inBox(b, bx)) return true;
  const c = [v(bx.x0, bx.y0), v(bx.x1, bx.y0), v(bx.x1, bx.y1), v(bx.x0, bx.y1)];
  for (let i = 0; i < 4; i++) {
    const r = lineLine(a, b, c[i], c[(i + 1) % 4]);
    if (r && r.t >= 0 && r.t <= 1 && r.u >= 0 && r.u <= 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------- trasformazioni

/** x' = a·x + c·y + e ;  y' = b·x + d·y + f */
export interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENT: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function apply(m: Mat, p: Vec): Vec {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}
export function applyDir(m: Mat, p: Vec): Vec {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}
/** m1 dopo m2 */
export function compose(m1: Mat, m2: Mat): Mat {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}
export const det = (m: Mat): number => m.a * m.d - m.b * m.c;
export const translate = (dx: number, dy: number): Mat => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
export function rotateAbout(c: Vec, ang: number): Mat {
  const co = Math.cos(ang), si = Math.sin(ang);
  return { a: co, b: si, c: -si, d: co, e: c.x - co * c.x + si * c.y, f: c.y - si * c.x - co * c.y };
}
export function scaleAbout(c: Vec, sx: number, sy = sx): Mat {
  return { a: sx, b: 0, c: 0, d: sy, e: c.x * (1 - sx), f: c.y * (1 - sy) };
}
export function mirrorAcross(p1: Vec, p2: Vec): Mat {
  const ang = angleOf(p1, p2);
  const co = Math.cos(2 * ang), si = Math.sin(2 * ang);
  const r: Mat = { a: co, b: si, c: si, d: -co, e: 0, f: 0 };
  return compose(translate(p1.x, p1.y), compose(r, translate(-p1.x, -p1.y)));
}
/** Fattore di scala medio (per raggi, spessori, altezze testo). */
export const matScale = (m: Mat): number => Math.sqrt(Math.abs(det(m)));
export const isUniform = (m: Mat): boolean =>
  Math.abs(Math.hypot(m.a, m.b) - Math.hypot(m.c, m.d)) < 1e-9 * Math.max(1, Math.hypot(m.a, m.b)) && Math.abs(m.a * m.c + m.b * m.d) < 1e-9;
export const mapAngle = (m: Mat, ang: number): number => {
  const d = applyDir(m, dirOf(ang));
  return Math.atan2(d.y, d.x);
};
