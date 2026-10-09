import { describe, it, expect } from 'vitest';
import type { Ent, LineE, PolyE, CircleE, ArcE, WallE, DoorE } from '../src/model/entities';
import { prims, transform, arc3, snapPoints, explode, textCorners } from '../src/model/entities';
import { offsetEnt, trimEnt, extendEnt, fillet, joinEnts, boundaryCurves, closedLoopAt } from '../src/model/ops';
import { buildWallCtx } from '../src/model/walls';
import { v, sweep, mirrorAcross, rotateAbout, polygonArea, intersect, seg, arcC, TAU } from '../src/model/geom';

const L = (id: number, ax: number, ay: number, bx: number, by: number): LineE => ({ id, layer: '0', t: 'line', a: v(ax, ay), b: v(bx, by) });
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('geometria', () => {
  it('intersezione segmento-arco', () => {
    const pts = intersect(seg(v(-10, 0), v(10, 0)), arcC(v(0, 0), 5, 0, Math.PI));
    expect(pts.length).toBe(2); // gli estremi dell'arco a 0 e π stanno sulla retta
  });
  it('arco per tre punti', () => {
    const a = arc3(v(1, 0), v(0, 1), v(-1, 0))!;
    close(a.r, 1);
    close(sweep(a.a0, a.a1), Math.PI);
  });
});

describe('offset', () => {
  it('linea dal lato del punto', () => {
    const r = offsetEnt(L(1, 0, 0, 10, 0), 3, v(5, -1)) as LineE;
    close(r.a.y, -3); close(r.b.y, -3);
  });
  it('rettangolo verso l\'interno', () => {
    const p: PolyE = { id: 1, layer: '0', t: 'poly', pts: [v(0, 0), v(10, 0), v(10, 10), v(0, 10)], closed: true };
    const r = offsetEnt(p, 1, v(5, 5)) as PolyE;
    close(Math.abs(polygonArea(r.pts)), 64);
  });
  it('cerchio verso l\'esterno', () => {
    const c: CircleE = { id: 1, layer: '0', t: 'circle', c: v(0, 0), r: 5 };
    expect((offsetEnt(c, 2, v(10, 0)) as CircleE).r).toBe(7);
  });
});

describe('taglia', () => {
  const cutter = L(2, 5, -5, 5, 5);
  it('toglie il tratto dalla parte cliccata', () => {
    const r = trimEnt(L(1, 0, 0, 10, 0), boundaryCurves([cutter]), v(8, 0))!;
    expect(r.length).toBe(1);
    const l = r[0] as LineE;
    close(l.a.x, 0); close(l.b.x, 5);
  });
  it('tratto centrale fra due bordi', () => {
    const r = trimEnt(L(1, 0, 0, 10, 0), boundaryCurves([L(2, 3, -5, 3, 5), L(3, 7, -5, 7, 5)]), v(5, 0))!;
    expect(r.length).toBe(2);
    close((r[0] as LineE).b.x, 3); close((r[1] as LineE).a.x, 7);
  });
  it('nessuna intersezione: niente da fare', () => {
    expect(trimEnt(L(1, 0, 0, 10, 0), boundaryCurves([L(2, 20, -5, 20, 5)]), v(5, 0))).toBeNull();
  });
  it('cerchio tagliato diventa arco', () => {
    const c: CircleE = { id: 1, layer: '0', t: 'circle', c: v(0, 0), r: 5 };
    const r = trimEnt(c, boundaryCurves([L(2, -10, 0, 10, 0)]), v(0, 5))!;
    const a = r[0] as ArcE;
    expect(a.t).toBe('arc');
    close(sweep(a.a0, a.a1), Math.PI);
    // resta la metà inferiore
    close(Math.sin(a.a0 + sweep(a.a0, a.a1) / 2), -1);
  });
  it('polilinea chiusa diventa aperta', () => {
    const p: PolyE = { id: 1, layer: '0', t: 'poly', pts: [v(0, 0), v(10, 0), v(10, 10), v(0, 10)], closed: true };
    const r = trimEnt(p, boundaryCurves([L(2, 5, -5, 5, 15)]), v(10, 5))!;
    const q = r[0] as PolyE;
    expect(q.closed).toBe(false);
    close(q.pts[0].x, 5); close(q.pts[0].y, 10);
    close(q.pts[q.pts.length - 1].x, 5); close(q.pts[q.pts.length - 1].y, 0);
    expect(q.pts.length).toBe(4);
  });
});

describe('estendi', () => {
  it('linea fino al bordo', () => {
    const r = extendEnt(L(1, 0, 0, 4, 0), boundaryCurves([L(2, 10, -5, 10, 5)]), v(3.9, 0)) as LineE;
    close(r.b.x, 10); close(r.a.x, 0);
  });
  it('arco fino al bordo', () => {
    const a: ArcE = { id: 1, layer: '0', t: 'arc', c: v(0, 0), r: 5, a0: 0, a1: Math.PI / 4 };
    const r = extendEnt(a, boundaryCurves([L(2, 0, 0, 0, 10)]), v(3.5, 3.5)) as ArcE;
    close(r.a1, Math.PI / 2, 1e-6);
  });
});

describe('raccorda', () => {
  it('raggio zero: angolo vivo', () => {
    const r = fillet(L(1, 0, 0, 8, 0), v(2, 0), L(2, 10, 2, 10, 10), v(10, 8), 0)!;
    close(r.a.b.x, 10); close(r.b.a.y, 0);
  });
  it('raggio 2: arco tangente', () => {
    const r = fillet(L(1, 0, 0, 10, 0), v(2, 0), L(2, 10, 0, 10, 10), v(10, 8), 2)!;
    const arc = r.arc as Omit<ArcE, 'id'>;
    close(arc.r, 2); close(arc.c.x, 8); close(arc.c.y, 2);
    close(r.a.b.x, 8); close(r.b.a.y, 2);
  });
});

describe('unisci', () => {
  it('tre linee in una polilinea chiusa', () => {
    const r = joinEnts([L(1, 0, 0, 10, 0), L(2, 10, 10, 10, 0), L(3, 10, 10, 0, 0)])!;
    const p = r.poly as PolyE;
    expect(p.closed).toBe(true);
    expect(p.pts.length).toBe(3);
    expect(r.used.sort()).toEqual([1, 2, 3]);
  });
});

describe('muri', () => {
  const w1: WallE = { id: 1, layer: 'MURI', t: 'wall', a: v(0, 0), b: v(400, 0), th: 30 };
  const w2: WallE = { id: 2, layer: 'MURI', t: 'wall', a: v(400, 0), b: v(400, 300), th: 30 };
  it('angolo a quartabuono senza testate', () => {
    const ctx = buildWallCtx([w1, w2]);
    const i1 = ctx.walls.get(1)!;
    expect(i1.capE).toBe(false);
    // angolo esterno in (415, -15), interno in (385, 15)
    close(i1.er.x, 415); close(i1.er.y, -15);
    close(i1.el.x, 385); close(i1.el.y, 15);
  });
  it('porta che apre il muro', () => {
    const d: DoorE = { id: 3, layer: 'SERRAMENTI', t: 'door', p: v(200, 0), ang: 0, w: 80, th: 30, sw: 1, hg: 1 };
    const ctx = buildWallCtx([w1, d]);
    expect(ctx.walls.get(1)!.cuts).toEqual([[160, 240]]);
    expect(ctx.openTh.get(3)).toBe(30);
    // due pezzi pieni
    const fills = prims(w1, { dimH: 10, dimDec: 0, areaDiv: 1e4, walls: ctx }).filter(p => p.k === 'pl' && p.fill === 'wall');
    expect(fills.length).toBe(2);
  });
  it('innesto a T taglia il bordo del muro ospite', () => {
    const w3: WallE = { id: 3, layer: 'MURI', t: 'wall', a: v(200, 0), b: v(200, 200), th: 10 };
    const ctx = buildWallCtx([w1, w3]);
    expect(ctx.walls.get(1)!.cutsL).toEqual([[195, 205]]);
    close(ctx.walls.get(3)!.sl.y, 15);
  });
});

describe('trasformazioni', () => {
  it('specchio di un arco mantiene la forma', () => {
    const a: ArcE = { id: 1, layer: '0', t: 'arc', c: v(0, 0), r: 5, a0: 0, a1: Math.PI / 2 };
    const m = transform(a, mirrorAcross(v(0, 0), v(0, 1)));
    close(sweep(m.a0, m.a1), Math.PI / 2);
    // quarto in alto a sinistra
    close(Math.cos(m.a0 + Math.PI / 4), -Math.SQRT1_2);
  });
  it('specchio della porta inverte il verso di apertura', () => {
    const d: DoorE = { id: 1, layer: '0', t: 'door', p: v(0, 0), ang: 0, w: 80, th: 30, sw: 1, hg: 1 };
    expect(transform(d, mirrorAcross(v(0, 0), v(1, 0))).sw).toBe(-1);
  });
  it('rotazione di 90° di un testo', () => {
    const t: Ent = { id: 1, layer: '0', t: 'text', p: v(10, 0), s: 'A', h: 2, rot: 0, ha: 'l', va: 'b' };
    const r = transform(t, rotateAbout(v(0, 0), Math.PI / 2));
    if (r.t !== 'text') throw new Error();
    close(r.p.x, 0); close(r.p.y, 10); close(r.rot, Math.PI / 2);
    expect(textCorners(r).length).toBe(4);
  });
});

describe('varie', () => {
  it('contorno chiuso più piccolo', () => {
    const big: PolyE = { id: 1, layer: '0', t: 'poly', pts: [v(0, 0), v(100, 0), v(100, 100), v(0, 100)], closed: true };
    const small: CircleE = { id: 2, layer: '0', t: 'circle', c: v(50, 50), r: 10 };
    expect(closedLoopAt([big, small], v(50, 50))!.id).toBe(2);
    expect(closedLoopAt([big, small], v(5, 5))!.id).toBe(1);
  });
  it('snap e esplosione della polilinea', () => {
    const p: PolyE = { id: 1, layer: '0', t: 'poly', pts: [v(0, 0), v(10, 0), v(10, 10)], bulges: [0, 0.5], closed: false };
    expect(snapPoints(p).filter(s => s.k === 'end').length).toBe(3);
    const parts = explode(p)!;
    expect(parts.map(x => x.t)).toEqual(['line', 'arc']);
  });
  it('quota orizzontale misura la sola componente x', () => {
    const ps = prims({ id: 1, layer: '0', t: 'dim', a: v(0, 0), b: v(300, 40), p: v(0, 100), ang: 0 }, { dimH: 10, dimDec: 0, areaDiv: 1e4 });
    const txt = ps.find(p => p.k === 'text');
    expect(txt && txt.k === 'text' && txt.s).toBe('300');
  });
  it('TAU è un giro', () => close(TAU, 2 * Math.PI));
});
