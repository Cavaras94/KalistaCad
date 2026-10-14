// Entità del disegno, primitive di rappresentazione, snap, grip, trasformazioni.
import {
  Vec, Curve, Mat, Box, TAU, v, add, sub, mul, dot, cross, len, dist, perp, mid, norm, angleOf, polar, dirOf,
  sweep, normAng, bulgeArc, tessArc, seg, arcC, arcStart, arcEnd, arcMid, polygonArea, centroid, clipLineToLoops,
  emptyBox, boxAdd, apply, applyDir, det, matScale, mapAngle, lineLine, compose, translate, rotateAbout, scaleAbout,
} from './geom';
import type { WallCtx, WallInfo } from './walls';
import type { LineType } from './document';
import { wallPrims, buildWallCtx } from './walls';

export type HAlign = 'l' | 'c' | 'r';
export type VAlign = 'b' | 'm' | 't';
export type HatchPattern = 'solid' | 'ansi31' | 'ansi32' | 'ansi37' | 'lines' | 'grid' | 'brick' | 'plank' | 'herring' | 'dash' | 'dots' | 'zigzag' | 'concrete';
export const HATCH_NAMES: Record<HatchPattern, string> = {
  solid: 'Pieno', ansi31: 'Linee a 45°', ansi32: 'Doppie linee a 45° (muratura)', ansi37: 'Incrociato a 45°', lines: 'Linee',
  grid: 'Quadretti (piastrelle)', brick: 'Mattoni', plank: 'Listoni sfalsati', herring: 'Spina di pesce',
  dash: 'Linee tratteggiate', dots: 'Puntinato', zigzag: 'Zig-zag (isolante)', concrete: 'Calcestruzzo',
};

/** lt e lw: tipo di linea e spessore di stampa propri dell'entità; assenti = quelli del layer. */
interface Base { id: number; layer: string; color?: string; g?: number; lt?: LineType; lw?: number }
export interface LineE extends Base { t: 'line'; a: Vec; b: Vec }
export interface PolyE extends Base { t: 'poly'; pts: Vec[]; bulges?: number[]; closed: boolean }
export interface CircleE extends Base { t: 'circle'; c: Vec; r: number }
export interface ArcE extends Base { t: 'arc'; c: Vec; r: number; a0: number; a1: number }
export interface TextE extends Base { t: 'text'; p: Vec; s: string; h: number; rot: number; ha: HAlign; va: VAlign }
/**
 * Quota. Senza k è lineare fra a e b, con la linea di quota per p: ang assente = allineata ai due
 * punti, altrimenti ruotata (0 orizzontale, π/2 verticale).
 * k 'rad'/'dia': a = centro, b = punto sulla curva, p = posizione del testo.
 * k 'ang': a = vertice, b e c = punti sui due lati, p = punto per cui passa l'arco di quota.
 * h = altezza del testo di questa quota; assente = quella delle impostazioni del disegno.
 */
export type DimKind = 'rad' | 'dia' | 'ang';
export interface DimE extends Base { t: 'dim'; a: Vec; b: Vec; p: Vec; ang?: number; s?: string; k?: DimKind; c?: Vec; h?: number }
/** Muro. pat = retino al posto del riempimento (assente = riempimento normale); sp = passo del retino (assente = un terzo dello spessore). */
export interface WallE extends Base { t: 'wall'; a: Vec; b: Vec; th: number; pat?: HatchPattern; sp?: number }
export interface DoorE extends Base { t: 'door'; p: Vec; ang: number; w: number; th: number; sw: 1 | -1; hg: 1 | -1 }
export interface WindowE extends Base { t: 'window'; p: Vec; ang: number; w: number; th: number }
export interface RoomE extends Base { t: 'room'; pts: Vec[]; name: string }
export interface HatchE extends Base { t: 'hatch'; loops: Vec[][]; pat: HatchPattern; sp: number; ang: number }
/**
 * Ellisse: a = un semiasse (vettore dal centro), k = rapporto fra l'altro semiasse e questo.
 * Con a0 e a1 è un arco di ellisse, in senso antiorario da a0 ad a1 (angoli del parametro, non al centro).
 */
export interface EllipseE extends Base { t: 'ellipse'; c: Vec; a: Vec; k: number; a0?: number; a1?: number }
/** Immagine (JPG, PNG): p = angolo in basso a sinistra, w e h nelle unità del disegno, src = i dati dell'immagine. */
export interface ImageE extends Base { t: 'image'; p: Vec; w: number; h: number; rot: number; src: string }
/** Punto: un segno a crocetta, utile come riferimento per gli snap (DIVIDI e MISURA ne mettono). */
export interface PointE extends Base { t: 'point'; p: Vec }
/** Direttrice: spezzata con la freccia sul primo punto e un testo in fondo. h assente = altezza delle quote. */
export interface LeaderE extends Base { t: 'leader'; pts: Vec[]; s: string; h?: number }
/** Curva morbida passante per i punti pts. */
export interface SplineE extends Base { t: 'spline'; pts: Vec[]; closed: boolean }
/**
 * Blocco inserito nel punto p: s = scala, rot = rotazione, flip = specchiato lungo l'asse X del
 * blocco (prima della rotazione). Il contenuto sta nella definizione del blocco, per nome.
 */
export interface InsertE extends Base { t: 'insert'; name: string; p: Vec; s: number; rot: number; flip?: boolean }

/** Definizione di un blocco: entità in coordinate relative al punto base (che è l'origine). */
export interface BlockDef { ents: Ent[] }
export type Blocks = Record<string, BlockDef>;

export type Ent = LineE | PolyE | CircleE | ArcE | TextE | DimE | WallE | DoorE | WindowE | RoomE | HatchE | EllipseE | SplineE | InsertE | PointE | LeaderE | ImageE;
export type EntType = Ent['t'];
/** Entità ancora senza id (create da un comando, prima di entrare nel documento). */
export type NewEnt = Ent extends infer E ? (E extends Ent ? Omit<E, 'id'> & { id?: number } : never) : never;

export const TYPE_NAMES: Record<EntType, string> = {
  line: 'Linea', poly: 'Polilinea', circle: 'Cerchio', arc: 'Arco', text: 'Testo', dim: 'Quota',
  wall: 'Muro', door: 'Porta', window: 'Finestra', room: 'Locale', hatch: 'Tratteggio',
  ellipse: 'Ellisse', spline: 'Spline', insert: 'Blocco', point: 'Punto', leader: 'Direttrice', image: 'Immagine',
};

// ---------------------------------------------------------------- primitive

/** hit = non si vede: serve solo a prendere l'entità cliccandoci dentro. */
export type Fill = 'wall' | 'solid' | 'tint' | 'hit';
/** deco = tratto di sola decorazione (le righe del retino di un muro): si disegna, ma non fa da bordo né da snap. */
export type Prim =
  | { k: 'pl'; pts: Vec[]; closed?: boolean; fill?: Fill; stroke?: boolean; deco?: boolean }
  | { k: 'arc'; c: Vec; r: number; a0: number; a1: number; full?: boolean }
  | { k: 'text'; p: Vec; s: string; h: number; rot: number; ha: HAlign; va: VAlign }
  | { k: 'area'; loops: Vec[][]; fill: Fill }
  | { k: 'img'; p: Vec; w: number; h: number; rot: number; src: string };

export interface PrimCtx {
  dimH: number;
  dimDec: number;
  /** unità² per m² */
  areaDiv: number;
  walls?: WallCtx;
  /** definizioni dei blocchi, per disegnare gli inserimenti */
  blocks?: Blocks;
  /** quote lineari con le frecce invece dei tratti obliqui */
  dimArrow?: boolean;
}

export const DEFAULT_CTX: PrimCtx = { dimH: 15, dimDec: 0, areaDiv: 10000 };

export function fmtNum(x: number, dec: number): string {
  return x.toFixed(Math.min(8, Math.max(0, Math.round(dec) || 0))).replace('.', ',');
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

/**
 * Cambia la scritta di un testo tenendo ferma la prima riga: aggiungendo righe il testo cresce
 * verso il basso, qualunque sia il suo allineamento verticale.
 */
export function retext<T extends { p: Vec; s: string; h: number; rot: number; va: VAlign }>(e: T, s: string): T {
  const dy = textLines(e)[0].y - textLines({ ...e, s })[0].y;
  return { ...e, s, p: v(e.p.x - Math.sin(e.rot) * dy, e.p.y + Math.cos(e.rot) * dy) };
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
  if (e.k) return null;
  const u = e.ang !== undefined ? dirOf(e.ang) : norm(sub(e.b, e.a));
  if (len(u) < 0.5) return null;
  const a2 = add(e.p, mul(u, dot(sub(e.a, e.p), u)));
  const b2 = add(e.p, mul(u, dot(sub(e.b, e.p), u)));
  return { u, a2, b2, value: Math.abs(dot(sub(e.b, e.a), u)) };
}

/** Settore di una quota angolare: da a0 in senso antiorario per sw, sul raggio r. È quello che contiene p. */
export function dimAngGeometry(e: DimE): { a0: number; sw: number; r: number; from: Vec; to: Vec } | null {
  if (e.k !== 'ang' || !e.c) return null;
  const r = dist(e.a, e.p);
  if (r < 1e-9 || dist(e.a, e.b) < 1e-9 || dist(e.a, e.c) < 1e-9) return null;
  const ab = angleOf(e.a, e.b), ac = angleOf(e.a, e.c);
  const sw = sweep(ab, ac);
  if (sw > TAU - 1e-9) return null;
  if (normAng(angleOf(e.a, e.p) - ab) <= sw) return { a0: ab, sw, r, from: e.b, to: e.c };
  return { a0: ac, sw: TAU - sw, r, from: e.c, to: e.b };
}

/** Misura di una quota: lunghezza, raggio, diametro oppure angolo in gradi. */
export function dimValue(e: DimE): number | null {
  if (e.k === 'rad') return dist(e.a, e.b);
  if (e.k === 'dia') return 2 * dist(e.a, e.b);
  if (e.k === 'ang') { const g = dimAngGeometry(e); return g ? (g.sw * 180) / Math.PI : null; }
  return dimGeometry(e)?.value ?? null;
}

export function dimText(e: DimE, ctx: PrimCtx): string {
  if (e.s) return e.s;
  const x = dimValue(e);
  if (x === null) return '';
  if (e.k === 'ang') return `${(Math.round(x * 10) / 10).toString().replace('.', ',')}°`;
  return (e.k === 'rad' ? 'R' : e.k === 'dia' ? 'Ø' : '') + fmtNum(x, ctx.dimDec);
}

/** Rotazione leggibile (testo mai capovolto) per una direzione. */
export function readableAngle(ang: number): number {
  let r = normAng(ang);
  if (r > Math.PI / 2 + 1e-9 && r <= (3 * Math.PI) / 2 + 1e-9) r -= Math.PI;
  return r;
}

/** Freccia piena con la punta in tip, rivolta verso dir. */
function arrowPrim(tip: Vec, dir: Vec, H: number): Prim {
  const back = sub(tip, mul(dir, H * 0.8)), n = mul(perp(dir), H * 0.14);
  return { k: 'pl', pts: [tip, add(back, n), sub(back, n)], closed: true, fill: 'solid' };
}

function radialDimPrims(e: DimE, ctx: PrimCtx): Prim[] {
  const r = dist(e.a, e.b);
  if (r < 1e-9) return [];
  const H = e.h ?? ctx.dimH;
  const d = sub(e.p, e.a), dp = len(d);
  const u = dp < 1e-9 ? norm(sub(e.b, e.a)) : mul(d, 1 / dp);
  const on = add(e.a, mul(u, r));
  const s = dimText(e, ctx);
  const start = e.k === 'dia' ? sub(e.a, mul(u, r)) : e.a;
  const end = dp > r ? add(e.p, mul(u, (s.length * H * CHAR_W) / 2)) : on;
  const out: Prim[] = [{ k: 'pl', pts: [start, end] }, arrowPrim(on, u, H)];
  if (e.k === 'dia') out.push(arrowPrim(start, mul(u, -1), H));
  const rot = readableAngle(Math.atan2(u.y, u.x));
  out.push({ k: 'text', p: add(e.p, mul(perp(dirOf(rot)), H * 0.3)), s, h: H, rot, ha: 'c', va: 'b' });
  return out;
}

function angularDimPrims(e: DimE, ctx: PrimCtx): Prim[] {
  const g = dimAngGeometry(e);
  if (!g) return [];
  const H = e.h ?? ctx.dimH;
  const gap = H * 0.4, ext = H * 0.5;
  const a1 = g.a0 + g.sw;
  const out: Prim[] = [{ k: 'arc', c: e.a, r: g.r, a0: g.a0, a1: normAng(a1) }];
  // linee di estensione, solo dove l'arco cade oltre la fine del lato
  for (const [ang, q] of [[g.a0, g.from], [a1, g.to]] as const) {
    const L = dist(e.a, q);
    if (g.r > L + gap) out.push({ k: 'pl', pts: [polar(e.a, L + gap, ang), polar(e.a, g.r + ext, ang)] });
  }
  out.push(arrowPrim(polar(e.a, g.r, g.a0), mul(perp(dirOf(g.a0)), -1), H));
  out.push(arrowPrim(polar(e.a, g.r, a1), perp(dirOf(a1)), H));
  const am = g.a0 + g.sw / 2;
  const rot = readableAngle(am - Math.PI / 2);
  const outward = dot(perp(dirOf(rot)), dirOf(am)) >= 0;
  out.push({ k: 'text', p: polar(e.a, g.r + H * 0.3, am), s: dimText(e, ctx), h: H, rot, ha: 'c', va: outward ? 'b' : 't' });
  return out;
}

function dimPrims(e: DimE, ctx: PrimCtx): Prim[] {
  if (e.k === 'ang') return angularDimPrims(e, ctx);
  if (e.k) return radialDimPrims(e, ctx);
  const g = dimGeometry(e);
  if (!g) return [];
  const H = e.h ?? ctx.dimH;
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
  if (ctx.dimArrow && dist(g.a2, g.b2) > 1e-9) {
    // stile a frecce: la linea di quota finisce sulle linee di estensione, con le punte rivolte verso l'esterno
    const w = norm(sub(g.a2, g.b2));
    if (dist(g.a2, g.b2) < H * 2.4) {
      // quota corta: le frecce non ci stanno dentro, si mettono fuori con le punte rivolte all'interno
      out.push({ k: 'pl', pts: [add(g.a2, mul(w, H * 1.6)), sub(g.b2, mul(w, H * 1.6))] });
      out.push(arrowPrim(g.a2, mul(w, -1), H), arrowPrim(g.b2, w, H));
    } else {
      out.push({ k: 'pl', pts: [g.a2, g.b2] });
      out.push(arrowPrim(g.a2, w, H), arrowPrim(g.b2, mul(w, -1), H));
    }
  } else {
    const lo = add(e.p, mul(g.u, Math.min(ta, tb) - ext));
    const hi = add(e.p, mul(g.u, Math.max(ta, tb) + ext));
    out.push({ k: 'pl', pts: [lo, hi] });
    const tick = mul(dirOf(Math.atan2(g.u.y, g.u.x) + Math.PI / 4), H * 0.45);
    for (const q of [g.a2, g.b2]) out.push({ k: 'pl', pts: [sub(q, tick), add(q, tick)] });
  }
  const rot = readableAngle(Math.atan2(g.u.y, g.u.x));
  const up = perp(dirOf(rot));
  const s = e.s ?? fmtNum(g.value, ctx.dimDec);
  // se fra le linee di estensione il testo non ci sta, va di fianco, oltre la seconda
  const tw = s.length * H * CHAR_W, span = dist(g.a2, g.b2);
  const along = span > 1e-9 ? norm(sub(g.b2, g.a2)) : g.u;
  const at = tw > span - H * 0.3 ? add(g.b2, mul(along, tw / 2 + H * 0.9)) : mid(g.a2, g.b2);
  out.push({ k: 'text', p: add(at, mul(up, H * 0.3)), s, h: H, rot, ha: 'c', va: 'b' });
  return out;
}

/**
 * Giunzioni dei muri e aperture per il contenuto dei blocchi inseriti. Le entità di un blocco aperto
 * hanno tutte l'id dell'inserimento, quindi non possono stare nel contesto dei muri del disegno
 * (che va per id): il risultato si tiene qui, legato all'oggetto.
 */
const blockWalls = new WeakMap<Ent, { wall?: WallInfo; th?: number }>();

/** Spessore del muro che ospita l'apertura, se ce n'è uno. */
function hostTh(e: DoorE | WindowE, ctx: PrimCtx): number | undefined {
  return blockWalls.get(e)?.th ?? ctx.walls?.openTh.get(e.id);
}

/**
 * Contenuto di un blocco inserito pronto da disegnare: i suoi muri si giuntano fra loro e le sue
 * porte e finestre li aprono, come quando erano entità sciolte.
 */
export function insertParts(e: InsertE, blocks: Blocks | undefined): Ent[] {
  const kids = expandInsert(e, blocks);
  if (!kids.some(k => k.t === 'wall')) return kids;
  // numeri provvisori al posto dell'id comune, solo per calcolare le giunzioni
  const wc = buildWallCtx(kids.map((k, i) => ({ ...k, id: i + 1 })));
  kids.forEach((k, i) => {
    if (k.t === 'wall') blockWalls.set(k, { wall: wc.walls.get(i + 1) });
    else if ((k.t === 'door' || k.t === 'window') && wc.openTh.has(i + 1)) blockWalls.set(k, { th: wc.openTh.get(i + 1) });
  });
  return kids;
}

function doorPrims(e: DoorE, ctx: PrimCtx): Prim[] {
  const host = hostTh(e, ctx);
  const th = host ?? e.th;
  const u = dirOf(e.ang), n = perp(u);
  const hinge = add(add(e.p, mul(u, (e.hg * e.w) / 2)), mul(n, (e.sw * th) / 2));
  const leafDir = mul(n, e.sw);
  const tip = add(hinge, mul(leafDir, e.w));
  const aLeaf = Math.atan2(leafDir.y, leafDir.x);
  const closedDir = mul(u, -e.hg);
  const aClosed = Math.atan2(closedDir.y, closedDir.x);
  const [a0, a1] = Math.abs(normAng(aClosed - aLeaf) - Math.PI / 2) < 1e-6 ? [aLeaf, aClosed] : [aClosed, aLeaf];
  const out: Prim[] = [{ k: 'pl', pts: [hinge, tip] }, { k: 'arc', c: hinge, r: e.w, a0, a1 }];
  if (host === undefined) out.push(...openingJambs(e.p, u, n, e.w, th));
  return out;
}

function openingJambs(p: Vec, u: Vec, n: Vec, w: number, th: number): Prim[] {
  return [-1, 1].map(s => {
    const q = add(p, mul(u, (s * w) / 2));
    return { k: 'pl', pts: [add(q, mul(n, th / 2)), sub(q, mul(n, th / 2))] } as Prim;
  });
}

function windowPrims(e: WindowE, ctx: PrimCtx): Prim[] {
  const host = hostTh(e, ctx);
  const th = host ?? e.th;
  const u = dirOf(e.ang), n = perp(u);
  const a = sub(e.p, mul(u, e.w / 2)), b = add(e.p, mul(u, e.w / 2));
  const out: Prim[] = [];
  for (const off of [th / 2, th / 6, -th / 6, -th / 2]) out.push({ k: 'pl', pts: [add(a, mul(n, off)), add(b, mul(n, off))] });
  if (host === undefined) out.push(...openingJambs(e.p, u, n, e.w, th));
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

/**
 * Una famiglia di righe parallele di un retino, in multipli del passo:
 * ang = inclinazione; o = punto per cui passa la prima riga e da cui parte il suo tratteggio (assente
 * = l'origine); dy = distanza fra le righe (assente = 1); dx = di quanto scorre il tratteggio da una
 * riga alla successiva; dash = [tratto, vuoto] (assente = riga continua).
 */
const MAX_HATCH_DASHES = 60000;
interface HatchFam { ang: number; o?: [number, number]; dy?: number; dx?: number; dash?: [number, number] }
const Q = Math.PI / 4, R2 = Math.SQRT2;
const HATCH_FAMS: Record<Exclude<HatchPattern, 'solid' | 'herring'>, HatchFam[]> = {
  ansi31: [{ ang: Q }],
  // coppie di righe: la seconda a un terzo del passo dalla prima
  ansi32: [{ ang: Q }, { ang: Q, o: [R2 / 3, 0] }],
  ansi37: [{ ang: Q }, { ang: -Q }],
  lines: [{ ang: 0 }],
  grid: [{ ang: 0 }, { ang: Math.PI / 2 }],
  // corsi orizzontali, e giunti verticali alterni: mattoni lunghi due passi e alti uno
  brick: [{ ang: 0 }, { ang: Math.PI / 2, dash: [1, 1], dx: 1 }],
  // listoni lunghi sei passi e alti uno, sfalsati di un terzo da un corso all'altro
  plank: [{ ang: 0 }, { ang: Math.PI / 2, dy: 2, dash: [1, 2], dx: 1 }],
  dash: [{ ang: Q, dash: [1.5, 0.75] }],
  dots: [{ ang: 0, dash: [0.12, 0.88], dx: 0.5 }],
  // file di denti alti un passo, con un passo vuoto fra una fila e l'altra
  zigzag: [{ ang: Q, dy: R2, dash: [R2, R2], dx: R2 }, { ang: -Q, o: [1, -1], dy: R2, dash: [R2, R2], dx: R2 }],
  // puntini e trattini corti sparsi, con passi che non vanno a tempo fra loro
  concrete: [{ ang: 0, dash: [0.08, 1.12], dx: 0.37 }, { ang: 1, dy: 1.3, dash: [0.3, 2.3], dx: 0.71 }, { ang: -0.7, dy: 1.7, dash: [0.25, 2.9], dx: 1.13 }],
};

/**
 * Retino fatto di piastrelle rettangolari che si ripetono su una griglia: base = rotazione del
 * disegno del retino; a e b = i due passi della griglia; rects = le piastrelle di una cella
 * ([x0, y0, x1, y1]). Tutto in multipli del passo del retino.
 */
export interface HatchTiles { base: number; a: [number, number]; b: [number, number]; rects: [number, number, number, number][] }
export const HATCH_TILES: Partial<Record<HatchPattern, HatchTiles>> = {
  // Spina di pesce: listelli lunghi quattro e larghi uno, uno coricato e uno in piedi accanto alla
  // sua testa; la coppia si ripete un passo più in alto e più a destra (a), e la scala così fatta
  // si ripete spostata di quattro in basso e quattro a destra (b). Girata di 45°: le V della spina.
  herring: { base: Q, a: [1, 1], b: [4, -4], rects: [[0, 0, 4, 1], [4, -3, 5, 1]] },
};
const MAX_TILE_CELLS = 8000;

function tilePrims(e: Pick<HatchE, 'sp' | 'ang'>, loops: Vec[][], t: HatchTiles): Prim[] {
  const rot = e.ang + t.base, co = Math.cos(rot), si = Math.sin(rot);
  let sp = Math.max(e.sp, 1e-9);
  // dal sistema del retino al disegno e ritorno
  const W = (x: number, y: number): Vec => v((x * co - y * si) * sp, (x * si + y * co) * sp);
  const pts = loops.flat();
  const det = t.a[0] * t.b[1] - t.a[1] * t.b[0];
  // celle della griglia che toccano l'area: si passa alle coordinate della griglia
  const cellRange = () => {
    let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
    for (const w of pts) {
      const x = (w.x * co + w.y * si) / sp, y = (-w.x * si + w.y * co) / sp;
      const p = (x * t.b[1] - y * t.b[0]) / det, q = (t.a[0] * y - t.a[1] * x) / det;
      p0 = Math.min(p0, p); p1 = Math.max(p1, p); q0 = Math.min(q0, q); q1 = Math.max(q1, q);
    }
    // una cella sporge dalla sua origine: qualche cella in più per lato
    return { p0: Math.floor(p0) - 6, p1: Math.ceil(p1) + 6, q0: Math.floor(q0) - 2, q1: Math.ceil(q1) + 2 };
  };
  let r = cellRange();
  // un'area enorme rispetto al passo: piastrelle più grandi, come per le righe dei retini
  while ((r.p1 - r.p0 + 1) * (r.q1 - r.q0 + 1) > MAX_TILE_CELLS) { sp *= 2; r = cellRange(); }
  const out: Prim[] = [];
  const seen = new Set<string>();
  const key = (a: Vec, b: Vec) => [a, b].map(q => `${Math.round(q.x * 1e6)},${Math.round(q.y * 1e6)}`).sort().join('|');
  for (let p = r.p0; p <= r.p1; p++) {
    for (let q = r.q0; q <= r.q1; q++) {
      const ox = p * t.a[0] + q * t.b[0], oy = p * t.a[1] + q * t.b[1];
      for (const [x0, y0, x1, y1] of t.rects) {
        const c = [W(ox + x0, oy + y0), W(ox + x1, oy + y0), W(ox + x1, oy + y1), W(ox + x0, oy + y1)];
        for (let i = 0; i < 4; i++) {
          const a = c[i], b = c[(i + 1) % 4];
          const k = key(a, b);
          if (seen.has(k)) continue;
          seen.add(k);
          // il lato della piastrella, solo per la parte dentro il contorno
          const L = dist(a, b), d = mul(sub(b, a), 1 / L);
          for (const [s0, s1] of clipLineToLoops(a, d, loops)) {
            const t0 = Math.max(0, dot(sub(s0, a), d)), t1 = Math.min(L, dot(sub(s1, a), d));
            if (t1 - t0 > 1e-9) out.push({ k: 'pl', pts: [add(a, mul(d, t0)), add(a, mul(d, t1))] });
          }
        }
      }
    }
  }
  return out;
}

function hatchPrims(e: Pick<HatchE, 'loops' | 'pat' | 'sp' | 'ang'>): Prim[] {
  const loops = e.loops.filter(l => l.length >= 3);
  if (!loops.length) return [];
  if (e.pat === 'solid') return [{ k: 'area', loops, fill: 'solid' }];
  const tiles = HATCH_TILES[e.pat];
  if (tiles) return tilePrims(e, loops, tiles);
  const out: Prim[] = [];
  const pts = loops.flat();
  for (const fam of HATCH_FAMS[e.pat as keyof typeof HATCH_FAMS] ?? HATCH_FAMS.ansi31) {
    const d = dirOf(e.ang + fam.ang), n = perp(d);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
      const s = dot(p, n);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    const fd = dirOf(fam.ang), fo = v(fam.o?.[0] ?? 0, fam.o?.[1] ?? 0);
    const s0 = dot(fo, perp(fd)), ph = dot(fo, fd), dy = fam.dy ?? 1;
    let sp = Math.max(e.sp, 1e-9);
    if ((hi - lo) / (sp * dy) > MAX_HATCH_LINES) sp = (hi - lo) / (MAX_HATCH_LINES * dy);
    // un retino a tratti troppo fitto per l'area (centinaia di migliaia di trattini) si disegna a righe continue
    let dashed = !!fam.dash;
    if (fam.dash) {
      let tlo = Infinity, thi = -Infinity;
      for (const p of pts) { const t = dot(p, d); if (t < tlo) tlo = t; if (t > thi) thi = t; }
      if (((hi - lo) / (sp * dy)) * ((thi - tlo) / ((fam.dash[0] + fam.dash[1]) * sp)) > MAX_HATCH_DASHES) dashed = false;
    }
    for (let i = Math.ceil((lo / sp - s0) / dy - 1e-9); (s0 + i * dy) * sp <= hi; i++) {
      const o = mul(n, (s0 + i * dy) * sp);
      for (const [p, q] of clipLineToLoops(o, d, loops)) {
        if (!fam.dash || !dashed) { out.push({ k: 'pl', pts: [p, q] }); continue; }
        // riga tratteggiata: i tratti sono ancorati all'origine del disegno, sfalsati di riga in riga
        const on = fam.dash[0] * sp, period = (fam.dash[0] + fam.dash[1]) * sp;
        const shift = (ph + i * (fam.dx ?? 0)) * sp;
        const t0 = dot(p, d), t1 = dot(q, d);
        if ((t1 - t0) / period > MAX_HATCH_LINES) { out.push({ k: 'pl', pts: [p, q] }); continue; }
        for (let k = Math.floor((t0 - shift) / period); shift + k * period < t1; k++) {
          const a = Math.max(t0, shift + k * period), b = Math.min(t1, shift + k * period + on);
          if (b - a > 1e-9) out.push({ k: 'pl', pts: [add(o, mul(d, a)), add(o, mul(d, b))] });
        }
      }
    }
  }
  return out;
}

/** Muro con un retino: al posto del riempimento normale, le righe del retino dentro ogni suo pezzo. */
function wallFill(e: WallE, ps: Prim[]): Prim[] {
  if (!e.pat) return ps;
  const out: Prim[] = [];
  for (const p of ps) {
    if (p.k !== 'pl' || p.fill !== 'wall') { out.push(p); continue; }
    if (e.pat === 'solid') { out.push({ ...p, fill: 'solid' }); continue; }
    out.push({ ...p, fill: 'hit' });
    for (const h of hatchPrims({ loops: [p.pts], pat: e.pat, sp: e.sp ?? e.th / 3, ang: 0 })) out.push(h.k === 'pl' ? { ...h, deco: true } : h);
  }
  return out;
}

/** Angoli di un'immagine, dal punto di inserimento in senso antiorario. */
export function imageCorners(e: { p: Vec; w: number; h: number; rot: number }): Vec[] {
  const u = dirOf(e.rot), n = perp(u);
  return [e.p, add(e.p, mul(u, e.w)), add(add(e.p, mul(u, e.w)), mul(n, e.h)), add(e.p, mul(n, e.h))];
}

/** Vero se l'ellisse è solo un arco. */
export const isEllipseArc = (e: { a0?: number; a1?: number }): boolean => e.a0 !== undefined && e.a1 !== undefined;

/** Punto dell'ellisse al parametro t. */
export function ellipseAt(e: { c: Vec; a: Vec; k: number }, t: number): Vec {
  return add(e.c, add(mul(e.a, Math.cos(t)), mul(perp(e.a), e.k * Math.sin(t))));
}

/** Punti dell'ellisse: n lungo il giro intero (senza ripetere il primo); per un arco, estremi compresi. */
export function ellipsePoints(e: { c: Vec; a: Vec; k: number; a0?: number; a1?: number }, n = 96): Vec[] {
  const out: Vec[] = [];
  if (e.a0 !== undefined && e.a1 !== undefined) {
    const sw = sweep(e.a0, e.a1);
    const m = Math.max(2, Math.ceil((n * sw) / TAU));
    for (let i = 0; i <= m; i++) out.push(ellipseAt(e, e.a0 + (sw * i) / m));
    return out;
  }
  for (let i = 0; i < n; i++) out.push(ellipseAt(e, (TAU * i) / n));
  return out;
}

/** Vero se fra le entità c'è, anche annidato, un inserimento del blocco name. */
export function blockUses(ents: readonly Ent[], name: string, blocks: Blocks, depth = 0): boolean {
  return ents.some(e => e.t === 'insert' && (e.name === name || (depth < 8 && blockUses(blocks[e.name]?.ents ?? [], name, blocks, depth + 1))));
}

function leaderPrims(e: LeaderE, ctx: PrimCtx): Prim[] {
  if (e.pts.length < 2) return [];
  const H = e.h ?? ctx.dimH;
  const out: Prim[] = [{ k: 'pl', pts: e.pts }];
  const d0 = sub(e.pts[0], e.pts[1]);
  if (len(d0) > 1e-9) out.push(arrowPrim(e.pts[0], norm(d0), H));
  if (e.s) {
    // il testo sta oltre l'ultimo punto, dalla parte verso cui va l'ultimo tratto
    const n = e.pts.length;
    const right = e.pts[n - 1].x >= e.pts[n - 2].x;
    out.push({ k: 'text', p: add(e.pts[n - 1], v(right ? H * 0.4 : -H * 0.4, 0)), s: e.s, h: H, rot: 0, ha: right ? 'l' : 'r', va: 'm' });
  }
  return out;
}

/**
 * Punti di una curva morbida per i punti dati (Catmull-Rom centripeta: passa per tutti i punti
 * e non fa cappi fra punti vicini).
 */
export function splinePoints(pts: Vec[], closed: boolean, per = 16): Vec[] {
  const P = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-9);
  if (closed && P.length > 1 && dist(P[0], P[P.length - 1]) <= 1e-9) P.pop();
  const n = P.length;
  if (n < 3) return P;
  const at = (i: number): Vec => {
    if (closed) return P[((i % n) + n) % n];
    if (i < 0) return sub(mul(P[0], 2), P[1]);
    if (i >= n) return sub(mul(P[n - 1], 2), P[n - 2]);
    return P[i];
  };
  const mix = (a: Vec, b: Vec, ta: number, tb: number, t: number): Vec => add(mul(a, (tb - t) / (tb - ta)), mul(b, (t - ta) / (tb - ta)));
  const out: Vec[] = [];
  const spans = closed ? n : n - 1;
  for (let s = 0; s < spans; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    const t1 = Math.max(1e-6, Math.sqrt(dist(p0, p1)));
    const t2 = t1 + Math.max(1e-6, Math.sqrt(dist(p1, p2)));
    const t3 = t2 + Math.max(1e-6, Math.sqrt(dist(p2, p3)));
    for (let j = 0; j < per; j++) {
      const t = t1 + ((t2 - t1) * j) / per;
      const a1 = mix(p0, p1, 0, t1, t), a2 = mix(p1, p2, t1, t2, t), a3 = mix(p2, p3, t2, t3, t);
      out.push(mix(mix(a1, a2, 0, t2, t), mix(a2, a3, t1, t3, t), t1, t2, t));
    }
  }
  if (!closed) out.push(P[n - 1]);
  return out;
}

/** Dal sistema del blocco (punto base nell'origine) alla posizione dell'inserimento. */
export function insertMat(e: InsertE): Mat {
  return compose(translate(e.p.x, e.p.y), compose(rotateAbout(v(0, 0), e.rot), scaleAbout(v(0, 0), e.flip ? -e.s : e.s, e.s)));
}

const MAX_BLOCK_DEPTH = 8;

/**
 * Entità di un blocco inserito, nella loro posizione finale. Come nei CAD, ciò che nel blocco sta
 * sul layer 0 prende il layer dell'inserimento. deep = apre anche i blocchi annidati.
 */
export function expandInsert(e: InsertE, blocks: Blocks | undefined, deep = true, depth = 0): Ent[] {
  const def = blocks?.[e.name];
  if (!def || depth > MAX_BLOCK_DEPTH) return [];
  const m = insertMat(e);
  const out: Ent[] = [];
  for (const c of def.ents) {
    const child: Ent = { ...transform(c, m), id: e.id, layer: c.layer === '0' ? e.layer : c.layer };
    if (!c.color && e.color) child.color = e.color;
    delete child.g;
    if (child.t === 'insert' && deep) out.push(...expandInsert(child, blocks, true, depth + 1));
    else out.push(child);
  }
  return out;
}

/** Elenco da disegnare: le entità date, con gli inserimenti sostituiti dal loro contenuto. */
export function flatEnts(ents: readonly Ent[], blocks: Blocks | undefined): Ent[] {
  if (!ents.some(e => e.t === 'insert')) return ents as Ent[];
  return ents.flatMap(e => (e.t === 'insert' ? insertParts(e, blocks) : [e]));
}

function insertPrims(e: InsertE, ctx: PrimCtx): Prim[] {
  if (!ctx.blocks?.[e.name]) {
    // blocco senza definizione: una crocetta, così resta visibile e selezionabile
    const h = ctx.dimH;
    return [{ k: 'pl', pts: [v(e.p.x - h, e.p.y - h), v(e.p.x + h, e.p.y + h)] }, { k: 'pl', pts: [v(e.p.x - h, e.p.y + h), v(e.p.x + h, e.p.y - h)] }];
  }
  const inner: PrimCtx = { ...ctx, walls: undefined };
  return insertParts(e, ctx.blocks).flatMap(c => prims(c, inner));
}

export function prims(e: Ent, ctx: PrimCtx = DEFAULT_CTX): Prim[] {
  switch (e.t) {
    case 'line': return [{ k: 'pl', pts: [e.a, e.b] }];
    case 'poly': return [{ k: 'pl', pts: polyPoints(e), closed: e.closed }];
    case 'circle': return [{ k: 'arc', c: e.c, r: e.r, a0: 0, a1: TAU, full: true }];
    case 'arc': return [{ k: 'arc', c: e.c, r: e.r, a0: e.a0, a1: e.a1 }];
    case 'text': return [{ k: 'text', p: e.p, s: e.s, h: e.h, rot: e.rot, ha: e.ha, va: e.va }];
    case 'dim': return dimPrims(e, ctx);
    case 'wall': return wallFill(e, wallPrims(e, ctx.walls, blockWalls.get(e)?.wall));
    case 'door': return doorPrims(e, ctx);
    case 'window': return windowPrims(e, ctx);
    case 'room': return roomPrims(e, ctx);
    case 'hatch': return hatchPrims(e);
    case 'ellipse': return [{ k: 'pl', pts: ellipsePoints(e), closed: !isEllipseArc(e) }];
    case 'point': {
      const h = ctx.dimH * 0.35;
      return [{ k: 'pl', pts: [v(e.p.x - h, e.p.y), v(e.p.x + h, e.p.y)] }, { k: 'pl', pts: [v(e.p.x, e.p.y - h), v(e.p.x, e.p.y + h)] }];
    }
    case 'leader': return leaderPrims(e, ctx);
    // il contorno non si disegna: serve per selezionare l'immagine e per il suo ingombro
    case 'image': return [{ k: 'img', p: e.p, w: e.w, h: e.h, rot: e.rot, src: e.src }, { k: 'pl', pts: imageCorners(e), closed: true, stroke: false }];
    case 'spline': return [{ k: 'pl', pts: splinePoints(e.pts, e.closed), closed: e.closed }];
    case 'insert': return insertPrims(e, ctx);
  }
}

/** Curve della rappresentazione: per selezione, intersezioni e snap. */
export function primCurves(ps: Prim[]): Curve[] {
  const out: Curve[] = [];
  for (const p of ps) {
    if (p.k === 'pl') {
      if (p.deco) continue;
      for (let i = 0; i + 1 < p.pts.length; i++) out.push(seg(p.pts[i], p.pts[i + 1]));
      if (p.closed && p.pts.length > 2) out.push(seg(p.pts[p.pts.length - 1], p.pts[0]));
    } else if (p.k === 'arc') out.push(arcC(p.c, p.r, p.a0, p.a1, p.full));
    else if (p.k === 'img') continue;
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
    else if (p.k === 'img') imageCorners(p).forEach(q => boxAdd(b, q));
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
  // porte e finestre occupano tutto il vano, anche dalla parte dove non apre (per snap e selezione)
  if (e?.t === 'door' || e?.t === 'window') {
    const u = mul(dirOf(e.ang), e.w / 2), n = mul(perp(dirOf(e.ang)), e.th / 2);
    for (const q of [add(u, n), sub(u, n), add(mul(u, -1), n), sub(mul(u, -1), n)]) boxAdd(b, add(e.p, q));
  }
  return b;
}

export function entBox(e: Ent, ctx: PrimCtx = DEFAULT_CTX): Box {
  return primsBox(prims(e, ctx), e);
}

// ---------------------------------------------------------------- snap

export type SnapKind = 'end' | 'mid' | 'cen' | 'quad' | 'ins' | 'int' | 'perp' | 'near' | 'grid';

/** low = punto che non si vede (l'asse di un muro dove fa angolo): lì vicino vince uno snap che si vede. */
export interface SnapPt { p: Vec; k: SnapKind; low?: boolean }

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
    case 'dim': P(e.a, e.k ? 'cen' : 'end'); P(e.b, 'end'); P(e.p, 'ins'); if (e.c) P(e.c, 'end'); break;
    case 'wall': {
      // dove il muro fa angolo o si innesta in un altro, la fine dell'asse cade dentro lo spessore:
      // resta agganciabile, ma lì vicino vincono gli spigoli che si vedono
      const inf = blockWalls.get(e)?.wall ?? ctx.walls?.walls.get(e.id);
      out.push({ p: e.a, k: 'end', low: !!inf && !inf.capS }, { p: e.b, k: 'end', low: !!inf && !inf.capE });
      // il medio dei due fili, da spigolo a spigolo: è lì che si appoggiano mobili e sanitari; quello
      // dell'asse, dentro lo spessore, resta ma lì vicino vincono quelli dei fili
      const n = perp(norm(sub(e.b, e.a)));
      const h = e.th / 2;
      const faces: [Vec, Vec][] = inf ? [[inf.sl, inf.el], [inf.sr, inf.er]] : [[add(e.a, mul(n, h)), add(e.b, mul(n, h))], [sub(e.a, mul(n, h)), sub(e.b, mul(n, h))]];
      for (const [a, b] of faces) P(mid(a, b), 'mid');
      out.push({ p: mid(e.a, e.b), k: 'mid', low: true });
      for (const p of prims(e, ctx)) if (p.k === 'pl' && p.stroke !== false && !p.deco) p.pts.forEach(q => P(q, 'end'));
      break;
    }
    case 'door': case 'window': {
      // come per i muri: medio e spigoli del vano su tutti e due i fili del muro, oltre che sull'asse
      const u = dirOf(e.ang), n = perp(u), h = (hostTh(e, ctx) ?? e.th) / 2;
      for (const s of [1, -1]) {
        const f = add(e.p, mul(n, s * h));
        P(f, 'mid'); P(add(f, mul(u, e.w / 2)), 'end'); P(sub(f, mul(u, e.w / 2)), 'end');
      }
      out.push({ p: e.p, k: 'mid', low: true }, { p: add(e.p, mul(u, e.w / 2)), k: 'end', low: true }, { p: sub(e.p, mul(u, e.w / 2)), k: 'end', low: true });
      break;
    }
    case 'room': e.pts.forEach(p => P(p, 'end')); if (e.pts.length > 2) P(centroid(e.pts), 'cen'); break;
    case 'hatch': e.loops.forEach(l => l.forEach(p => P(p, 'end'))); break;
    case 'ellipse': {
      const b = mul(perp(e.a), e.k);
      P(e.c, 'cen');
      if (isEllipseArc(e)) { P(ellipseAt(e, e.a0!), 'end'); P(ellipseAt(e, e.a1!), 'end'); }
      else for (const q of [add(e.c, e.a), sub(e.c, e.a), add(e.c, b), sub(e.c, b)]) P(q, 'quad');
      break;
    }
    case 'point': P(e.p, 'end'); break;
    case 'image': imageCorners(e).forEach(q => P(q, 'end')); break;
    case 'leader': e.pts.forEach(p => P(p, 'end')); break;
    case 'spline': e.pts.forEach(p => P(p, 'end')); break;
    case 'insert':
      P(e.p, 'ins');
      for (const c of expandInsert(e, ctx.blocks)) out.push(...snapPoints(c, ctx));
      break;
  }
  return out;
}

// ---------------------------------------------------------------- grip

const insertGrips = new WeakMap<InsertE, { ctx: PrimCtx; g: Vec[] }>();

/**
 * Grip di un blocco inserito: il punto base e, quando il punto base cade fuori dal disegno del
 * blocco (succede con i blocchi importati), anche il centro del suo ingombro. Tutti e due lo spostano.
 */
function insertGripPts(e: InsertE, ctx: PrimCtx): Vec[] {
  const c = insertGrips.get(e);
  if (c && c.ctx === ctx) return c.g;
  const g = [e.p];
  if (ctx.blocks?.[e.name]) {
    const b = entBox(e, ctx);
    const m = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.05;
    if (b.x1 >= b.x0 && (e.p.x < b.x0 - m || e.p.x > b.x1 + m || e.p.y < b.y0 - m || e.p.y > b.y1 + m)) g.push(v((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2));
  }
  insertGrips.set(e, { ctx, g });
  return g;
}

/** ctx serve solo ai blocchi inseriti, per sapere dove cade il loro disegno. */
export function grips(e: Ent, ctx?: PrimCtx): Vec[] {
  switch (e.t) {
    case 'line': return [e.a, mid(e.a, e.b), e.b];
    case 'poly': return e.pts;
    case 'circle': return [e.c, ...[0, 1, 2, 3].map(q => polar(e.c, e.r, (q * Math.PI) / 2))];
    case 'arc': { const a = arcC(e.c, e.r, e.a0, e.a1); return [arcStart(a), arcMid(a), arcEnd(a), e.c]; }
    case 'text': return [e.p];
    case 'dim': return e.c ? [e.a, e.b, e.p, e.c] : [e.a, e.b, e.p];
    case 'wall': return [e.a, mid(e.a, e.b), e.b];
    case 'door': case 'window': return [e.p];
    case 'room': return e.pts;
    case 'hatch': return e.loops.flat();
    case 'ellipse': { const b = mul(perp(e.a), e.k); return [e.c, add(e.c, e.a), sub(e.c, e.a), add(e.c, b), sub(e.c, b)]; }
    case 'spline': case 'leader': return e.pts;
    case 'insert': return ctx ? insertGripPts(e, ctx) : [e.p];
    case 'point': return [e.p];
    case 'image': return [e.p, imageCorners(e)[2]];
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

export function moveGrip(e: Ent, i: number, p: Vec, ctx?: PrimCtx): Ent {
  const d = sub(p, grips(e, ctx)[i] ?? grips(e)[0]);
  switch (e.t) {
    case 'line': case 'wall':
      if (i === 0) return { ...e, a: p };
      if (i === 2) return { ...e, b: p };
      return { ...e, a: add(e.a, d), b: add(e.b, d) };
    case 'poly': return { ...e, pts: e.pts.map((q, j) => (j === i ? p : q)) };
    case 'room': return { ...e, pts: e.pts.map((q, j) => (j === i ? p : q)) };
    case 'spline': case 'leader': return { ...e, pts: e.pts.map((q, j) => (j === i ? p : q)) };
    case 'ellipse': {
      if (i === 0) return { ...e, c: p };
      const r = dist(e.c, p);
      if (r < 1e-9) return e;
      // i grip sull'asse a lo ruotano e lo allungano lasciando fermo l'altro semiasse; gli altri cambiano solo quello
      if (i >= 3) return { ...e, k: r / len(e.a) };
      return { ...e, a: i === 1 ? sub(p, e.c) : sub(e.c, p), k: (len(e.a) * e.k) / r };
    }
    case 'circle': return i === 0 ? { ...e, c: p } : { ...e, r: Math.max(1e-9, dist(e.c, p)) };
    case 'arc': {
      if (i === 3) return { ...e, c: p };
      const g = grips(e);
      const pts = [g[0], g[1], g[2]];
      pts[i] = p;
      const a = arc3(pts[0], pts[1], pts[2]);
      return a ? { ...e, ...a } : e;
    }
    case 'text': case 'door': case 'window': case 'point': return { ...e, p };
    case 'insert': return { ...e, p: add(e.p, d) };
    case 'image': {
      if (i === 0) return { ...e, p };
      // il grip sull'angolo opposto ingrandisce o rimpicciolisce l'immagine senza deformarla
      const k = dist(e.p, p) / Math.hypot(e.w, e.h);
      return k > 1e-9 ? { ...e, w: e.w * k, h: e.h * k } : e;
    }
    case 'dim': return i === 0 ? { ...e, a: p } : i === 1 ? { ...e, b: p } : i === 3 ? { ...e, c: p } : { ...e, p };
    case 'hatch': {
      let k = i;
      return { ...e, loops: e.loops.map(l => l.map(q => (k-- === 0 ? p : q))) };
    }
  }
}

// ---------------------------------------------------------------- trasformazioni

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
    case 'text': {
      r = { ...x, p: P(x.p), h: x.h * s, rot: mapAngle(m, x.rot) };
      if (mirror) {
        // Il testo specchiato resta leggibile, ma deve occupare il posto dell'immagine allo specchio:
        // se lo si rigira (verrebbe capovolto) cambia l'ancoraggio destra/sinistra, altrimenti sopra/sotto.
        if (Math.cos(r.rot) < -1e-9) { r.rot = normAng(r.rot + Math.PI); r.ha = x.ha === 'l' ? 'r' : x.ha === 'r' ? 'l' : 'c'; }
        else r.va = x.va === 'b' ? 't' : x.va === 't' ? 'b' : 'm';
      }
      break;
    }
    case 'dim':
      r = { ...x, a: P(x.a), b: P(x.b), p: P(x.p), ang: x.ang === undefined ? undefined : mapAngle(m, x.ang) };
      if (x.c) r.c = P(x.c);
      if (x.h !== undefined) r.h = x.h * s;
      break;
    case 'wall':
      r = { ...x, a: P(x.a), b: P(x.b), th: x.th * s };
      if (x.sp !== undefined) r.sp = x.sp * s;
      break;
    case 'door': r = { ...x, p: P(x.p), ang: mapAngle(m, x.ang), w: x.w * s, th: x.th * s, sw: mirror ? (-x.sw as 1 | -1) : x.sw }; break;
    case 'window': r = { ...x, p: P(x.p), ang: mapAngle(m, x.ang), w: x.w * s, th: x.th * s }; break;
    case 'room': r = { ...x, pts: x.pts.map(P) }; break;
    case 'hatch': r = { ...x, loops: x.loops.map(l => l.map(P)), sp: x.sp * s, ang: mapAngle(m, x.ang) }; break;
    case 'ellipse':
      r = { ...x, c: P(x.c), a: applyDir(m, x.a) };
      // allo specchio il verso di percorrenza si inverte: l'arco va dal vecchio estremo finale all'iniziale
      if (mirror && x.a0 !== undefined && x.a1 !== undefined) { r.a0 = -x.a1; r.a1 = -x.a0; }
      break;
    case 'point': r = { ...x, p: P(x.p) }; break;
    case 'image':
      // Allo specchio l'immagine resta dritta (non si può rovesciare), ma va a occupare il posto
      // del rettangolo specchiato: riparte dall'altro angolo di base, in direzione opposta.
      r = mirror
        ? { ...x, p: P(add(x.p, mul(dirOf(x.rot), x.w))), w: x.w * s, h: x.h * s, rot: mapAngle(m, x.rot) + Math.PI }
        : { ...x, p: P(x.p), w: x.w * s, h: x.h * s, rot: mapAngle(m, x.rot) };
      break;
    case 'leader':
      r = { ...x, pts: x.pts.map(P) };
      if (x.h !== undefined) r.h = x.h * s;
      break;
    case 'spline': r = { ...x, pts: x.pts.map(P) }; break;
    case 'insert': {
      // uno specchio rovescia il blocco: l'asse X del blocco specchiato punta dalla parte opposta
      r = { ...x, p: P(x.p), s: x.s * s, rot: mapAngle(m, x.rot) + (mirror ? Math.PI : 0) };
      if (mirror) { if (x.flip) delete r.flip; else r.flip = true; }
      break;
    }
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
    case 'spline': case 'leader': return any(e.pts) ? { ...e, pts: e.pts.map(mv) } : null;
    case 'ellipse': return inside(e.c) ? { ...e, c: add(e.c, d) } : null;
    case 'hatch': return any(e.loops.flat()) ? { ...e, loops: e.loops.map(l => l.map(mv)) } : null;
    case 'dim': return any([e.a, e.b, e.p, ...(e.c ? [e.c] : [])])
      ? { ...e, a: mv(e.a), b: mv(e.b), p: inside(e.p) || (inside(e.a) && inside(e.b)) ? add(e.p, d) : e.p, ...(e.c ? { c: mv(e.c) } : {}) }
      : null;
    case 'circle': return inside(e.c) ? { ...e, c: add(e.c, d) } : null;
    case 'arc': return inside(e.c) ? { ...e, c: add(e.c, d) } : null;
    case 'text': case 'door': case 'window': case 'insert': case 'point': case 'image': return inside(e.p) ? { ...e, p: add(e.p, d) } : null;
  }
}

/** Esplosione in entità semplici. null = non esplodibile. */
export function explode(e: Ent, ctx: PrimCtx = DEFAULT_CTX): NewEnt[] | null {
  const base = { layer: e.layer, color: e.color };
  if (e.t === 'line' || e.t === 'circle' || e.t === 'arc' || e.t === 'point' || e.t === 'image') return null;
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
  if (e.t === 'insert') {
    if (!ctx.blocks?.[e.name]) return null;
    return expandInsert(e, ctx.blocks, false).map(({ id: _id, ...rest }) => rest as NewEnt);
  }
  const out: NewEnt[] = [];
  for (const p of prims(e, ctx)) {
    if (p.k === 'pl') {
      if (p.stroke === false || p.deco) continue;
      if (p.pts.length === 2 && !p.closed) out.push({ ...base, t: 'line', a: p.pts[0], b: p.pts[1] });
      else out.push({ ...base, t: 'poly', pts: p.pts, closed: !!p.closed });
    } else if (p.k === 'arc') {
      out.push(p.full ? { ...base, t: 'circle', c: p.c, r: p.r } : { ...base, t: 'arc', c: p.c, r: p.r, a0: p.a0, a1: p.a1 });
    } else if (p.k === 'text') out.push({ ...base, t: 'text', p: p.p, s: p.s, h: p.h, rot: p.rot, ha: p.ha, va: p.va });
    else if (p.k === 'img') continue;
    else for (const l of p.loops) out.push({ ...base, t: 'poly', pts: l, closed: true });
  }
  return out;
}

