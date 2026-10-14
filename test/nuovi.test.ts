// Funzioni aggiunte con la versione 0.3: porte che seguono i muri, blocchi modificabili, spezza,
// allunga, dividi, vertici delle polilinee, archi di ellisse, direttrici, snap e import dei blocchi.
import { describe, it, expect } from 'vitest';
import type { Ent, LineE, PolyE, ArcE, CircleE, WallE, DoorE, EllipseE, InsertE, DimE, LeaderE, Prim } from '../src/model/entities';
import { prims, transform, ellipsePoints, ellipseAt, snapPoints, DEFAULT_CTX } from '../src/model/entities';
import { breakEnt, lengthenEnt, pointsAlong, entLength, polyAddVertex, polyRemoveVertex, trimEnt, offsetEnt, boundaryCurves } from '../src/model/ops';
import { Doc } from '../src/model/document';
import { v, dist, mirrorAcross, rotateAbout, translate, TAU } from '../src/model/geom';
import { findSnap, SnapSettings } from '../src/view/snap';
import { buildImport, rescaleImport, importSize } from '../src/io/importer';
import { buildSheet } from '../src/print/sheet';
import { exportDxf } from '../src/io/dxf-export';

const L = (id: number, ax: number, ay: number, bx: number, by: number): LineE => ({ id, layer: '0', t: 'line', a: v(ax, ay), b: v(bx, by) });
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('porte e finestre seguono il muro', () => {
  const make = () => {
    const doc = new Doc();
    doc.edit('t', () => {
      doc.add({ t: 'wall', a: v(0, 0), b: v(500, 0), th: 30, layer: 'MURI' });
      doc.add({ t: 'door', p: v(200, 0), ang: 0, w: 80, th: 30, sw: 1, hg: 1, layer: 'SERRAMENTI' });
      doc.add({ t: 'window', p: v(400, 0), ang: 0, w: 60, th: 30, layer: 'SERRAMENTI' });
      doc.add({ t: 'wall', a: v(0, 300), b: v(500, 300), th: 30, layer: 'MURI' });
    });
    return doc;
  };
  const door = (doc: Doc) => doc.ents.find(e => e.t === 'door') as DoorE | undefined;

  it('spostando il muro la porta resta alla stessa distanza dal suo inizio', () => {
    const doc = make();
    const w = doc.ents[0] as WallE;
    doc.edit('Sposta', () => doc.replace([transform(w, translate(50, 100))]));
    expect(door(doc)!.p).toEqual(v(250, 100));
    expect((doc.ents[2] as { p: { x: number; y: number } }).p).toEqual(v(450, 100));
  });
  it('ruotando il muro ruota anche la porta', () => {
    const doc = make();
    doc.edit('Ruota', () => doc.replace([transform(doc.ents[0], rotateAbout(v(0, 0), Math.PI / 2))]));
    const d = door(doc)!;
    close(d.p.x, 0); close(d.p.y, 200);
    close(d.ang, Math.PI / 2);
  });
  it('cancellando il muro spariscono le sue aperture, non quelle degli altri', () => {
    const doc = make();
    doc.edit('t', () => doc.add({ t: 'window', p: v(100, 300), ang: 0, w: 60, th: 30, layer: 'SERRAMENTI' }));
    doc.edit('Cancella', () => doc.remove([doc.ents[0].id]));
    expect(doc.ents.map(e => e.t)).toEqual(['wall', 'window']);
    doc.undo();
    expect(doc.ents.filter(e => e.t === 'door').length).toBe(1);
  });
  it('accorciando il muro la porta resta dentro; se non ci sta più, se ne va', () => {
    const doc = make();
    const w = doc.ents[0] as WallE;
    doc.edit('Stira', () => doc.replace([{ ...w, b: v(220, 0) }]));
    close(door(doc)!.p.x, 180);
    expect(doc.ents.some(e => e.t === 'window' && e.p.y === 0)).toBe(true);
    doc.edit('Stira', () => doc.replace([{ ...(doc.ents[0] as WallE), b: v(70, 0) }]));
    expect(door(doc)).toBeUndefined();
  });
  it('tagliare o spezzare il muro non cancella la porta che resta su un pezzo', () => {
    const doc = make();
    const w = doc.ents[0] as WallE;
    // come fanno TAGLIA e SPEZZA: via il muro, dentro i pezzi con numeri nuovi
    doc.edit('Spezza', () => { doc.remove([w.id]); doc.addMany([{ ...w, id: undefined, b: v(350, 0) }, { ...w, id: undefined, a: v(450, 0) }]); });
    expect(door(doc)!.p).toEqual(v(200, 0));
    // la finestra stava a x=400, nel tratto tolto: non ha più un muro
    expect(doc.ents.some(e => e.t === 'window' && e.p.y === 0)).toBe(false);
  });
  it('allungare il muro dalla parte dell\'inizio, o cambiargli colore, non sposta la porta', () => {
    const doc = make();
    const w = doc.ents[0] as WallE;
    doc.edit('Allunga', () => doc.replace([{ ...w, a: v(-100, 0) }]));
    expect(door(doc)!.p).toEqual(v(200, 0));
    doc.edit('Colore', () => doc.replace([{ ...(doc.ents[0] as WallE), color: '#ff0000' }]));
    expect(door(doc)!.p).toEqual(v(200, 0));
    // rovesciato sulla sua retta (specchio del solo muro): la porta resta dov'è e apre dalla stessa parte
    doc.edit('Specchio', () => doc.replace([{ ...(doc.ents[0] as WallE), a: v(500, 0), b: v(-100, 0) }]));
    expect(door(doc)!.p).toEqual(v(200, 0));
    expect(door(doc)!.ang).toBe(0);
  });
  it('se si sposta anche la porta, decide chi la sposta', () => {
    const doc = make();
    const m = translate(0, 50);
    doc.edit('Sposta', () => doc.replace([transform(doc.ents[0], m), { ...door(doc)!, p: v(300, 50) }]));
    expect(door(doc)!.p).toEqual(v(300, 50));
  });
  it('cambiando spessore al muro cambia quello dell\'apertura', () => {
    const doc = make();
    doc.edit('Proprietà', () => doc.replace([{ ...(doc.ents[0] as WallE), th: 20 }]));
    expect(door(doc)!.th).toBe(20);
  });
});

describe('modifica dei blocchi sul posto', () => {
  const make = () => {
    const doc = new Doc();
    doc.edit('t', () => {
      doc.blocks = { sedia: { ents: [L(1, 0, 0, 10, 0)] }, vuoto: { ents: [L(1, 0, 0, 1, 1)] } };
      doc.add({ t: 'insert', name: 'sedia', p: v(100, 0), s: 1, rot: 0, layer: '0' });
      doc.add({ t: 'line', a: v(0, 0), b: v(5, 5), layer: '0' });
    });
    return doc;
  };
  it('apre il contenuto, lo salva e torna al disegno con un solo passo di annullamento', () => {
    const doc = make();
    expect(doc.beginBlockEdit('sedia')).toBe(true);
    expect(doc.ents.map(e => e.t)).toEqual(['line']);
    doc.edit('Cerchio', () => doc.add({ t: 'circle', c: v(5, 5), r: 2, layer: '0' }));
    // salvando durante la modifica si salva il disegno vero
    expect(doc.toData().ents.length).toBe(2);
    expect(doc.endBlockEdit(true)).toBe(0);
    expect(doc.editing).toBeNull();
    expect(doc.ents.length).toBe(2);
    expect(doc.blocks.sedia.ents.map(e => e.t)).toEqual(['line', 'circle']);
    doc.undo();
    expect(doc.blocks.sedia.ents.length).toBe(1);
    expect(doc.ents.length).toBe(2);
  });
  it('durante la modifica non si annulla oltre l\'inizio; scartando non cambia niente', () => {
    const doc = make();
    doc.beginBlockEdit('sedia');
    expect(doc.undo()).toBeNull();
    doc.edit('x', () => doc.remove([doc.ents[0].id]));
    expect(doc.undo()).toBe('x');
    doc.edit('x', () => doc.remove([doc.ents[0].id]));
    doc.endBlockEdit(false);
    expect(doc.blocks.sedia.ents.length).toBe(1);
    expect(doc.ents.length).toBe(2);
    expect(doc.undo()).toBe('t');
  });
  it('cambio di unità e nomi durante la modifica valgono anche per il disegno che aspetta, e si annullano', () => {
    const doc = make();
    doc.beginBlockEdit('sedia');
    doc.edit('Cambio unità', () => doc.convertUnits('m'));
    doc.undo();
    doc.endBlockEdit(false);
    expect((doc.ents[0] as InsertE).p).toEqual(v(100, 0));
    expect(doc.settings.units).toBe('cm');
    doc.beginBlockEdit('vuoto');
    doc.edit('Rinomina', () => doc.renameBlock('sedia', 'poltrona'));
    doc.edit('Rinomina', () => doc.renameBlock('vuoto', 'niente'));
    expect(doc.editing!.name).toBe('niente');
    doc.endBlockEdit(true);
    expect((doc.ents[0] as InsertE).name).toBe('poltrona');
    expect(Object.keys(doc.blocks).sort()).toEqual(['niente', 'poltrona']);
  });
  it('oltre cento passi di annullamento la modifica di un blocco non sporca la pila', () => {
    const doc = make();
    for (let i = 0; i < 120; i++) doc.edit('linea', () => doc.add({ t: 'line', a: v(i, 0), b: v(i, 1), layer: '0' }));
    doc.beginBlockEdit('sedia');
    doc.edit('dentro', () => doc.add({ t: 'line', a: v(0, 0), b: v(1, 1), layer: '0' }));
    expect(doc.undo()).toBe('dentro');
    doc.edit('dentro', () => doc.add({ t: 'line', a: v(0, 0), b: v(1, 1), layer: '0' }));
    doc.endBlockEdit(true);
    const n = doc.ents.length;
    doc.undo();
    expect(doc.ents.length).toBe(n);
    doc.undo();
    expect(doc.ents.length).toBe(n - 1);
  });
  it('un blocco non può finire dentro se stesso', () => {
    const doc = make();
    doc.beginBlockEdit('sedia');
    doc.edit('x', () => doc.add({ t: 'insert', name: 'sedia', p: v(0, 0), s: 1, rot: 0, layer: '0' }));
    expect(doc.endBlockEdit(true)).toBe(1);
    expect(doc.blocks.sedia.ents.some(e => e.t === 'insert')).toBe(false);
  });
  it('rinomina e pulizia dei blocchi non usati', () => {
    const doc = make();
    expect(doc.unusedBlocks()).toEqual(['vuoto']);
    doc.edit('Rinomina', () => doc.renameBlock('sedia', 'poltrona'));
    expect((doc.ents[0] as InsertE).name).toBe('poltrona');
    expect(Object.keys(doc.blocks).sort()).toEqual(['poltrona', 'vuoto']);
    expect(prims(doc.ents[0], doc.ctx()).length).toBe(1);
  });
  it('eliminare un layer sposta sul layer 0 anche il contenuto dei blocchi', () => {
    const doc = make();
    doc.edit('t', () => {
      doc.blocks = { ...doc.blocks, sedia: { ents: [{ ...L(1, 0, 0, 10, 0), layer: 'ARREDI' }] } };
      doc.add({ t: 'line', a: v(0, 0), b: v(1, 0), layer: 'ARREDI' });
      doc.current = 'ARREDI';
    });
    expect(doc.layerUse('ARREDI')).toBe(2);
    doc.edit('Elimina layer', () => doc.deleteLayer('ARREDI'));
    expect(doc.layers.some(l => l.name === 'ARREDI')).toBe(false);
    expect(doc.blocks.sedia.ents[0].layer).toBe('0');
    expect(doc.current).toBe('0');
    expect(doc.ents.every(e => e.layer !== 'ARREDI')).toBe(true);
  });
  it('disegnare su un layer nascosto viene annotato', () => {
    const doc = make();
    doc.edit('t', () => { doc.layer('MURI').visible = false; });
    doc.edit('Muro', () => doc.add({ t: 'wall', a: v(0, 0), b: v(1, 0), th: 1, layer: 'MURI' }));
    expect(doc.hiddenAdds.get('MURI')).toBe(1);
  });
});

describe('spezza, allunga, dividi', () => {
  it('spezza una linea fra due punti e in un punto solo', () => {
    const two = breakEnt(L(1, 0, 0, 100, 0), v(30, 5), v(60, -5))! as LineE[];
    expect(two.map(e => [e.a.x, e.b.x])).toEqual([[0, 30], [60, 100]]);
    const split = breakEnt(L(1, 0, 0, 100, 0), v(40, 0), v(40, 0))! as LineE[];
    expect(split.map(e => [e.a.x, e.b.x])).toEqual([[0, 40], [40, 100]]);
    expect(breakEnt(L(1, 0, 0, 100, 0), v(0, 0), v(0, 0))).toBeNull();
  });
  it('spezza un cerchio: resta l\'arco dal secondo punto al primo', () => {
    const c: CircleE = { id: 1, layer: '0', t: 'circle', c: v(0, 0), r: 10 };
    const [a] = breakEnt(c, v(10, 0), v(0, 10))! as ArcE[];
    close(a.a0, Math.PI / 2);
    close(Math.cos(a.a1), 1);
    expect(breakEnt(c, v(10, 0), v(10, 0))).toBeNull();
  });
  it('spezza una polilinea chiusa in un punto: la apre lì', () => {
    const sq: PolyE = { id: 1, layer: '0', t: 'poly', closed: true, pts: [v(0, 0), v(10, 0), v(10, 10), v(0, 10)] };
    const [p] = breakEnt(sq, v(5, 0), v(5, 0))! as PolyE[];
    expect(p.closed).toBe(false);
    expect(p.pts[0]).toEqual(v(5, 0));
    expect(p.pts[p.pts.length - 1]).toEqual(v(5, 0));
    close(entLength({ ...p, id: 2 } as Ent)!, 40);
  });
  it('allunga dalla parte del clic, di un delta o fino a un totale', () => {
    const l = L(1, 0, 0, 100, 0);
    expect((lengthenEnt(l, v(90, 0), { delta: 20 }) as LineE).b.x).toBe(120);
    expect((lengthenEnt(l, v(10, 0), { delta: 20 }) as LineE).a.x).toBe(-20);
    expect((lengthenEnt(l, v(90, 0), { total: 30 }) as LineE).b.x).toBe(30);
    expect(lengthenEnt(l, v(90, 0), { delta: -100 })).toBeNull();
    const arc: ArcE = { id: 1, layer: '0', t: 'arc', c: v(0, 0), r: 10, a0: 0, a1: Math.PI / 2 };
    close((lengthenEnt(arc, v(0, 10), { total: 10 * Math.PI }) as ArcE).a1, Math.PI);
    expect(lengthenEnt(arc, v(0, 10), { total: 100 })).toBeNull();
  });
  it('spezza un arco partendo dal suo estremo iniziale, o da appena fuori', () => {
    const arc: ArcE = { id: 1, layer: '0', t: 'arc', c: v(0, 0), r: 100, a0: 0, a1: Math.PI / 2 };
    const mid = v(100 * Math.SQRT1_2, 100 * Math.SQRT1_2);
    for (const p1 of [v(100, 0), v(100, -3)]) {
      const [rest] = breakEnt(arc, p1, mid)! as ArcE[];
      close(rest.a0, Math.PI / 4);
      close(rest.a1, Math.PI / 2);
    }
  });
  it('dividi e misura: punti a distanze uguali lungo l\'entità, archi compresi', () => {
    expect(pointsAlong(L(1, 0, 0, 100, 0), { n: 4 })!.map(p => p.x)).toEqual([25, 50, 75]);
    expect(pointsAlong(L(1, 0, 0, 100, 0), { d: 30 })!.map(p => Math.round(p.x))).toEqual([30, 60, 90]);
    const c: CircleE = { id: 1, layer: '0', t: 'circle', c: v(0, 0), r: 10 };
    expect(pointsAlong(c, { n: 4 })!.length).toBe(4);
    const pl: PolyE = { id: 1, layer: '0', t: 'poly', closed: false, pts: [v(0, 0), v(10, 0), v(10, 20)], bulges: [0, 1, 0] };
    // 10 di linea + semicerchio di diametro 20: metà del percorso cade sull'arco
    const total = 10 + Math.PI * 10;
    close(entLength(pl)!, total);
    const [mid] = pointsAlong(pl, { n: 2 })!;
    close(dist(mid, v(10, 10)), 10);
    expect(pointsAlong(L(1, 0, 0, 100, 0), { n: 1 })).toBeNull();
    expect(pointsAlong(L(1, 0, 0, 100, 0), { d: 0 })).toBeNull();
  });
  it('aggiunge e toglie vertici di una polilinea', () => {
    const p: PolyE = { id: 1, layer: '0', t: 'poly', closed: false, pts: [v(0, 0), v(10, 0), v(10, 10)], bulges: [0, 1, 0] };
    const a = polyAddVertex(p, v(4, 1))!;
    expect(a.pts.map(q => q.x)).toEqual([0, 4, 10, 10]);
    expect(a.bulges).toEqual([0, 0, 1, 0]);
    expect(polyAddVertex(p, v(16, 5))).toBeNull(); // sull'arco
    expect(polyAddVertex(p, v(0, 0))).toBeNull(); // su un vertice
    const r = polyRemoveVertex(a, v(4, 0))!;
    expect(r.pts.length).toBe(3);
    expect(r.bulges).toEqual([0, 1, 0]);
    const noArc = polyRemoveVertex(p, v(10, 0))!;
    expect(noArc.pts).toEqual([v(0, 0), v(10, 10)]);
    expect(noArc.bulges).toBeUndefined();
    expect(polyRemoveVertex(noArc, v(0, 0))).toBeNull();
  });
});

describe('ellissi, spline, punti, direttrici', () => {
  const arc: EllipseE = { id: 1, layer: '0', t: 'ellipse', c: v(0, 0), a: v(50, 0), k: 0.5, a0: 0, a1: Math.PI / 2 };
  it('arco di ellisse: aperto, dai due estremi giusti', () => {
    const pts = ellipsePoints(arc);
    expect(pts[0]).toEqual(v(50, 0));
    close(pts[pts.length - 1].x, 0); close(pts[pts.length - 1].y, 25);
    const p = prims(arc)[0] as Extract<Prim, { k: 'pl' }>;
    expect(p.closed).toBe(false);
    expect(snapPoints(arc).filter(s => s.k === 'end').length).toBe(2);
  });
  it('specchiato resta lo stesso arco, allo specchio', () => {
    const m = mirrorAcross(v(0, 0), v(0, 1));
    const r = transform(arc, m);
    const want = ellipsePoints(arc).map(p => v(-p.x, p.y));
    const got = ellipsePoints(r).reverse();
    got.forEach((p, i) => { close(p.x, want[i].x); close(p.y, want[i].y); });
    close(ellipseAt(r, r.a0!).y, 25);
  });
  it('taglia e offset di un\'ellisse danno polilinee', () => {
    const el: EllipseE = { id: 1, layer: '0', t: 'ellipse', c: v(0, 0), a: v(50, 0), k: 0.5 };
    const cut = trimEnt(el, boundaryCurves([L(2, -100, 0, 100, 0)]), v(0, 25))!;
    expect(cut.length).toBe(1);
    expect(cut[0].t).toBe('poly');
    expect((cut[0] as PolyE).pts.every(p => p.y <= 1e-6)).toBe(true);
    const off = offsetEnt(el, 5, v(100, 0)) as PolyE;
    expect(off.t).toBe('poly');
    close(Math.max(...off.pts.map(p => p.x)), 55, 0.05);
    close(Math.max(...off.pts.map(p => p.y)), 30, 0.05);
  });
  it('punto e direttrice si disegnano e si trasformano', () => {
    expect(prims({ id: 1, layer: '0', t: 'point', p: v(5, 5) }).length).toBe(2);
    const ld: LeaderE = { id: 1, layer: 'QUOTE', t: 'leader', pts: [v(0, 0), v(20, 20), v(50, 20)], s: 'pilastro', h: 10 };
    const ps = prims(ld);
    expect(ps.filter(p => p.k === 'pl' && p.fill === 'solid').length).toBe(1);
    const text = ps.find(p => p.k === 'text') as Extract<Prim, { k: 'text' }>;
    expect(text.s).toBe('pilastro');
    expect(text.ha).toBe('l');
    expect(text.p.x).toBeGreaterThan(50);
    const left = prims({ ...ld, pts: [v(0, 0), v(-20, 20), v(-50, 20)] }).find(p => p.k === 'text') as Extract<Prim, { k: 'text' }>;
    expect(left.ha).toBe('r');
    expect(transform(ld, translate(1, 1)).pts[0]).toEqual(v(1, 1));
  });
  it('quote lineari con le frecce', () => {
    const d: DimE = { id: 1, layer: 'QUOTE', t: 'dim', a: v(0, 0), b: v(300, 0), p: v(0, 50) };
    expect(prims(d, { ...DEFAULT_CTX, dimArrow: true }).filter(p => p.k === 'pl' && p.fill === 'solid').length).toBe(2);
    expect(prims(d).filter(p => p.k === 'pl' && p.fill === 'solid').length).toBe(0);
  });
});

describe('snap digitati e puntamento', () => {
  const st: SnapSettings = { osnap: true, modes: new Set(['end', 'mid', 'cen', 'int']), gridSnap: false, ortho: false, polar: false, polarInc: 45, otrack: true };
  const doc = new Doc();
  doc.edit('t', () => { doc.add({ t: 'line', a: v(0, 0), b: v(100, 0), layer: '0' }); });
  it('uno snap digitato vale da solo, e dice se lì non c\'è', () => {
    // vicino alla metà: senza richiesta vince Medio; chiedendo Fine si ha l'estremo più vicino della linea
    expect(findSnap(doc, v(51, 1), 5, st).k).toBe('mid');
    expect(findSnap(doc, v(51, 1), 5, st, undefined, undefined, { only: 'end' }).p).toEqual(v(100, 0));
    // basta essere sulla linea, anche lontano dal punto cercato: MED da un quarto della linea dà il medio
    expect(findSnap(doc, v(20, 2), 5, st, undefined, undefined, { only: 'mid' }).p).toEqual(v(50, 0));
    // PER: il piede della perpendicolare dal punto di partenza, cliccando la linea dove capita
    expect(findSnap(doc, v(80, 1), 5, st, v(30, 40), undefined, { only: 'perp' }).p).toEqual(v(30, 0));
    // lontano da ogni entità, o chiedendo un tipo che la linea non ha, non c'è niente
    expect(findSnap(doc, v(51, 50), 5, st, undefined, undefined, { only: 'end' }).miss).toBe(true);
    expect(findSnap(doc, v(51, 1), 5, st, undefined, undefined, { only: 'cen' }).miss).toBe(true);
    expect(findSnap(doc, v(98, 1), 5, st, undefined, undefined, { only: 'end' }).p).toEqual(v(100, 0));
    // 'near' non è fra i modi attivi, ma richiesto vale
    expect(findSnap(doc, v(30, 2), 5, st, undefined, undefined, { only: 'near' }).p).toEqual(v(30, 0));
    expect(findSnap(doc, v(98, 1), 5, st, undefined, undefined, { only: 'none' }).k).toBeUndefined();
  });
  it('puntamento: allinea in orizzontale e in verticale con i punti acquisiti', () => {
    const acquired = [v(100, 0), v(40, 200)];
    const r = findSnap(doc, v(101, 80), 5, st, undefined, undefined, { acquired });
    expect(r.p).toEqual(v(100, 80));
    expect(r.align).toEqual([v(100, 0)]);
    const both = findSnap(doc, v(102, 198), 5, st, undefined, undefined, { acquired });
    expect(both.p).toEqual(v(100, 200));
    expect(findSnap(doc, v(150, 80), 5, st, undefined, undefined, { acquired }).align).toBeUndefined();
    expect(findSnap(doc, v(101, 80), 5, { ...st, otrack: false }, undefined, undefined, { acquired }).align).toBeUndefined();
  });
  it('puntamento lungo una direzione polare: il punto in verticale sotto quello acquisito', () => {
    const r = findSnap(doc, v(99, 301), 5, { ...st, polar: true, polarInc: 90 }, v(0, 300), undefined, { acquired: [v(100, 0)] });
    expect(r.p.x).toBeCloseTo(100, 9);
    expect(r.p.y).toBeCloseTo(300, 9);
    expect(r.align).toEqual([v(100, 0)]);
  });
});

describe('blocchi dei file importati', () => {
  const raw = (ins: Record<string, unknown>) => ({
    ents: [{ type: 'INSERT', layer: 'ARREDI', name: 'SEDIA', p: v(100, 50), sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, colSp: 0, rowSp: 0, attribs: [], ...ins }],
    blocks: new Map([['SEDIA', { base: v(5, 0), ents: [{ type: 'LINE', layer: '0', a: v(5, 0), b: v(25, 0) }, { type: 'INSERT', layer: '0', name: 'GAMBA', p: v(5, 0), sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, colSp: 0, rowSp: 0, attribs: [] }] }],
      ['GAMBA', { base: v(0, 0), ents: [{ type: 'CIRCLE', layer: 'DETTAGLI', c: v(0, 0), r: 2 }] }]]),
    layers: [], insUnits: 4,
  }) as unknown as Parameters<typeof buildImport>[0];
  const flat = (r: ReturnType<typeof buildImport>) => r.ents.flatMap(e => prims({ ...e, id: 1 } as Ent, { ...DEFAULT_CTX, blocks: r.blocks }));

  it('un inserimento semplice resta un blocco, con la definizione convertita di unità', () => {
    const r = buildImport(raw({}), 'cm');
    expect(r.ents.length).toBe(1);
    const ins = r.ents[0] as InsertE;
    expect(ins.t).toBe('insert');
    expect(ins.p).toEqual(v(10, 5));
    expect(ins.s).toBe(1);
    expect(Object.keys(r.blocks).sort()).toEqual(['GAMBA', 'SEDIA']);
    const line = r.blocks.SEDIA.ents[0] as LineE;
    expect(line.a).toEqual(v(0, 0));
    close(line.b.x, 2);
    expect(r.layers.map(l => l.name)).toContain('DETTAGLI');
    // disegnato: la linea parte dal punto di inserimento
    const ps = flat(r);
    expect((ps[0] as Extract<Prim, { k: 'pl' }>).pts[0]).toEqual(v(10, 5));
    expect(importSize(r)!.w).toBeCloseTo(22, 6);
  });
  it('scala, rotazione e specchio dell\'inserimento', () => {
    const r = buildImport(raw({ sx: -2, sy: 2, rot: Math.PI / 2 }), 'mm');
    const ins = r.ents[0] as InsertE;
    expect(ins.s).toBe(2);
    expect(ins.flip).toBe(true);
    const pl = flat(r)[0] as Extract<Prim, { k: 'pl' }>;
    // la linea del blocco va verso +X; specchiata va verso -X, ruotata di 90° va verso -Y, lunga 40
    close(pl.pts[1].x, 100); close(pl.pts[1].y, 50 - 40);
  });
  it('un inserimento con un colore suo, o di un blocco vuoto, non diventa un blocco', () => {
    const colored = buildImport(raw({ colorIndex: 3 }), 'mm');
    expect(colored.ents.some(e => e.t === 'insert' && e.name === 'SEDIA')).toBe(false);
    const d = raw({});
    (d.blocks as Map<string, { base: unknown; ents: unknown[] }>).get('SEDIA')!.ents = [];
    const empty = buildImport(d, 'mm');
    expect(empty.ents.length).toBe(0);
    expect(empty.blocks.SEDIA).toBeUndefined();
  });
  it('scala diversa nei due versi, serie o attributi: si apre in entità raggruppate', () => {
    for (const ins of [{ sx: 2, sy: 1 }, { cols: 2, colSp: 50 }]) {
      const r = buildImport(raw(ins), 'mm');
      expect(r.ents.every(e => e.t !== 'insert' || e.name === 'GAMBA')).toBe(true);
      expect(r.ents.every(e => e.g !== undefined)).toBe(true);
    }
  });
  it('rileggere il file in un\'altra unità riscala una volta sola', () => {
    const r = rescaleImport(buildImport(raw({}), 'cm'), 'm', 'cm');
    expect((r.ents[0] as InsertE).p).toEqual(v(10000, 5000));
    expect((r.ents[0] as InsertE).s).toBe(1);
    close((r.blocks.SEDIA.ents[0] as LineE).b.x, 2000);
    expect((r.blocks.SEDIA.ents[1] as InsertE).s).toBe(1);
  });
});

describe('tipo di linea e spessore per singola entità', () => {
  it('la stampa usa quelli dell\'entità, il DXF porta il tipo di linea', () => {
    const doc = new Doc();
    doc.edit('t', () => {
      doc.add({ t: 'line', a: v(0, 0), b: v(100, 0), layer: '0' });
      doc.add({ t: 'line', a: v(0, 10), b: v(100, 10), layer: '0', lt: 'dashed', lw: 0.7 });
    });
    const opts = { paper: 'A4', landscape: true, scale: 100, area: doc.extents()!, title: false, mono: true, lineweights: true, wallFill: 'nero', fields: {} } as unknown as Parameters<typeof buildSheet>[1];
    const svg = buildSheet(doc, opts).svg;
    expect((svg.match(/stroke-dasharray/g) ?? []).length).toBe(1);
    expect(svg).toContain('stroke-width="0.7"');
    expect(exportDxf(doc)).toMatch(/\r\n6\r\nDASHED\r\n/);
    expect(TAU).toBeGreaterThan(6);
  });
});

// ---------------------------------------------------------------- richieste della mail: raccordo, retini, immagini
import { cornerPoly, filletPolyAll } from '../src/model/ops';
import type { HatchE, ImageE } from '../src/model/entities';
import { imageCorners, HATCH_NAMES, HATCH_TILES } from '../src/model/entities';
import { polygonArea } from '../src/model/geom';

describe('raccordo e smusso sugli spigoli di una polilinea', () => {
  const rect: PolyE = { id: 1, layer: '0', t: 'poly', closed: true, pts: [v(0, 0), v(100, 0), v(100, 60), v(0, 60)] };
  it('raccorda lo spigolo di un rettangolo fra i due lati indicati', () => {
    const r = cornerPoly(rect, v(50, 0), v(100, 30), { r: 10 })!;
    expect(r.pts.length).toBe(5);
    expect(r.pts[1]).toEqual(v(90, 0));
    close(r.pts[2].x, 100); close(r.pts[2].y, 10);
    // quarto di cerchio antiorario
    close(r.bulges![1], Math.tan(Math.PI / 8));
    expect(r.closed).toBe(true);
    // l'area cala di r²(1 - π/4)
    close(entLength(r)!, 320 - 20 + (Math.PI * 10) / 2);
  });
  it('vale anche indicando i lati nell\'altro ordine, e sullo spigolo di chiusura', () => {
    const a = cornerPoly(rect, v(100, 30), v(50, 0), { r: 10 })!;
    expect(a.pts[1]).toEqual(v(90, 0));
    const wrap = cornerPoly(rect, v(0, 30), v(50, 0), { r: 10 })!;
    expect(wrap.pts.length).toBe(5);
    close(wrap.pts[0].x, 0); close(wrap.pts[0].y, 10);
    close(wrap.pts[1].x, 10); close(wrap.pts[1].y, 0);
  });
  it('rifiuta lati non consecutivi, raggi che non ci stanno e tratti ad arco', () => {
    expect(cornerPoly(rect, v(50, 0), v(50, 60), { r: 10 })).toBeNull();
    expect(cornerPoly(rect, v(50, 0), v(100, 30), { r: 70 })).toBeNull();
    const open: PolyE = { id: 1, layer: '0', t: 'poly', closed: false, pts: [v(0, 0), v(100, 0), v(100, 60)], bulges: [0, 1, 0] };
    expect(cornerPoly(open, v(50, 0), v(130, 30), { r: 5 })).toBeNull();
  });
  it('smusso con due distanze diverse: la prima sul primo lato indicato', () => {
    const r = cornerPoly(rect, v(50, 0), v(100, 30), { d1: 20, d2: 5 })!;
    expect(r.pts[1]).toEqual(v(80, 0));
    expect(r.pts[2]).toEqual(v(100, 5));
    expect(r.bulges).toBeUndefined();
    const s = cornerPoly(rect, v(100, 30), v(50, 0), { d1: 20, d2: 5 })!;
    expect(s.pts[1]).toEqual(v(95, 0));
    expect(s.pts[2]).toEqual(v(100, 20));
  });
  it('polilinea intera: tutti e quattro gli spigoli, o solo quelli in cui ci sta', () => {
    const all = filletPolyAll(rect, 10)!;
    expect(all.n).toBe(4);
    expect(all.poly.pts.length).toBe(8);
    close(entLength(all.poly)!, 320 - 80 + 2 * Math.PI * 10);
    // raggio 30 su lati da 60: due raccordi sullo stesso lato corto non ci stanno, e nessuno viene favorito
    expect(filletPolyAll(rect, 30)).toBeNull();
    const sq: PolyE = { ...rect, pts: [v(0, 0), v(100, 0), v(100, 100), v(0, 100)] };
    expect(filletPolyAll(sq, 50)).toBeNull();
    expect(filletPolyAll(sq, 49)!.n).toBe(4);
    expect(filletPolyAll(rect, 29)!.n).toBe(4);
    expect(filletPolyAll(rect, 0)).toBeNull();
    const open: PolyE = { id: 1, layer: '0', t: 'poly', closed: false, pts: [v(0, 0), v(100, 0), v(100, 60)] };
    expect(filletPolyAll(open, 10)!.n).toBe(1);
  });
});

describe('retini', () => {
  const sq = [v(0, 0), v(100, 0), v(100, 100), v(0, 100)];
  const lines = (pat: HatchE['pat'], ang = 0) => prims({ id: 1, layer: '0', t: 'hatch', loops: [sq], pat, sp: 10, ang }).filter(p => p.k === 'pl') as Extract<Prim, { k: 'pl' }>[];
  const lenOf = (ps: Extract<Prim, { k: 'pl' }>[]) => ps.reduce((s, p) => s + dist(p.pts[0], p.pts[1]), 0);
  it('ogni retino ha un nome e disegna qualcosa dentro il contorno', () => {
    for (const pat of Object.keys(HATCH_NAMES) as HatchE['pat'][]) {
      if (pat === 'solid') continue;
      const ps = lines(pat);
      expect(ps.length).toBeGreaterThan(5);
      for (const p of ps) for (const q of p.pts) { expect(q.x).toBeGreaterThan(-1e-6); expect(q.x).toBeLessThan(100 + 1e-6); expect(q.y).toBeGreaterThan(-1e-6); expect(q.y).toBeLessThan(100 + 1e-6); }
    }
  });
  it('quadretti: righe orizzontali e verticali; mattoni: giunti verticali alterni', () => {
    // una riga ogni 10 su 100 di altezza: 9 dentro, più quelle sul bordo se capitano
    const L1 = lenOf(lines('lines'));
    expect(L1).toBeGreaterThanOrEqual(900 - 1e-6);
    expect(L1).toBeLessThanOrEqual(1100 + 1e-6);
    expect(lines('lines').every(p => Math.abs(p.pts[0].y - p.pts[1].y) < 1e-9)).toBe(true);
    // le verticali sono altrettante, salvo quelle che cadono proprio sul bordo
    expect(Math.abs(lenOf(lines('grid')) - 2 * L1)).toBeLessThanOrEqual(200 + 1e-6);
    const brick = lines('brick');
    const joints = brick.filter(p => Math.abs(p.pts[0].x - p.pts[1].x) < 1e-9);
    expect(joints.length).toBeGreaterThan(20);
    // ogni giunto è alto un corso, e in corsi vicini i giunti stanno su verticali diverse
    for (const j of joints) close(Math.abs(j.pts[0].y - j.pts[1].y), 10);
    const xs = (y: number) => joints.filter(j => Math.min(j.pts[0].y, j.pts[1].y) === y).map(j => j.pts[0].x).sort((a, b) => a - b);
    expect(xs(0).some(x => xs(10).includes(x))).toBe(false);
  });
  it('un retino a tratti su un\'area enorme non genera milioni di trattini', () => {
    const big = [v(0, 0), v(6000, 0), v(6000, 6000), v(0, 6000)];
    for (const pat of ['dots', 'brick', 'dash', 'herring'] as const) {
      expect(prims({ id: 1, layer: '0', t: 'hatch', loops: [big], pat, sp: 2, ang: 0 }).length).toBeLessThan(100000);
    }
  });
  it('tratteggiate e puntinato sono a tratti; l\'angolo ruota il retino; il passo lo scala', () => {
    expect(lenOf(lines('dash'))).toBeLessThan(lenOf(lines('ansi31')) * 0.8);
    expect(lenOf(lines('dots'))).toBeLessThan(lenOf(lines('lines')) * 0.2);
    const rot = lines('lines', Math.PI / 2);
    expect(rot.every(p => Math.abs(p.pts[0].x - p.pts[1].x) < 1e-6)).toBe(true);
    const big: HatchE = { id: 1, layer: '0', t: 'hatch', loops: [sq], pat: 'lines', sp: 25, ang: 0 };
    const n = prims(big).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
  });
});

describe('immagini', () => {
  const im: ImageE = { id: 1, layer: '0', t: 'image', p: v(10, 20), w: 200, h: 100, rot: 0, src: 'data:image/png;base64,AAAA' };
  it('occupa il suo rettangolo e si seleziona dal contorno, che però non si stampa', () => {
    expect(imageCorners(im)).toEqual([v(10, 20), v(210, 20), v(210, 120), v(10, 120)]);
    const ps = prims(im);
    expect(ps[0].k).toBe('img');
    expect((ps[1] as Extract<Prim, { k: 'pl' }>).stroke).toBe(false);
    expect(boundaryCurves([im]).length).toBe(0);
    expect(snapPoints(im).length).toBe(4);
  });
  it('ruotata, scalata e specchiata resta nel rettangolo giusto', () => {
    const r = transform(im, rotateAbout(v(10, 20), Math.PI / 2));
    close(imageCorners(r)[2].x, -90); close(imageCorners(r)[2].y, 220);
    const m = transform(im, mirrorAcross(v(0, 0), v(0, 1)));
    const xs = imageCorners(m).map(q => q.x), ys = imageCorners(m).map(q => q.y);
    close(Math.min(...xs), -210); close(Math.max(...xs), -10);
    close(Math.min(...ys), 20); close(Math.max(...ys), 120);
    close(Math.abs(polygonArea(imageCorners(m))), 20000);
  });
  it('va in stampa come immagine, non nel DXF', () => {
    const doc = new Doc();
    doc.edit('t', () => { doc.add({ ...im, id: undefined }); doc.add({ t: 'line', a: v(0, 0), b: v(300, 0), layer: '0' }); });
    const opts = { paper: 'A4', landscape: true, scale: 100, area: doc.extents()!, title: true, mono: true, lineweights: true, wallFill: 'nero', fields: { cliente: '', posa: '', note: '' }, logo: 'data:image/png;base64,BBBB' } as unknown as Parameters<typeof buildSheet>[1];
    const svg = buildSheet(doc, opts).svg;
    expect((svg.match(/<image /g) ?? []).length).toBe(2);
    expect(svg).toContain('data:image/png;base64,AAAA');
    expect(svg).toContain('data:image/png;base64,BBBB');
    expect(exportDxf(doc)).not.toContain('AAAA');
    expect(JSON.parse(JSON.stringify(doc.toData())).ents[0].src).toBe(im.src);
  });
});

// ---- versione 0.4.3: grip dei blocchi, quote sui fili dei muri, retini nuovi e muri con retino
import { grips, moveGrip, explode } from '../src/model/entities';
import { buildWallCtx } from '../src/model/walls';
import { scaleAbout } from '../src/model/geom';

describe('grip dei blocchi inseriti', () => {
  const rect = (x: number, y: number): PolyE => ({ id: 1, layer: '0', t: 'poly', pts: [v(x, y), v(x + 80, y), v(x + 80, y + 60), v(x, y + 60)], closed: true });
  const blocks = { sedia: { ents: [rect(500, 300)] }, tavolo: { ents: [rect(0, 0)] } };
  const ctx = { ...DEFAULT_CTX, blocks };
  const ins = (x: number, y: number): InsertE => ({ id: 9, layer: '0', t: 'insert', name: 'sedia', p: v(x, y), s: 1, rot: 0 });
  it('punto base lontano dal disegno del blocco: c\'è anche un grip al centro, e sposta il blocco', () => {
    const e = ins(0, 0);
    expect(grips(e, ctx)).toEqual([v(0, 0), v(540, 330)]);
    expect((moveGrip(e, 1, v(640, 330), ctx) as InsertE).p).toEqual(v(100, 0));
    expect((moveGrip(e, 0, v(20, 30), ctx) as InsertE).p).toEqual(v(20, 30));
  });
  it('punto base sul disegno del blocco: basta quello', () => {
    expect(grips({ ...ins(100, 50), name: 'tavolo' }, ctx)).toEqual([v(100, 50)]);
    // senza sapere com'è fatto il blocco c'è solo il punto base
    expect(grips(ins(0, 0))).toEqual([v(0, 0)]);
    // un blocco senza definizione ha comunque il suo punto
    expect(grips({ ...ins(5, 5), name: 'manca' }, ctx)).toEqual([v(5, 5)]);
  });
});

describe('muri: snap sugli spigoli e riempimento con retino', () => {
  const st: SnapSettings = { osnap: true, modes: new Set(['end', 'mid']), gridSnap: false, ortho: false, polar: false, polarInc: 45, otrack: false };
  const room = () => {
    const doc = new Doc();
    doc.edit('t', () => {
      doc.add({ t: 'wall', a: v(0, 0), b: v(400, 0), th: 30, layer: 'MURI' });
      doc.add({ t: 'wall', a: v(400, 0), b: v(400, 300), th: 30, layer: 'MURI' });
      doc.add({ t: 'wall', a: v(400, 300), b: v(0, 300), th: 30, layer: 'MURI' });
      doc.add({ t: 'wall', a: v(0, 300), b: v(0, 0), th: 30, layer: 'MURI' });
      doc.add({ t: 'wall', a: v(600, 0), b: v(900, 0), th: 30, layer: 'MURI' });
    });
    return doc;
  };
  const near = (p: { x: number; y: number }, x: number, y: number) => { close(p.x, x); close(p.y, y); };
  it('dove due muri fanno angolo, fra asse e spigolo vince lo spigolo; sull\'asse si aggancia ancora l\'asse', () => {
    const doc = room();
    // a metà strada fra la fine dell'asse (0,0) e lo spigolo interno (15,15), e poi quello esterno
    near(findSnap(doc, v(7, 7), 30, st).p, 15, 15);
    near(findSnap(doc, v(-7, -7), 30, st).p, -15, -15);
    near(findSnap(doc, v(1, 1), 30, st).p, 0, 0);
    // un muro che finisce libero: la fine dell'asse è il mezzo della testata, e vale come gli spigoli
    near(findSnap(doc, v(601, 6), 30, st).p, 600, 0);
  });
  it('un muro con il retino si disegna a righe, che non fanno da bordo, da snap né da pezzi esplosi', () => {
    const plain: WallE = { id: 1, layer: 'MURI', t: 'wall', a: v(0, 0), b: v(300, 0), th: 30 };
    const pat: WallE = { ...plain, pat: 'ansi31' };
    const ctx = { ...DEFAULT_CTX, walls: buildWallCtx([pat]) };
    const pls = (e: WallE) => prims(e, ctx).filter(p => p.k === 'pl') as Extract<Prim, { k: 'pl' }>[];
    expect(pls(plain).some(p => p.fill === 'wall')).toBe(true);
    const ps = pls(pat);
    expect(ps.some(p => p.fill === 'wall')).toBe(false);
    expect(ps.filter(p => p.fill === 'hit').length).toBe(1);
    const deco = ps.filter(p => p.deco);
    // passo predefinito = un terzo dello spessore: righe a 45° ogni 10, cioè una ogni 14 lungo il muro di 300
    expect(deco.length).toBeGreaterThan(20);
    for (const p of deco) for (const q of p.pts) { expect(Math.abs(q.y)).toBeLessThan(15 + 1e-6); expect(q.x).toBeGreaterThan(-1e-6); expect(q.x).toBeLessThan(300 + 1e-6); }
    expect(pls({ ...pat, sp: 30 }).filter(p => p.deco).length).toBeLessThan(deco.length / 2);
    expect(boundaryCurves([pat], ctx).length).toBe(boundaryCurves([plain], ctx).length);
    expect(snapPoints(pat, ctx).length).toBe(snapPoints(plain, ctx).length);
    expect(explode(pat, ctx)!.length).toBe(explode(plain, ctx)!.length);
    // scalando il muro si scala anche il passo scelto a mano
    expect((transform({ ...pat, sp: 6 }, scaleAbout(v(0, 0), 0.01)) as WallE).sp).toBeCloseTo(0.06);
    expect((transform(pat, scaleAbout(v(0, 0), 0.01)) as WallE).sp).toBeUndefined();
  });
  it('in stampa il muro con il retino esce a righe anche con i muri pieni neri, e nel DXF le righe ci sono', () => {
    const mk = (withPat: boolean) => {
      const doc = new Doc();
      doc.edit('t', () => { doc.add({ t: 'wall', a: v(0, 0), b: v(300, 0), th: 30, layer: 'MURI', ...(withPat ? { pat: 'ansi31' as const } : {}) }); });
      return doc;
    };
    const opts = (doc: Doc) => ({ paper: 'A4', landscape: true, scale: 100, area: doc.extents()!, title: false, mono: true, lineweights: true, wallFill: 'nero', fields: { cliente: '', posa: '', note: '' } }) as unknown as Parameters<typeof buildSheet>[1];
    const a = mk(false), b = mk(true);
    const paths = (doc: Doc) => buildSheet(doc, opts(doc)).svg.match(/<path [^>]*>/g) ?? [];
    expect(paths(a).some(p => p.includes('fill="#000"'))).toBe(true);
    expect(paths(b).some(p => p.includes('fill="#000"'))).toBe(false);
    expect(paths(b).length).toBeGreaterThan(paths(a).length + 15);
    const dxfLines = (doc: Doc) => (exportDxf(doc).match(/^LINE\r?$/gm) ?? []).length;
    expect(dxfLines(b)).toBeGreaterThan(dxfLines(a) + 15);
  });
});

describe('retini nuovi', () => {
  type PL = Extract<Prim, { k: 'pl' }>;
  const sq = [v(0, 0), v(240, 0), v(240, 240), v(0, 240)];
  const lines = (pat: HatchE['pat'], ang = 0) => prims({ id: 1, layer: '0', t: 'hatch', loops: [sq], pat, sp: 10, ang }).filter(p => p.k === 'pl') as PL[];
  const dirOf = (p: PL) => Math.round(((Math.atan2(p.pts[1].y - p.pts[0].y, p.pts[1].x - p.pts[0].x) * 180) / Math.PI + 360) % 180) % 180;
  const dirs = (ps: PL[]) => [...new Set(ps.map(dirOf))].sort((a, b) => a - b);
  const inside = (p: PL) => p.pts.every(q => q.x > 1 && q.x < 239 && q.y > 1 && q.y < 239);
  it('doppie linee: il doppio delle righe del 45°', () => {
    expect(Math.abs(lines('ansi32').length - 2 * lines('ansi31').length)).toBeLessThanOrEqual(2);
    expect(dirs(lines('ansi32'))).toEqual([45]);
  });
  it('spina di pesce: lati di listelli lunghi quattro passi e larghi uno, nei due versi a 45°; girata di 45° ha i lati dritti', () => {
    const ps = lines('herring');
    expect(dirs(ps)).toEqual([45, 135]);
    const inner = ps.filter(inside);
    expect(inner.length).toBeGreaterThan(20);
    for (const p of inner) expect([10, 40].some(L => Math.abs(dist(p.pts[0], p.pts[1]) - L) < 1e-6)).toBe(true);
    expect(dirs(lines('herring', Math.PI / 4))).toEqual([0, 90]);
  });
  it('spina di pesce: i listelli coprono il piano senza buchi e senza sovrapporsi', () => {
    const t = HATCH_TILES.herring!;
    // ogni punto (preso a caso, lontano dai bordi dei listelli) sta in un solo listello della griglia
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40 - 20;
    for (let n = 0; n < 400; n++) {
      const x = rnd() + 1e-3, y = rnd() + 2e-3;
      let hits = 0;
      for (let p = -30; p <= 30; p++) for (let q = -30; q <= 30; q++) {
        const ox = p * t.a[0] + q * t.b[0], oy = p * t.a[1] + q * t.b[1];
        for (const [x0, y0, x1, y1] of t.rects) if (x > ox + x0 && x < ox + x1 && y > oy + y0 && y < oy + y1) hits++;
      }
      expect(hits).toBe(1);
    }
  });
  it('listoni: giunti verticali alti un corso, a sei passi l\'uno dall\'altro e sfalsati fra corsi vicini', () => {
    const joints = lines('plank').filter(p => Math.abs(p.pts[0].x - p.pts[1].x) < 1e-9);
    expect(joints.length).toBeGreaterThan(15);
    for (const j of joints) close(Math.abs(j.pts[0].y - j.pts[1].y), 10);
    const xs = (y: number) => joints.filter(j => Math.abs(Math.min(j.pts[0].y, j.pts[1].y) - y) < 1e-6).map(j => Math.round(j.pts[0].x)).sort((a, b) => a - b);
    const row = xs(30);
    expect(row.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < row.length; i++) expect(row[i] - row[i - 1]).toBe(60);
    expect(row.some(x => xs(40).includes(x))).toBe(false);
    expect(xs(60)).toEqual(row);
  });
  it('zig-zag: i due versi si incontrano sulle punte', () => {
    const ps = lines('zigzag');
    expect(dirs(ps)).toEqual([45, 135]);
    const key = (q: { x: number; y: number }) => `${Math.round(q.x * 1000)}:${Math.round(q.y * 1000)}`;
    const up = new Set(ps.filter(p => dirOf(p) === 45).flatMap(p => p.pts.map(key)));
    const down = ps.filter(p => dirOf(p) === 135 && inside(p));
    expect(down.length).toBeGreaterThan(10);
    for (const p of down) for (const q of p.pts) expect(up.has(key(q))).toBe(true);
  });
});

describe('muri con il retino: si tiene modificandoli', () => {
  const w: WallE = { id: 1, layer: 'MURI', t: 'wall', a: v(0, 0), b: v(400, 0), th: 30, pat: 'brick', sp: 5 };
  it('offset, spezza e taglia nel mezzo danno muri con lo stesso retino', () => {
    const off = offsetEnt(w, 100, v(200, 200)) as WallE;
    expect([off.pat, off.sp]).toEqual(['brick', 5]);
    const pieces = breakEnt(w, v(100, 0), v(200, 0)) as WallE[];
    expect(pieces.length).toBe(2);
    for (const p of pieces) expect([p.pat, p.sp]).toEqual(['brick', 5]);
    const cutters: Ent[] = [L(2, 150, -50, 150, 50), L(3, 250, -50, 250, 50)];
    const cut = trimEnt(w, boundaryCurves(cutters), v(200, 0)) as WallE[];
    expect(cut.length).toBe(2);
    for (const p of cut) expect([p.pat, p.sp]).toEqual(['brick', 5]);
    // un muro senza retino resta senza
    const { pat: _p, sp: _s, ...bare } = w;
    expect((offsetEnt(bare, 100, v(200, 200)) as WallE).pat).toBeUndefined();
  });
  it('un muro pieno è un riempimento: esplodendolo o esportandolo non nasce un contorno in più', () => {
    const { pat: _p, sp: _s, ...plain } = w;
    const solid: WallE = { ...plain, pat: 'solid' };
    expect(explode(solid, DEFAULT_CTX)!.map(e => e.t)).toEqual(explode(plain, DEFAULT_CTX)!.map(e => e.t));
    expect(prims(solid).some(p => p.k === 'pl' && p.fill === 'solid')).toBe(true);
  });
});

describe('snap sui fili di muri, porte e finestre', () => {
  const st: SnapSettings = { osnap: true, modes: new Set(['end', 'mid']), gridSnap: false, ortho: false, polar: false, polarInc: 45, otrack: false };
  const doc = new Doc();
  doc.edit('t', () => {
    // muro da 30 sull'asse y = 0, da x = 0 a 400, con un muro che sale dall'angolo in x = 400
    doc.add({ t: 'wall', a: v(0, 0), b: v(400, 0), th: 30, layer: 'MURI' });
    doc.add({ t: 'wall', a: v(400, 0), b: v(400, 300), th: 30, layer: 'MURI' });
    doc.add({ t: 'door', p: v(100, 0), ang: 0, w: 80, th: 30, sw: 1, hg: 1, layer: 'SERRAMENTI' });
  });
  const at = (x: number, y: number, only?: 'mid' | 'end') => findSnap(doc, v(x, y), 12, st, undefined, undefined, only ? { only } : {}).p;
  const near = (p: { x: number; y: number }, x: number, y: number) => { close(p.x, x); close(p.y, y); };
  it('il medio di un muro c\'è su tutti e due i fili, da spigolo a spigolo; quello dell\'asse resta per chi ci va sopra', () => {
    // filo interno da (0,15) a (385,15), filo esterno da (0,-15) a (415,-15)
    near(at(195, 10), 192.5, 15);
    near(at(205, -10), 207.5, -15);
    near(at(200, 1), 200, 0);
    // MED digitato: basta essere sul muro, e si ha il medio più vicino al cursore
    near(at(150, 14, 'mid'), 192.5, 15);
    near(at(250, -14, 'mid'), 207.5, -15);
  });
  it('porte e finestre: medio e spigoli del vano su tutti e due i fili', () => {
    near(at(101, 12), 100, 15);
    near(at(99, -12), 100, -15);
    near(at(141, 13), 140, 15);
    near(at(59, -13), 60, -15);
  });
});
