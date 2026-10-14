// Modello 3D ricavato dalla pianta: muri alzati con i vani di porte e finestre, pavimenti e
// rivestimenti dei locali, solidi dei blocchi e delle forme chiuse con una quota. Solo numeri:
// three.js entra in gioco dopo (scene.ts), così questo si prova senza browser.
import type { Ent, WallE, DoorE, WindowE, Tiles } from '../model/entities';
import { prims, polyPoints, ellipsePoints, isEllipseArc } from '../model/entities';
import type { Doc } from '../model/document';
import { UNIT_MM } from '../model/document';
import { buildWallCtx } from '../model/walls';
import { roomSides, type WallHole, type Heights } from '../model/tiles';
import { drawList } from '../view/render';
import { Vec, add, sub, mul, dot, dist, norm, perp, polygonArea, tessArc, TAU } from '../model/geom';

/** Un prisma: un poligono in pianta alzato da z0 a z1. */
export interface Prism { pts: Vec[]; z0: number; z1: number; kind: 'wall' | 'glass' | 'solid'; color?: string }
/** Pavimento di un locale. */
export interface Floor { pts: Vec[]; name: string; tiles?: Tiles }
/** Rivestimento di una parete di un locale: da a a b, alto hgt, con i vani; inward = verso l'interno del locale. */
export interface CladFace { a: Vec; b: Vec; L: number; hgt: number; inward: Vec; holes: WallHole[]; tiles: Tiles }

export interface Model {
  prisms: Prism[];
  floors: Floor[];
  clads: CladFace[];
  /** ingombro di tutto: in pianta e in altezza */
  box: { x0: number; y0: number; x1: number; y1: number; z1: number };
  /** unità del disegno in un metro */
  perM: number;
  heights: Heights;
}

/** Punti di una forma chiusa che nella vista 3D diventa un solido, o null. */
function solidOutline(e: Ent): Vec[] | null {
  if (e.t === 'poly' && e.closed && e.z) return polyPoints(e);
  if (e.t === 'circle' && e.z) return tessArc(e.c, e.r, 0, TAU).slice(0, -1);
  if (e.t === 'ellipse' && e.z && !isEllipseArc(e)) return ellipsePoints(e, 48);
  return null;
}

/** only = solo queste entità (per esempio la selezione); assente = tutto quello che si vede. */
export function buildModel(doc: Doc, only?: Set<number>): Model {
  const s = doc.settings;
  const hs: Heights = { wallH: s.wallH, doorH: s.doorH, winSill: s.winSill, winH: s.winH };
  const ctx0 = doc.ctx();
  // tutto quello che si vede, con i blocchi aperti; numeri provvisori unici per le giunzioni dei muri
  const flat = drawList(doc, ctx0, only).map((e, i) => ({ ...e, id: i + 1 }) as Ent);
  const wc = buildWallCtx(flat);
  const ctx = { ...ctx0, walls: wc };
  const prisms: Prism[] = [];
  const floors: Floor[] = [];
  const clads: CladFace[] = [];
  const openings = flat.filter((e): e is DoorE | WindowE => e.t === 'door' || e.t === 'window');

  for (const e of flat) {
    if (e.t === 'wall') {
      const H = e.h ?? hs.wallH;
      // i pezzi pieni sono quelli che si vedono in pianta, già giuntati agli angoli
      for (const p of prims(e, ctx)) {
        if (p.k === 'pl' && p.closed && (p.fill === 'wall' || p.fill === 'hit' || p.fill === 'solid')) prisms.push({ pts: p.pts, z0: 0, z1: H, kind: 'wall' });
      }
      prisms.push(...openingPieces(e, H, openings.filter(o => wc.hosts.get(o.id) === e.id), hs));
    } else if (e.t === 'room' && e.pts.length >= 3) {
      floors.push({ pts: e.pts, name: e.name, tiles: e.floor });
      if (e.clad && e.clad.hgt > 0) {
        const ccw = polygonArea(e.pts) > 0;
        const th = (o: DoorE | WindowE) => wc.openTh.get(o.id) ?? o.th;
        for (const side of roomSides(e, openings, th, hs)) {
          const u = norm(sub(side.b, side.a));
          clads.push({ ...side, hgt: e.clad.hgt, inward: ccw ? perp(u) : mul(perp(u), -1), tiles: e.clad });
        }
      }
    } else {
      const pts = solidOutline(e);
      const z = (e as { z?: [number, number] }).z;
      if (pts && z && z[1] > z[0]) prisms.push({ pts, z0: z[0], z1: z[1], kind: 'solid', color: e.color });
    }
  }

  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, z1: 0 };
  const grow = (p: Vec) => { box.x0 = Math.min(box.x0, p.x); box.y0 = Math.min(box.y0, p.y); box.x1 = Math.max(box.x1, p.x); box.y1 = Math.max(box.y1, p.y); };
  for (const p of prisms) { p.pts.forEach(grow); box.z1 = Math.max(box.z1, p.z1); }
  for (const f of floors) f.pts.forEach(grow);
  if (!Number.isFinite(box.x0)) Object.assign(box, { x0: 0, y0: 0, x1: 1, y1: 1 });
  if (box.z1 <= 0) box.z1 = hs.wallH;
  return { prisms, floors, clads, box, perM: 1000 / UNIT_MM[s.units], heights: hs };
}

/** Sopra le porte l'architrave; sotto e sopra le finestre il muro, e in mezzo il vetro. */
function openingPieces(w: WallE, H: number, os: (DoorE | WindowE)[], hs: Heights): Prism[] {
  const L = dist(w.a, w.b);
  const u = norm(sub(w.b, w.a)), n = perp(u), h = w.th / 2;
  const at = (t: number, side: number) => add(add(w.a, mul(u, t)), mul(n, side * h));
  const out: Prism[] = [];
  for (const o of os) {
    const t = dot(sub(o.p, w.a), u);
    const t0 = Math.max(0, t - o.w / 2), t1 = Math.min(L, t + o.w / 2);
    if (t1 - t0 < 1e-9) continue;
    const quad = [at(t0, 1), at(t1, 1), at(t1, -1), at(t0, -1)];
    if (o.t === 'door') {
      const top = Math.min(o.h ?? hs.doorH, H);
      if (H > top) out.push({ pts: quad, z0: top, z1: H, kind: 'wall' });
    } else {
      const s0 = Math.min(o.sill ?? hs.winSill, H), s1 = Math.min(s0 + (o.h ?? hs.winH), H);
      if (s0 > 0) out.push({ pts: quad, z0: 0, z1: s0, kind: 'wall' });
      if (H > s1) out.push({ pts: quad, z0: s1, z1: H, kind: 'wall' });
      // il vetro: una lastra sottile in mezzo allo spessore
      const g = Math.max(h * 0.08, 1e-6);
      const glass = [add(at(t0, 0), mul(n, g)), add(at(t1, 0), mul(n, g)), sub(at(t1, 0), mul(n, g)), sub(at(t0, 0), mul(n, g))];
      if (s1 > s0) out.push({ pts: glass, z0: s0, z1: s1, kind: 'glass' });
    }
  }
  return out;
}

