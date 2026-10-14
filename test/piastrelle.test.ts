// Piastrelle (pose, fughe in pianta, computo) e altezze per la vista 3D.
import { describe, it, expect } from 'vitest';
import type { RoomE, DoorE, WindowE, Tiles, TileLay, WallE, PolyE } from '../src/model/entities';
import { prims, transform, floorJoints } from '../src/model/entities';
import { tileGrid, layGrid, gridRects, roomSides, claddingArea, quantity, roomFloorArea, openingSpan } from '../src/model/tiles';
import { Doc } from '../src/model/document';
import { v, scaleAbout, rotateAbout, polygonArea } from '../src/model/geom';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const tile = (lay: TileLay, l = 60, w = 30, j = 0.3): Tiles => ({ l, w, j, lay, color: '#cccccc' });

describe('pose delle piastrelle', () => {
  /** Ogni punto preso a caso sta in un solo rettangolo della griglia (né buchi né sovrapposizioni). */
  const covers = (lay: TileLay, L: number, W: number) => {
    const g = layGrid(lay, L, W);
    const quads = gridRects(g, { x0: -200, y0: -200, x1: 200, y1: 200 }, v(13, -7), 1e6)!;
    const inside = (q: { x: number; y: number }[], p: { x: number; y: number }) => {
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0) return false;
      }
      return true;
    };
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 300 - 150;
    for (let n = 0; n < 300; n++) {
      const p = v(rnd() + 1e-4, rnd() + 2e-4);
      expect(quads.filter(q => inside(q, p)).length).toBe(1);
    }
  };
  for (const lay of ['grid', 'half', 'third', 'diag', 'herring'] as TileLay[]) {
    it(`${lay}: le piastrelle coprono il pavimento senza buchi né sovrapposizioni`, () => {
      covers(lay, 60.3, 30.3);
      covers(lay, 120.2, 20.2);
      covers(lay, 60.3, 60.3);
    });
  }
  it('le celle comprendono la fuga, e il lato lungo è sempre il primo', () => {
    const g = tileGrid({ l: 30, w: 60, j: 0.5, lay: 'grid' });
    expect(g.rects[0]).toEqual([0, 0, 60.5, 30.5]);
  });
  it('in pianta: le fughe di un pavimento 60x30 dritto in una stanza 300x240, dall\'angolo in basso a sinistra', () => {
    const pts = [v(0, 0), v(300, 0), v(300, 240), v(0, 240)];
    const lines = floorJoints(pts, tile('grid', 60, 30, 0));
    // dentro la stanza: 4 verticali (60, 120, 180, 240) e 7 orizzontali (30…210), più i bordi
    const vert = lines.filter(p => p.k === 'pl' && Math.abs(p.pts[0].x - p.pts[1].x) < 1e-9 && p.pts[0].x > 1 && p.pts[0].x < 299);
    const hor = lines.filter(p => p.k === 'pl' && Math.abs(p.pts[0].y - p.pts[1].y) < 1e-9 && p.pts[0].y > 1 && p.pts[0].y < 239);
    expect(new Set(vert.map(p => p.k === 'pl' ? p.pts[0].x : 0))).toEqual(new Set([60, 120, 180, 240]));
    expect(new Set(hor.map(p => p.k === 'pl' ? p.pts[0].y : 0)).size).toBe(7);
    expect(lines.every(p => p.k === 'pl' && p.deco)).toBe(true);
    // il locale con il pavimento le disegna, e restano decorazione (niente snap, niente bordi)
    const room: RoomE = { id: 1, layer: 'LOCALI', t: 'room', pts, name: 'Bagno', floor: tile('grid', 60, 30, 0) };
    expect(prims(room).filter(p => p.k === 'pl' && p.deco).length).toBe(lines.length);
  });
});

describe('computo di pavimenti e rivestimenti', () => {
  // bagno 300 x 240 (misure interne), muri da 30 con l'asse a 15 dal filo
  const room: RoomE = { id: 1, layer: 'LOCALI', t: 'room', pts: [v(0, 0), v(300, 0), v(300, 240), v(0, 240)], name: 'Bagno' };
  const hs = { wallH: 270, doorH: 210, winSill: 90, winH: 140 };
  // porta sul lato in basso (asse del muro a y = -15), finestra sul lato destro (asse a x = 315)
  const door: DoorE = { id: 2, layer: 'SERRAMENTI', t: 'door', p: v(100, -15), ang: 0, w: 80, th: 30, sw: 1, hg: 1 };
  const win: WindowE = { id: 3, layer: 'SERRAMENTI', t: 'window', p: v(315, 120), ang: Math.PI / 2, w: 100, th: 30 };
  it('le pareti del locale e i vani che ci cadono', () => {
    const sides = roomSides(room, [door, win], o => o.th, hs);
    expect(sides.length).toBe(4);
    expect(sides[0].holes).toEqual([{ t0: 60, t1: 140, z0: 0, z1: 210 }]);
    expect(sides[1].holes).toEqual([{ t0: 70, t1: 170, z0: 90, z1: 230 }]);
    expect(sides[2].holes.length + sides[3].holes.length).toBe(0);
    expect(openingSpan({ ...win, sill: 100, h: 120 }, hs)).toEqual([100, 220]);
  });
  it('rivestimento a 200: le pareti meno la porta fino a 200 e la finestra da 90 a 200', () => {
    const sides = roomSides(room, [door, win], o => o.th, hs);
    // perimetro 1080 x 200 = 216000; porta 80 x 200 = 16000; finestra 100 x 110 = 11000
    close(claddingArea(sides, 200), 216000 - 16000 - 11000);
    // a 80 la finestra non c'entra
    close(claddingArea(sides, 80), 1080 * 80 - 80 * 80);
  });
  it('pezzi e scatole, con lo sfrido', () => {
    // 7,2 m² di pavimento 60x30 (0,18 m² l'uno): 40 pezzi, 44 con il 10%
    const q = quantity(roomFloorArea(room), { ...tile('grid', 60, 30), box: 1.44 }, 10000, 10);
    close(q.m2, 7.2);
    expect(q.pcs).toBe(44);
    // 7,2 x 1,1 = 7,92 m², scatole da 1,44 m²: 6
    expect(q.boxes).toBe(6);
    expect(quantity(roomFloorArea(room), tile('grid', 60, 30), 10000, 0).pcs).toBe(40);
    expect(quantity(roomFloorArea(room), tile('grid', 60, 30), 10000, 0).boxes).toBeUndefined();
  });
});

describe('altezze e piastrelle seguono scala e cambio di unità', () => {
  it('in metri un muro alto 270 cm è alto 2,7, e le piastrelle 60x30 diventano 0,6x0,3', () => {
    const doc = new Doc();
    doc.edit('t', () => {
      doc.add({ t: 'wall', a: v(0, 0), b: v(400, 0), th: 30, h: 270, layer: 'MURI' });
      doc.add({ t: 'window', p: v(200, 0), ang: 0, w: 100, th: 30, sill: 90, h: 140, layer: 'SERRAMENTI' });
      doc.add({ t: 'room', pts: [v(0, 0), v(300, 0), v(300, 240), v(0, 240)], name: 'Bagno', floor: tile('herring', 60, 30, 0.3), clad: { ...tile('grid', 20, 20, 0.2), hgt: 200 }, layer: 'LOCALI' });
      doc.add({ t: 'poly', pts: [v(0, 0), v(60, 0), v(60, 45), v(0, 45)], closed: true, z: [0, 85], layer: 'ARREDI' });
    });
    doc.edit('m', () => doc.convertUnits('m'));
    const [w, win, room, poly] = doc.ents as [WallE, WindowE, RoomE, PolyE];
    close(w.h!, 2.7);
    close(win.sill!, 0.9); close(win.h!, 1.4);
    close(room.floor!.l, 0.6); close(room.floor!.j, 0.003);
    close(room.clad!.hgt, 2);
    close(poly.z![0], 0); close(poly.z![1], 0.85);
    close(doc.settings.wallH, 2.7); close(doc.settings.doorH, 2.1);
  });
  it('ruotando non cambiano', () => {
    const p: PolyE = { id: 1, layer: '0', t: 'poly', pts: [v(0, 0), v(10, 0), v(10, 10)], closed: true, z: [5, 20] };
    expect((transform(p, rotateAbout(v(0, 0), 1)) as PolyE).z).toEqual([5, 20]);
    expect((transform(p, scaleAbout(v(0, 0), 2)) as PolyE).z).toEqual([10, 40]);
    close(Math.abs(polygonArea((transform(p, scaleAbout(v(0, 0), 2)) as PolyE).pts)), 200);
  });
});
