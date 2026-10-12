import { describe, it, expect } from 'vitest';
import type { Ent, LineE, PolyE, CircleE, ArcE, WallE, DoorE, DimE, EllipseE, InsertE, Blocks, Prim } from '../src/model/entities';
import { prims, transform, arc3, snapPoints, explode, textCorners, dimValue, dimText, dimAngGeometry, DEFAULT_CTX, ellipsePoints, splinePoints, moveGrip, expandInsert, flatEnts } from '../src/model/entities';
import { offsetPolyArcs, offsetEnt, trimEnt, extendEnt, fillet, chamfer, arrayRect, arrayPolar, joinEnts, boundaryCurves, closedLoopAt } from '../src/model/ops';
import { buildWallCtx } from '../src/model/walls';
import { v, sweep, mirrorAcross, rotateAbout, scaleAbout, translate, compose, polygonArea, intersect, seg, arcC, apply, dist, TAU } from '../src/model/geom';
import { usesBlock, findBlockName } from '../src/tools/blocks';

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

describe('offset di polilinee con archi', () => {
  // asola: due lati dritti lunghi 100 e due semicerchi di raggio 20, percorsa in senso antiorario
  const slot: PolyE = { id: 1, layer: '0', t: 'poly', closed: true, pts: [v(0, 0), v(100, 0), v(100, 40), v(0, 40)], bulges: [0, 1, 0, 1] };
  it('asola verso l\'esterno: stessi vertici spostati, semicerchi più grandi', () => {
    const r = offsetEnt(slot, 5, v(50, -30)) as PolyE;
    expect(r.closed).toBe(true);
    expect(r.pts.length).toBe(4);
    close(r.pts[0].y, -5); close(r.pts[1].y, -5); close(r.pts[2].y, 45);
    close(r.pts[1].x, 100);
    close(r.bulges![1], 1); close(r.bulges![3], 1);
    close(r.bulges![0], 0);
  });
  it('asola verso l\'interno, e troppo verso l\'interno', () => {
    const r = offsetEnt(slot, 5, v(50, 20)) as PolyE;
    close(r.pts[0].y, 5); close(r.pts[2].y, 35);
    expect(offsetEnt(slot, 25, v(50, 20))).toBeNull();
  });
  it('il lato si sceglie anche cliccando vicino a un arco', () => {
    const out = offsetEnt(slot, 5, v(130, 20)) as PolyE;
    close(out.pts[0].y, -5);
    const inn = offsetEnt(slot, 5, v(115, 20)) as PolyE;
    close(inn.pts[0].y, 5);
  });
  it('spigolo vivo fra linea e arco: i tratti si allungano fino a incontrarsi', () => {
    // linea orizzontale poi quarto di cerchio che parte in verticale: spigolo a 90° in (100, 0)
    const p: PolyE = { id: 1, layer: '0', t: 'poly', closed: false, pts: [v(0, 0), v(100, 0), v(150, 50)], bulges: [0, -Math.tan(Math.PI / 8), 0] };
    const r = offsetPolyArcs(p, -10)!;
    expect(r.pts.length).toBe(3);
    close(r.pts[0].x, 0); close(r.pts[0].y, -10);
    // il punto d'incontro sta sulla parallela e sul cerchio concentrico (centro 150,0 raggio 40: a destra di un arco orario si va verso il centro)
    close(r.pts[1].y, -10);
    close(Math.hypot(r.pts[1].x - 150, r.pts[1].y), 40);
    close(Math.hypot(r.pts[2].x - 150, r.pts[2].y), 40);
  });
  it('dove i tratti non si incontrano li unisce un arco sul vertice', () => {
    // due gobbe che si toccano di punta: verso l'interno delle gobbe gli archi concentrici non si incontrano più
    const p: PolyE = { id: 1, layer: '0', t: 'poly', closed: false, pts: [v(0, 0), v(100, 0), v(200, 0)], bulges: [-1, -1, 0] };
    const r = offsetPolyArcs(p, -10)!;
    expect(r.pts.length).toBe(4);
    expect(offsetPolyArcs(p, 10)!.pts.length).toBe(3);
    close(Math.hypot(r.pts[1].x - 100, r.pts[1].y), 10);
    close(Math.hypot(r.pts[2].x - 100, r.pts[2].y), 10);
  });
});

describe('ellisse', () => {
  const el: EllipseE = { id: 1, layer: '0', t: 'ellipse', c: v(10, 20), a: v(50, 0), k: 0.4 };
  it('passa per gli estremi dei due assi', () => {
    const pts = ellipsePoints(el, 4);
    close(pts[0].x, 60); close(pts[0].y, 20);
    close(pts[1].x, 10); close(pts[1].y, 40);
    close(pts[2].x, -40); close(pts[3].y, 0);
  });
  it('area π·a·b', () => {
    close(Math.abs(polygonArea(ellipsePoints(el, 720))), Math.PI * 50 * 20, 0.1);
  });
  it('ruotata di 90° scambia larghezza e altezza', () => {
    const r = transform(el, rotateAbout(v(10, 20), Math.PI / 2));
    const xs = ellipsePoints(r).map(p => p.x), ys = ellipsePoints(r).map(p => p.y);
    close(Math.max(...xs) - Math.min(...xs), 40, 1e-3);
    close(Math.max(...ys) - Math.min(...ys), 100, 1e-3);
  });
  it('i grip cambiano un semiasse alla volta', () => {
    const wider = moveGrip(el, 1, v(110, 20)) as EllipseE;
    close(Math.hypot(wider.a.x, wider.a.y), 100);
    close(Math.hypot(wider.a.x, wider.a.y) * wider.k, 20);
    const taller = moveGrip(el, 3, v(10, 50)) as EllipseE;
    close(50 * taller.k, 30);
  });
  it('centro e quattro quadranti per lo snap', () => {
    const s = snapPoints(el);
    expect(s.filter(p => p.k === 'cen').length).toBe(1);
    expect(s.filter(p => p.k === 'quad').length).toBe(4);
  });
});

describe('spline', () => {
  const pts = [v(0, 0), v(50, 40), v(100, 0), v(150, 40)];
  it('passa per tutti i punti dati, estremi compresi', () => {
    const c = splinePoints(pts, false);
    for (const p of pts) expect(Math.min(...c.map(q => dist(p, q)))).toBeLessThan(1e-9);
    expect(c[0]).toEqual(pts[0]);
    expect(c[c.length - 1]).toEqual(pts[3]);
  });
  it('è morbida: nessun passo più lungo del doppio di quelli vicini', () => {
    const c = splinePoints(pts, false);
    for (let i = 2; i < c.length - 1; i++) {
      const a = dist(c[i - 1], c[i]), b = dist(c[i], c[i + 1]);
      expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(2);
    }
  });
  it('chiusa: torna al punto di partenza senza ripeterlo', () => {
    const c = splinePoints(pts, true);
    expect(c.length).toBe(4 * 16);
    expect(dist(c[0], c[c.length - 1])).toBeLessThan(30);
  });
  it('due punti sono un segmento, i doppioni non rompono niente', () => {
    expect(splinePoints([v(0, 0), v(10, 0)], false)).toEqual([v(0, 0), v(10, 0)]);
    const c = splinePoints([v(0, 0), v(0, 0), v(50, 40), v(100, 0)], false);
    expect(c.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe('blocchi', () => {
  // una "sedia": linea lungo X sul layer 0 e un cerchio su un layer suo, base nell'origine
  const blocks: Blocks = {
    sedia: { ents: [L(1, 0, 0, 10, 0), { id: 2, layer: 'ARREDI', color: '#ff0000', t: 'circle', c: v(10, 5), r: 2 }] },
    tavolo: { ents: [{ id: 3, layer: '0', t: 'insert', name: 'sedia', p: v(100, 0), s: 1, rot: 0 }, L(4, 0, 0, 0, 50)] },
  };
  const ins = (x: Partial<InsertE> = {}): InsertE => ({ id: 9, layer: 'MOBILI', t: 'insert', name: 'sedia', p: v(100, 200), s: 2, rot: Math.PI / 2, ...x });
  const ctx = { ...DEFAULT_CTX, blocks };
  const pointsOf = (ps: Prim[]) => ps.flatMap(p => (p.k === 'pl' ? p.pts : p.k === 'arc' ? [p.c] : []));

  it('scala, ruota e sposta il contenuto', () => {
    const [line, circle] = expandInsert(ins(), blocks) as [LineE, CircleE];
    close(line.a.x, 100); close(line.a.y, 200);
    close(line.b.x, 100); close(line.b.y, 220);
    close(circle.c.x, 90); close(circle.c.y, 220);
    close(circle.r, 4);
  });
  it('il layer 0 del blocco prende il layer dell\'inserimento, gli altri restano', () => {
    const [line, circle] = expandInsert(ins({ color: '#00ff00' }), blocks);
    expect(line.layer).toBe('MOBILI');
    expect(line.color).toBe('#00ff00');
    expect(circle.layer).toBe('ARREDI');
    expect(circle.color).toBe('#ff0000');
  });
  it('blocchi annidati', () => {
    const kids = expandInsert(ins({ name: 'tavolo', p: v(0, 0), s: 1, rot: 0 }), blocks);
    expect(kids.map(k => k.t)).toEqual(['line', 'circle', 'line']);
    close((kids[0] as LineE).a.x, 100);
    expect(expandInsert(ins({ name: 'tavolo' }), blocks, false).map(k => k.t)).toEqual(['insert', 'line']);
  });
  it('un blocco che contiene se stesso non manda in ciclo', () => {
    const loop: Blocks = { a: { ents: [{ id: 1, layer: '0', t: 'insert', name: 'a', p: v(1, 0), s: 1, rot: 0 }, L(2, 0, 0, 1, 0)] } };
    expect(expandInsert(ins({ name: 'a' }), loop).length).toBeLessThan(20);
    expect(usesBlock(loop.a.ents, 'a', loop)).toBe(true);
  });
  it('riconosce l\'uso annidato e i nomi senza badare alle maiuscole', () => {
    expect(usesBlock(blocks.tavolo.ents, 'sedia', blocks)).toBe(true);
    expect(usesBlock([ins({ name: 'tavolo' })], 'sedia', blocks)).toBe(true);
    expect(usesBlock(blocks.sedia.ents, 'tavolo', blocks)).toBe(false);
    expect(findBlockName(blocks, ' SEDIA ')).toBe('sedia');
    expect(findBlockName(blocks, 'divano')).toBeUndefined();
  });
  it('trasformare l\'inserimento equivale a trasformare il contenuto, anche allo specchio', () => {
    const mats = [
      rotateAbout(v(30, -10), 0.7),
      compose(translate(5, 9), scaleAbout(v(0, 0), 1.5)),
      mirrorAcross(v(0, 0), v(1, 2)),
      compose(mirrorAcross(v(3, 0), v(3, 1)), rotateAbout(v(0, 0), 2.1)),
    ];
    for (const m of mats) {
      for (const e of [ins(), ins({ flip: true }), ins({ name: 'tavolo' })]) {
        const viaInsert = pointsOf(prims(transform(e, m), ctx));
        const viaKids = pointsOf(expandInsert(e, blocks).flatMap(k => prims(transform(k, m))));
        expect(viaInsert.length).toBe(viaKids.length);
        viaInsert.forEach((p, i) => { close(p.x, viaKids[i].x); close(p.y, viaKids[i].y); });
      }
    }
  });
  it('specchiare due volte riporta all\'originale', () => {
    const m = mirrorAcross(v(0, 0), v(1, 2));
    const back = transform(transform(ins(), m), m);
    expect(back.flip).toBeUndefined();
    close(Math.cos(back.rot), Math.cos(ins().rot)); close(Math.sin(back.rot), Math.sin(ins().rot));
  });
  it('esplodere apre un solo livello e toglie gli id', () => {
    const parts = explode(ins({ name: 'tavolo' }), ctx)!;
    expect(parts.map(p => p.t)).toEqual(['insert', 'line']);
    expect(parts.every(p => p.id === undefined)).toBe(true);
    expect(explode(ins({ name: 'manca' }), ctx)).toBeNull();
  });
  it('un inserimento senza definizione si vede come crocetta', () => {
    expect(prims(ins({ name: 'manca' }), ctx).length).toBe(2);
    expect(flatEnts([ins({ name: 'manca' }), L(5, 0, 0, 1, 1)], blocks).length).toBe(1);
  });
  it('lo snap vede il punto di inserimento e il contenuto', () => {
    const s = snapPoints(ins(), ctx);
    expect(s.some(p => p.k === 'ins' && p.p.x === 100 && p.p.y === 200)).toBe(true);
    expect(s.some(p => p.k === 'cen' && Math.abs(p.p.x - 90) < 1e-9)).toBe(true);
  });
});

describe('altezza del testo delle quote', () => {
  const d: DimE = { id: 1, layer: 'QUOTE', t: 'dim', a: v(0, 0), b: v(300, 0), p: v(0, 50) };
  const textH = (e: DimE) => (prims(e, { ...DEFAULT_CTX, dimH: 15 }).find(p => p.k === 'text') as { h: number }).h;
  it('senza altezza propria usa quella del disegno, altrimenti la sua', () => {
    expect(textH(d)).toBe(15);
    expect(textH({ ...d, h: 40 })).toBe(40);
    expect(textH({ ...d, k: 'rad', h: 8 })).toBe(8);
    expect(textH({ ...d, k: 'ang', c: v(0, 300), p: v(50, 50), h: 8 })).toBe(8);
  });
  it('scalando la quota scala anche la sua altezza', () => {
    expect(transform({ ...d, h: 40 }, scaleAbout(v(0, 0), 0.5)).h).toBe(20);
    expect(transform(d, scaleAbout(v(0, 0), 0.5)).h).toBeUndefined();
  });
});

describe('smusso', () => {
  const h = L(1, 0, 0, 100, 0), w = L(2, 100, 0, 100, 80);
  it('distanze diverse sui due lati', () => {
    const r = chamfer(h, v(50, 0), w, v(100, 40), 10, 20);
    if (typeof r === 'string') throw new Error(r);
    expect(r.a.b).toEqual(v(90, 0));
    expect(r.b.a).toEqual(v(100, 20));
    expect(r.line).toMatchObject({ t: 'line', a: v(90, 0), b: v(100, 20) });
  });
  it('distanza zero chiude lo spigolo di linee che non si toccano', () => {
    const r = chamfer(L(1, 0, 0, 60, 0), v(30, 0), L(2, 100, 30, 100, 80), v(100, 50), 0, 0);
    if (typeof r === 'string') throw new Error(r);
    expect(r.a.b).toEqual(v(100, 0));
    expect(r.b.a).toEqual(v(100, 0));
    expect(r.line).toBeUndefined();
  });
  it('rifiuta linee parallele e distanze più lunghe della linea', () => {
    expect(chamfer(h, v(50, 0), L(2, 0, 10, 100, 10), v(50, 10), 5, 5)).toBe('parallel');
    expect(chamfer(h, v(50, 0), w, v(100, 40), 10, 80)).toBe('short');
  });
});

describe('serie', () => {
  it('rettangolare: righe × colonne meno l\'originale', () => {
    const ms = arrayRect(2, 3, 50, 100);
    expect(ms.length).toBe(5);
    expect(ms.map(m => apply(m, v(0, 0)))).toEqual([v(100, 0), v(200, 0), v(0, 50), v(100, 50), v(200, 50)]);
  });
  it('polare sul giro completo: elementi equidistanti', () => {
    const ms = arrayPolar(v(0, 0), 4, TAU, true, v(10, 0));
    expect(ms.length).toBe(3);
    const p = ms.map(m => apply(m, v(10, 0)));
    close(p[0].x, 0); close(p[0].y, 10);
    close(p[1].x, -10); close(p[1].y, 0);
    close(p[2].x, 0); close(p[2].y, -10);
  });
  it('polare su un arco: primo e ultimo agli estremi', () => {
    const ms = arrayPolar(v(0, 0), 3, Math.PI / 2, true, v(10, 0));
    const last = apply(ms[1], v(10, 0));
    close(last.x, 0); close(last.y, 10);
  });
  it('polare senza rotazione: le copie restano dritte', () => {
    const [m] = arrayPolar(v(0, 0), 4, TAU, false, v(10, 0));
    const a = apply(m, v(10, 0)), b = apply(m, v(12, 0));
    close(a.x, 0); close(a.y, 10);
    close(b.x - a.x, 2); close(b.y - a.y, 0);
  });
});

describe('quote radiali e angolari', () => {
  const D = (x: Partial<DimE>): DimE => ({ id: 1, layer: 'QUOTE', t: 'dim', a: v(0, 0), b: v(50, 0), p: v(80, 0), ...x });
  it('raggio e diametro con prefisso', () => {
    expect(dimText(D({ k: 'rad' }), DEFAULT_CTX)).toBe('R50');
    expect(dimText(D({ k: 'dia' }), DEFAULT_CTX)).toBe('Ø100');
    expect(dimText(D({ k: 'rad', s: 'r = 50' }), DEFAULT_CTX)).toBe('r = 50');
  });
  it('angolo: il settore è quello che contiene il punto', () => {
    const inner = D({ k: 'ang', b: v(100, 0), c: v(0, 100), p: v(30, 30) });
    close(dimValue(inner)!, 90);
    expect(dimText(inner, DEFAULT_CTX)).toBe('90°');
    const outer = D({ k: 'ang', b: v(100, 0), c: v(0, 100), p: v(-30, -30) });
    close(dimValue(outer)!, 270);
    close(dimAngGeometry(outer)!.a0, Math.PI / 2);
  });
  it('angolo con un decimale', () => {
    const d = D({ k: 'ang', b: v(100, 0), c: v(100, 100 * Math.tan((37.5 * Math.PI) / 180)), p: v(50, 10) });
    expect(dimText(d, DEFAULT_CTX)).toBe('37,5°');
  });
  it('la quota angolare disegna arco, due frecce e testo', () => {
    const ps = prims(D({ k: 'ang', b: v(100, 0), c: v(0, 100), p: v(30, 30) }));
    expect(ps.filter(p => p.k === 'arc').length).toBe(1);
    expect(ps.filter(p => p.k === 'pl' && p.fill === 'solid').length).toBe(2);
    expect(ps.filter(p => p.k === 'text').length).toBe(1);
  });
  it('ruotata di 90° misura ancora lo stesso angolo', () => {
    const d = transform(D({ k: 'ang', b: v(100, 0), c: v(0, 100), p: v(30, 30) }), rotateAbout(v(0, 0), Math.PI / 2));
    close(dimValue(d)!, 90);
    close(d.c!.x, -100);
  });
  it('specchiata misura ancora lo stesso angolo', () => {
    const d = transform(D({ k: 'ang', b: v(100, 0), c: v(0, 100), p: v(30, 30) }), mirrorAcross(v(0, 0), v(0, 1)));
    close(dimValue(d)!, 90);
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
