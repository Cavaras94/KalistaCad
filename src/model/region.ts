// Ricerca del contorno chiuso attorno a un punto (clic interno), a partire dalle linee visibili.
import type { Ent, PrimCtx } from './entities';
import { prims, primCurves } from './entities';
import {
  Vec, Box, v, add, sub, mul, perp, dirOf, dist, cross, tessCurve, lineLine, polygonArea, pointInPolygon,
  boxOverlap, boxInside, emptyBox, boxAdd,
} from './geom';
import { entBox } from './entities';

type S = [Vec, Vec];

/** Segmenti che delimitano le regioni: tratti visibili e soglie dei vani porta/finestra. */
export function regionSegments(ents: readonly Ent[], ctx: PrimCtx, area?: Box): S[] {
  const out: S[] = [];
  for (const e of ents) {
    if (e.t === 'room' || e.t === 'hatch' || e.t === 'dim' || e.t === 'text') continue;
    if (area && !boxOverlap(entBox(e, ctx), area)) continue;
    if (e.t === 'door' || e.t === 'window') {
      const th = ctx.walls?.openTh.get(e.id) ?? e.th;
      const u = dirOf(e.ang), n = perp(u);
      for (const s of [1, -1]) {
        const o = mul(n, (s * th) / 2);
        out.push([add(sub(e.p, mul(u, e.w / 2)), o), add(add(e.p, mul(u, e.w / 2)), o)]);
      }
      continue;
    }
    const ps = prims(e, ctx).filter(p => p.k !== 'text' && p.k !== 'area' && !(p.k === 'pl' && p.stroke === false));
    for (const c of primCurves(ps)) {
      const pts = tessCurve(c, 0);
      for (let i = 0; i + 1 < pts.length; i++) if (dist(pts[i], pts[i + 1]) > 1e-9) out.push([pts[i], pts[i + 1]]);
    }
  }
  return out;
}

/** Spezza i segmenti nei punti in cui si incrociano. */
function splitAll(segs: S[]): S[] {
  const cuts: number[][] = segs.map(() => [0, 1]);
  const boxes = segs.map(([a, b]) => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }));
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (!boxOverlap(boxes[i], boxes[j])) continue;
      const r = lineLine(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (!r) continue;
      const T = 1e-9;
      if (r.t >= -T && r.t <= 1 + T && r.u >= -T && r.u <= 1 + T) {
        cuts[i].push(Math.min(1, Math.max(0, r.t)));
        cuts[j].push(Math.min(1, Math.max(0, r.u)));
      }
    }
  }
  const out: S[] = [];
  segs.forEach(([a, b], i) => {
    const ts = cuts[i].sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-9) continue;
      const p = add(a, mul(sub(b, a), ts[k])), q = add(a, mul(sub(b, a), ts[k + 1]));
      if (dist(p, q) > 1e-9) out.push([p, q]);
    }
  });
  return out;
}

function traceFace(segs: S[], p: Vec): Vec[] | null {
  const parts = splitAll(segs);
  const keyOf = (q: Vec) => `${Math.round(q.x * 1e5)}:${Math.round(q.y * 1e5)}`;
  const verts: Vec[] = [];
  const idx = new Map<string, number>();
  const vid = (q: Vec) => {
    const k = keyOf(q);
    let i = idx.get(k);
    if (i === undefined) { i = verts.length; verts.push(q); idx.set(k, i); }
    return i;
  };
  const adj = new Map<number, Set<number>>();
  const edges: [number, number][] = [];
  for (const [a, b] of parts) {
    const i = vid(a), j = vid(b);
    if (i === j) continue;
    if (!adj.has(i)) adj.set(i, new Set());
    if (!adj.has(j)) adj.set(j, new Set());
    if (adj.get(i)!.has(j)) continue;
    adj.get(i)!.add(j);
    adj.get(j)!.add(i);
    edges.push([i, j]);
  }
  // spigolo di partenza: il primo colpito da un raggio verso +x
  let best: { i: number; j: number; t: number } | null = null;
  for (const [i, j] of edges) {
    const a = verts[i], b = verts[j];
    if ((a.y > p.y) === (b.y > p.y)) continue;
    const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
    if (x <= p.x) continue;
    if (!best || x - p.x < best.t) best = { i, j, t: x - p.x };
  }
  if (!best) return null;
  let [u, w] = cross(sub(verts[best.j], verts[best.i]), sub(p, verts[best.i])) > 0 ? [best.i, best.j] : [best.j, best.i];
  const start: [number, number] = [u, w];
  const loop: number[] = [u];
  for (let guard = 0; guard < edges.length * 2 + 10; guard++) {
    // il prossimo spigolo è il primo in senso orario a partire da quello di ritorno
    const back = Math.atan2(verts[u].y - verts[w].y, verts[u].x - verts[w].x);
    let next = -1, bestRot = Infinity;
    for (const k of adj.get(w) ?? []) {
      if (k === u && (adj.get(w)?.size ?? 0) > 1) continue;
      const ang = Math.atan2(verts[k].y - verts[w].y, verts[k].x - verts[w].x);
      let rot = back - ang;
      while (rot <= 1e-12) rot += Math.PI * 2;
      while (rot > Math.PI * 2 + 1e-12) rot -= Math.PI * 2;
      if (rot < bestRot) { bestRot = rot; next = k; }
    }
    if (next < 0) return null;
    u = w; w = next;
    if (u === start[0] && w === start[1]) break;
    loop.push(u);
  }
  if (u !== start[0] || w !== start[1]) return null;
  let pts = loop.map(i => verts[i]);
  // via le "punte" (andata e ritorno lungo uno spigolo isolato) e i vertici allineati
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (dist(a, c) < 1e-9 || Math.abs(cross(sub(b, a), sub(c, b))) < 1e-9 * Math.max(1, dist(a, b) * dist(b, c))) {
        if (dist(a, c) < 1e-9) pts.splice(i, 1);
        pts.splice(i % pts.length, 1);
        changed = true;
        break;
      }
    }
  }
  if (pts.length < 3 || polygonArea(pts) <= 0 || !pointInPolygon(p, pts)) return null;
  return pts;
}

/** Contorno chiuso attorno a p. Cerca in un'area via via più grande. */
export function findRegion(ents: readonly Ent[], ctx: PrimCtx, p: Vec, startRadius: number, maxBox: Box | null): Vec[] | null {
  let r = startRadius;
  for (let iter = 0; iter < 8; iter++) {
    const area: Box = { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r };
    const segs = regionSegments(ents, ctx, area);
    if (segs.length > 6000) return null;
    const loop = traceFace(segs, p);
    if (loop) {
      const lb = loop.reduce((b, q) => boxAdd(b, q), emptyBox());
      if (boxInside(lb, area)) return loop;
    }
    if (maxBox && boxInside(maxBox, area)) return null;
    r *= 2;
  }
  return null;
}

export { v };
