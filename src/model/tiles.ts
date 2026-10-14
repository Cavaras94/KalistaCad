// Piastrelle: griglie di rettangoli che si ripetono (pose dritta, sfalsata, spina di pesce,
// diagonale) e computo di pavimenti e rivestimenti.
import type { Tiles, TileLay, RoomE, DoorE, WindowE } from './entities';
import { Vec, Box, v, sub, dot, dist, norm, perp, polygonArea } from './geom';

/**
 * Rettangoli che si ripetono su una griglia: base = rotazione di tutto il disegno; a e b = i due
 * passi della griglia; rects = i rettangoli di una cella, [x0, y0, x1, y1].
 */
export interface TileGrid { base: number; a: [number, number]; b: [number, number]; rects: [number, number, number, number][] }

/**
 * Griglia di una posa. Le celle comprendono la fuga (lato + fuga): i loro bordi sono le mezzerie
 * delle fughe, e la piastrella è la cella ristretta di mezza fuga per lato.
 */
export function tileGrid(t: Pick<Tiles, 'l' | 'w' | 'j' | 'lay'>): TileGrid {
  const L = Math.max(t.l, t.w) + t.j, W = Math.min(t.l, t.w) + t.j;
  return layGrid(t.lay, L, W);
}

export function layGrid(lay: TileLay, L: number, W: number): TileGrid {
  switch (lay) {
    case 'half': return { base: 0, a: [L, 0], b: [L / 2, W], rects: [[0, 0, L, W]] };
    case 'third': return { base: 0, a: [L, 0], b: [L / 3, W], rects: [[0, 0, L, W]] };
    case 'diag': return { base: Math.PI / 4, a: [L, 0], b: [0, W], rects: [[0, 0, L, W]] };
    // spina di pesce: un listello coricato e uno in piedi accanto alla sua testa; la coppia si ripete
    // un lato corto più in alto e più a destra (a), e la scala così fatta un lato lungo più in basso e
    // più a destra (b). Girata di 45°: le V della spina.
    case 'herring': return { base: Math.PI / 4, a: [W, W], b: [L, -L], rects: [[0, 0, L, W], [L, W - L, L + W, W]] };
    default: return { base: 0, a: [L, 0], b: [0, W], rects: [[0, 0, L, W]] };
  }
}

/**
 * Rettangoli della griglia che coprono il riquadro box, come quadrilateri nel disegno (angoli in
 * senso antiorario). origin = dove cade l'angolo della prima cella; shrink = di quanto restringere
 * ogni rettangolo per lato (mezza fuga, per avere la piastrella). null se sarebbero più di max celle.
 */
export function gridRects(g: TileGrid, box: Box, origin: Vec, max: number, shrink = 0): Vec[][] | null {
  const co = Math.cos(g.base), si = Math.sin(g.base);
  const W = (x: number, y: number): Vec => v(origin.x + x * co - y * si, origin.y + x * si + y * co);
  const det = g.a[0] * g.b[1] - g.a[1] * g.b[0];
  if (Math.abs(det) < 1e-12) return null;
  let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
  for (const w of [v(box.x0, box.y0), v(box.x1, box.y0), v(box.x1, box.y1), v(box.x0, box.y1)]) {
    const dx = w.x - origin.x, dy = w.y - origin.y;
    const x = dx * co + dy * si, y = -dx * si + dy * co;
    const p = (x * g.b[1] - y * g.b[0]) / det, q = (g.a[0] * y - g.a[1] * x) / det;
    p0 = Math.min(p0, p); p1 = Math.max(p1, p); q0 = Math.min(q0, q); q1 = Math.max(q1, q);
  }
  // un rettangolo sporge dall'origine della sua cella: qualche cella in più per lato
  let span = 0;
  for (const r of g.rects) for (const c of r) span = Math.max(span, Math.abs(c));
  const step = Math.min(Math.hypot(g.a[0], g.a[1]), Math.hypot(g.b[0], g.b[1]));
  const k = Math.ceil(span / step) + 1;
  p0 = Math.floor(p0) - k; p1 = Math.ceil(p1) + k; q0 = Math.floor(q0) - k; q1 = Math.ceil(q1) + k;
  if ((p1 - p0 + 1) * (q1 - q0 + 1) > max) return null;
  const out: Vec[][] = [];
  for (let p = p0; p <= p1; p++) {
    for (let q = q0; q <= q1; q++) {
      const ox = p * g.a[0] + q * g.b[0], oy = p * g.a[1] + q * g.b[1];
      for (const [x0, y0, x1, y1] of g.rects) {
        const a = x0 + shrink, b = y0 + shrink, c = x1 - shrink, d = y1 - shrink;
        const q4 = [W(ox + a, oy + b), W(ox + c, oy + b), W(ox + c, oy + d), W(ox + a, oy + d)];
        // solo quelli che toccano il riquadro
        if (q4.every(z => z.x < box.x0) || q4.every(z => z.x > box.x1) || q4.every(z => z.y < box.y0) || q4.every(z => z.y > box.y1)) continue;
        out.push(q4);
      }
    }
  }
  return out;
}

/** Riquadro e angolo da cui parte la posa di un locale: l'angolo in basso a sinistra del suo ingombro. */
export function roomBox(pts: Vec[]): Box {
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); }
  return b;
}

/** Sfrido consigliato per una posa: le pose in diagonale e a spina tagliano di più. */
export const SFRIDO: Record<TileLay, number> = { grid: 10, half: 10, third: 10, herring: 15, diag: 15 };

// ---------------------------------------------------------------- pareti del locale

/** Un vano (porta o finestra) su una parete: da t0 a t1 lungo la parete, da z0 a z1 in altezza. */
export interface WallHole { t0: number; t1: number; z0: number; z1: number }
/** Una parete di un locale: un suo lato (il filo interno del muro), lunga L, con i vani che ci cadono. */
export interface RoomSide { a: Vec; b: Vec; L: number; holes: WallHole[] }

export interface Heights { wallH: number; doorH: number; winSill: number; winH: number }

/** Quote di un vano: da terra o dal davanzale, fino in cima. */
export function openingSpan(o: DoorE | WindowE, hs: Heights): [number, number] {
  if (o.t === 'door') return [0, o.h ?? hs.doorH];
  const s = o.sill ?? hs.winSill;
  return [s, s + (o.h ?? hs.winH)];
}

/**
 * Pareti di un locale con i loro vani. Un vano sta su un lato se il suo centro (sull'asse del muro)
 * cade a mezzo spessore dal lato, parallelo e dentro la sua lunghezza. th = spessore del muro che
 * ospita ciascun vano (se non lo si sa, quello del vano).
 */
export function roomSides(room: RoomE, openings: (DoorE | WindowE)[], th: (o: DoorE | WindowE) => number, hs: Heights): RoomSide[] {
  const out: RoomSide[] = [];
  const n = room.pts.length;
  for (let i = 0; i < n; i++) {
    const a = room.pts[i], b = room.pts[(i + 1) % n];
    const L = dist(a, b);
    if (L < 1e-9) continue;
    const u = norm(sub(b, a)), nn = perp(u);
    const holes: WallHole[] = [];
    for (const o of openings) {
      const du = v(Math.cos(o.ang), Math.sin(o.ang));
      if (Math.abs(du.x * u.y - du.y * u.x) > 1e-3) continue;
      const t = dot(sub(o.p, a), u), d = Math.abs(dot(sub(o.p, a), nn));
      const h = th(o) / 2;
      if (Math.abs(d - h) > Math.max(1e-6, h * 0.05) || t < -1e-6 || t > L + 1e-6) continue;
      const [z0, z1] = openingSpan(o, hs);
      holes.push({ t0: Math.max(0, t - o.w / 2), t1: Math.min(L, t + o.w / 2), z0, z1 });
    }
    out.push({ a, b, L, holes });
  }
  return out;
}

// ---------------------------------------------------------------- computo

export interface Quantity {
  /** superficie in m² */
  m2: number;
  /** piastrelle da comprare, sfrido compreso */
  pcs: number;
  /** scatole, se si sa quanti m² ne contiene una */
  boxes?: number;
}

/** Piastrelle e scatole per una superficie (in unità del disegno al quadrato). */
export function quantity(area: number, t: Tiles, areaDiv: number, sfrido: number): Quantity {
  const m2 = area / areaDiv;
  const k = 1 + sfrido / 100;
  const one = t.l * t.w;
  // un soffio di tolleranza: 80,0000001 pezzi (per un arrotondamento delle coordinate) sono 80
  const pcs = one > 0 ? Math.ceil((area / one) * k - 1e-6) : 0;
  const q: Quantity = { m2, pcs };
  if (t.box && t.box > 0) q.boxes = Math.ceil((m2 * k) / t.box - 1e-6);
  return q;
}

/** Superficie da rivestire: le pareti del locale fino all'altezza del rivestimento, tolti i vani. */
export function claddingArea(sides: RoomSide[], hgt: number): number {
  let area = 0;
  for (const s of sides) {
    area += s.L * hgt;
    for (const h of s.holes) area -= Math.max(0, h.t1 - h.t0) * Math.max(0, Math.min(h.z1, hgt) - Math.max(h.z0, 0));
  }
  return Math.max(0, area);
}

export const roomFloorArea = (r: RoomE) => Math.abs(polygonArea(r.pts));

