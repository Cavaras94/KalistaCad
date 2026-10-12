// Snap ad oggetto, griglia, orto, puntamento polare; selezione per clic e per riquadro.
import type { Ent, SnapKind } from '../model/entities';
import { snapPoints, primCurves } from '../model/entities';
import type { Doc } from '../model/document';
import {
  Vec, Curve, Box, v, add, mul, dot, dist, sub, angleOf, dirOf, distToCurve, closestOnCurve, perpFoot, intersect,
  tessCurve, segHitsBox, boxInside, boxOverlap, pointInPolygon,
} from '../model/geom';
import { entPrims, entBoxCached } from './render';
import { textCorners, imageCorners } from '../model/entities';

export interface SnapSettings {
  osnap: boolean;
  modes: Set<SnapKind>;
  gridSnap: boolean;
  ortho: boolean;
  polar: boolean;
  polarInc: number; // gradi
  /** puntamento snap ad oggetto: allineamento orizzontale e verticale con i punti appena agganciati */
  otrack: boolean;
}

export interface SnapExtra {
  /** snap valido solo per il prossimo punto (digitato: FIN, MED…); 'none' = nessuno snap */
  only?: SnapKind | 'none';
  /** punti agganciati di recente, per il puntamento */
  acquired?: Vec[];
}

export interface SnapResult {
  p: Vec;
  k?: SnapKind;
  /** linea di puntamento polare/orto da disegnare */
  track?: { from: Vec; ang: number };
  /** punti con cui p è allineato in orizzontale o in verticale (puntamento snap ad oggetto) */
  align?: Vec[];
  /** era richiesto uno snap preciso (only) e lì vicino non ce n'è */
  miss?: boolean;
}

export const SNAP_LABEL: Record<SnapKind, string> = {
  end: 'Fine', mid: 'Medio', cen: 'Centro', quad: 'Quadrante', ins: 'Inserimento',
  int: 'Intersezione', perp: 'Perpendicolare', near: 'Vicino', grid: 'Griglia',
};

const PRIORITY: Record<SnapKind, number> = {
  end: 0, int: 0, cen: 0.1, mid: 0.1, quad: 0.15, ins: 0.1, perp: 0.5, near: 1, grid: 1,
};

function nearEnts(doc: Doc, p: Vec, tol: number): Ent[] {
  const ctx = doc.ctx();
  const q: Box = { x0: p.x - tol, y0: p.y - tol, x1: p.x + tol, y1: p.y + tol };
  return doc.ents.filter(e => doc.layer(e.layer).visible && boxOverlap(entBoxCached(e, ctx), q));
}

/** Allinea p ai punti acquisiti: in orizzontale con uno, in verticale con un altro (o lo stesso). */
function alignTo(p: Vec, acquired: Vec[], tol: number): { p: Vec; align: Vec[] } | null {
  let x: number | undefined, y: number | undefined;
  const align: Vec[] = [];
  for (const a of acquired) {
    if (dist(a, p) <= tol) continue;
    if (y === undefined && Math.abs(p.y - a.y) <= tol) { y = a.y; align.push(a); }
    else if (x === undefined && Math.abs(p.x - a.x) <= tol) { x = a.x; align.push(a); }
  }
  return align.length ? { p: v(x ?? p.x, y ?? p.y), align } : null;
}

/** Lungo una direzione di puntamento, il punto allineato in verticale o in orizzontale con un punto acquisito. */
function alignOnTrack(r: SnapResult, acquired: Vec[], tol: number): SnapResult {
  if (!r.track) return r;
  const d = dirOf(r.track.ang);
  for (const a of acquired) {
    for (const axis of ['x', 'y'] as const) {
      if (Math.abs(d[axis]) < 1e-6 || Math.abs(r.p[axis] - a[axis]) > tol) continue;
      const L = (a[axis] - r.track.from[axis]) / d[axis];
      const q = add(r.track.from, mul(d, L));
      if (dist(q, a) > tol) return { ...r, p: q, align: [a] };
    }
  }
  return r;
}

export function findSnap(doc: Doc, world: Vec, tol: number, st0: SnapSettings, base?: Vec, exclude?: Set<number>, extra: SnapExtra = {}): SnapResult {
  const only = extra.only;
  const st: SnapSettings = only === 'none' ? { ...st0, osnap: false } : only ? { ...st0, osnap: true, modes: new Set([only]) } : st0;
  const acquired = st.otrack && !only ? extra.acquired ?? [] : [];
  if (only && only !== 'none') return snapOnly(doc, world, tol, only, base, exclude) ?? { p: world, miss: true };
  const r = snapCore(doc, world, tol, st, base, exclude);
  if (r.k && r.k !== 'grid') return r;
  if (!acquired.length) return r;
  if (r.track) return alignOnTrack(r, acquired, tol);
  const al = alignTo(r.p, acquired, tol);
  return al ? { ...r, ...al } : r;
}

/**
 * Snap chiesto per nome (MED, CEN, PER…): basta avere il cursore su un'entità, in un punto qualsiasi.
 * Ne esce il punto di quel tipo, sull'entità sotto il cursore, più vicino al cursore.
 */
function snapOnly(doc: Doc, world: Vec, tol: number, only: SnapKind, base?: Vec, exclude?: Set<number>): SnapResult | null {
  const ctx = doc.ctx();
  const under = nearEnts(doc, world, tol).filter(e => !exclude?.has(e.id))
    .map(e => ({ e, curves: primCurves(entPrims(e, ctx)) }))
    .filter(x => x.curves.some(c => distToCurve(world, c) <= tol) || snapPoints(x.e, ctx).some(s => dist(s.p, world) <= tol));
  let best: Vec | null = null, bd = Infinity;
  const offer = (p: Vec) => { const d = dist(p, world); if (d < bd) { bd = d; best = p; } };
  if (only === 'near' || only === 'perp' || only === 'int') {
    const curves = under.flatMap(x => x.curves).slice(0, 400);
    if (only === 'near') for (const c of curves) { if (distToCurve(world, c) <= tol) offer(closestOnCurve(world, c)); }
    else if (only === 'perp') { if (base) for (const c of curves) { if (distToCurve(world, c) > tol) continue; const f = perpFoot(base, c); if (f) offer(f); } }
    else for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++) for (const p of intersect(curves[i], curves[j])) offer(p);
  } else for (const x of under) for (const s of snapPoints(x.e, ctx)) if (s.k === only) offer(s.p);
  return best ? { p: best, k: only } : null;
}

function snapCore(doc: Doc, world: Vec, tol: number, st: SnapSettings, base?: Vec, exclude?: Set<number>): SnapResult {
  if (st.osnap && st.modes.size) {
    const ctx = doc.ctx();
    const cands = nearEnts(doc, world, tol).filter(e => !exclude?.has(e.id));
    let best: { p: Vec; k: SnapKind; score: number } | null = null;
    const offer = (p: Vec, k: SnapKind) => {
      if (!st.modes.has(k)) return;
      const d = dist(p, world);
      if (d > tol) return;
      const score = d / tol + PRIORITY[k];
      if (!best || score < best.score) best = { p, k, score };
    };
    for (const e of cands) for (const sp of snapPoints(e, ctx)) offer(sp.p, sp.k);
    if (st.modes.has('int') || st.modes.has('perp') || st.modes.has('near')) {
      const curves: Curve[] = [];
      for (const e of cands) {
        for (const c of primCurves(entPrims(e, ctx))) {
          if (distToCurve(world, c) <= tol) curves.push(c);
          if (curves.length > 80) break;
        }
      }
      if (st.modes.has('int')) {
        for (let i = 0; i < curves.length; i++)
          for (let j = i + 1; j < curves.length; j++)
            for (const p of intersect(curves[i], curves[j])) offer(p, 'int');
      }
      if (base && st.modes.has('perp')) for (const c of curves) { const f = perpFoot(base, c); if (f) offer(f, 'perp'); }
      if (st.modes.has('near')) for (const c of curves) offer(closestOnCurve(world, c), 'near');
    }
    if (best) return { p: (best as { p: Vec }).p, k: (best as { k: SnapKind }).k };
  }

  let p = world;
  let k: SnapKind | undefined;
  if (st.gridSnap && doc.settings.snap > 0) {
    const g = doc.settings.snap;
    p = v(Math.round(p.x / g) * g, Math.round(p.y / g) * g);
    k = 'grid';
  }
  if (base) {
    if (st.ortho) {
      const d = sub(p, base);
      const horiz = Math.abs(d.x) >= Math.abs(d.y);
      p = horiz ? v(p.x, base.y) : v(base.x, p.y);
      return { p, k, track: { from: base, ang: horiz ? (d.x >= 0 ? 0 : Math.PI) : d.y >= 0 ? Math.PI / 2 : -Math.PI / 2 } };
    }
    if (st.polar && st.polarInc > 0) {
      const inc = (st.polarInc * Math.PI) / 180;
      const ang = angleOf(base, world);
      const kk = Math.round(ang / inc);
      const snapAng = kk * inc;
      const pixDist = dist(world, base);
      // aggancio entro ~4° oppure entro la tolleranza in distanza perpendicolare
      const off = Math.abs(Math.sin(ang - snapAng)) * pixDist;
      if (pixDist > tol && (Math.abs(ang - snapAng) < (4 * Math.PI) / 180 || off < tol * 0.6)) {
        const d = dirOf(snapAng);
        let L = dot(sub(world, base), d);
        if (st.gridSnap && doc.settings.snap > 0) L = Math.round(L / doc.settings.snap) * doc.settings.snap;
        return { p: add(base, mul(d, L)), k, track: { from: base, ang: snapAng } };
      }
    }
  }
  return { p, k };
}

// ---------------------------------------------------------------- selezione

function entCurves(doc: Doc, e: Ent): Curve[] {
  return primCurves(entPrims(e, doc.ctx()));
}

function hitsText(e: Ent, doc: Doc, p: Vec): boolean {
  for (const pr of entPrims(e, doc.ctx())) if (pr.k === 'text' && pointInPolygon(p, textCorners(pr))) return true;
  return false;
}

/** Entità più vicina al punto, entro la tolleranza. */
export function pickAt(doc: Doc, p: Vec, tol: number, filter?: (e: Ent) => boolean): Ent | null {
  let best: Ent | null = null;
  let bd = Infinity;
  for (const e of nearEnts(doc, p, tol)) {
    if (filter && !filter(e)) continue;
    let d = Infinity;
    for (const c of entCurves(doc, e)) d = Math.min(d, distToCurve(p, c));
    if (d > tol && (e.t === 'text' || e.t === 'room' || e.t === 'dim') && hitsText(e, doc, p)) d = tol * 0.9;
    if (d > tol) {
      // un'immagine si prende cliccandoci sopra, ma solo se lì non c'è altro di più preciso
      for (const pr of entPrims(e, doc.ctx())) if (pr.k === 'img' && pointInPolygon(p, imageCorners(pr))) d = tol * 0.98;
    }
    if (d > tol) {
      for (const pr of entPrims(e, doc.ctx())) {
        if (pr.k === 'pl' && pr.closed && pr.fill && pr.fill !== 'tint' && pointInPolygon(p, pr.pts)) { d = tol * 0.5; break; }
      }
    }
    if (d <= tol && d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Finestra (tutto dentro) o intersezione (anche solo toccata). */
export function pickBox(doc: Doc, box: Box, crossing: boolean): Ent[] {
  const ctx = doc.ctx();
  const out: Ent[] = [];
  for (const e of doc.ents) {
    if (!doc.layer(e.layer).visible) continue;
    const b = entBoxCached(e, ctx);
    if (boxInside(b, box)) { out.push(e); continue; }
    if (!crossing || !boxOverlap(b, box)) continue;
    let hit = false;
    for (const c of entCurves(doc, e)) {
      const pts = tessCurve(c);
      for (let i = 0; i + 1 < pts.length && !hit; i++) hit = segHitsBox(pts[i], pts[i + 1], box);
      if (hit) break;
    }
    if (!hit && e.t === 'hatch') hit = e.loops.some(l => pointInPolygon({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, l));
    if (hit) out.push(e);
  }
  return out;
}

