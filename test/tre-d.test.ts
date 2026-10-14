// Modello della vista 3D ricavato dalla pianta, e libreria di sanitari e arredi.
import { describe, it, expect } from 'vitest';
import type { InsertE } from '../src/model/entities';
import { Doc } from '../src/model/document';
import { v } from '../src/model/geom';
import { buildModel } from '../src/view3d/model';
import { cladRects } from '../src/view3d/scene';
import { LIBRARY } from '../src/library/arredi';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('modello 3D', () => {
  const room = () => {
    const doc = new Doc();
    doc.edit('t', () => {
      doc.add({ t: 'wall', a: v(0, -15), b: v(300, -15), th: 30, layer: 'MURI' });
      doc.add({ t: 'wall', a: v(300, -15), b: v(300, 255), th: 30, h: 300, layer: 'MURI' });
      doc.add({ t: 'door', p: v(100, -15), ang: 0, w: 80, th: 30, sw: 1, hg: 1, layer: 'SERRAMENTI' });
      doc.add({ t: 'window', p: v(300, 120), ang: Math.PI / 2, w: 100, th: 30, sill: 100, h: 120, layer: 'SERRAMENTI' });
      doc.add({ t: 'room', pts: [v(0, 0), v(285, 0), v(285, 240), v(0, 240)], name: 'Bagno', layer: 'LOCALI', clad: { l: 30, w: 30, j: 0.2, lay: 'grid', color: '#ffffff', hgt: 200 } });
      doc.add({ t: 'poly', pts: [v(10, 230), v(70, 230), v(70, 180), v(10, 180)], closed: true, z: [0, 85], layer: 'ARREDI' });
      doc.add({ t: 'line', a: v(0, 0), b: v(50, 50), layer: '0' });
    });
    return doc;
  };
  it('muri alti quanto detto (o quanto le impostazioni), con architrave sopra la porta e muro sotto e sopra la finestra', () => {
    const m = buildModel(room());
    const walls = m.prisms.filter(p => p.kind === 'wall');
    // muro basso: due pezzi pieni ai lati della porta più l'architrave; muro destro: due pezzi, sotto e sopra la finestra
    const heights = walls.map(p => [p.z0, p.z1]);
    expect(heights.filter(([a, b]) => a === 0 && b === 270).length).toBe(2);
    expect(heights).toContainEqual([210, 270]);
    expect(heights.filter(([a, b]) => a === 0 && b === 300).length).toBe(2);
    expect(heights).toContainEqual([0, 100]);
    expect(heights).toContainEqual([220, 300]);
    expect(m.prisms.filter(p => p.kind === 'glass').map(p => [p.z0, p.z1])).toEqual([[100, 220]]);
    // il mobile con la quota diventa un solido; la linea no
    expect(m.prisms.filter(p => p.kind === 'solid').map(p => [p.z0, p.z1])).toEqual([[0, 85]]);
    expect(m.box.z1).toBe(300);
    expect(m.perM).toBe(100);
  });
  it('rivestimento: una faccia per lato del locale, rivolta verso l\'interno, con i vani', () => {
    const m = buildModel(room());
    expect(m.clads.length).toBe(4);
    const bottom = m.clads.find(c => Math.abs(c.a.y) < 1e-9 && Math.abs(c.b.y) < 1e-9)!;
    expect(bottom.inward.y).toBeGreaterThan(0.99);
    expect(bottom.holes).toEqual([{ t0: 60, t1: 140, z0: 0, z1: 210 }]);
    const right = m.clads.find(c => Math.abs(c.a.x - 285) < 1e-9 && Math.abs(c.b.x - 285) < 1e-9)!;
    expect(right.inward.x).toBeLessThan(-0.99);
    expect(right.holes.map(h => [h.z0, h.z1])).toEqual([[100, 220]]);
  });
  it('la parete rivestita a strisce copre tutto tranne i vani', () => {
    const area = (rs: [number, number, number, number][]) => rs.reduce((s, [a, b, c, d]) => s + (c - a) * (d - b), 0);
    close(area(cladRects({ L: 300, hgt: 200, holes: [{ t0: 60, t1: 140, z0: 0, z1: 210 }] })), 300 * 200 - 80 * 200);
    close(area(cladRects({ L: 240, hgt: 200, holes: [{ t0: 70, t1: 170, z0: 100, z1: 220 }] })), 240 * 200 - 100 * 100);
    // una porta e una finestra vicine, e un vano oltre l'altezza del rivestimento
    close(area(cladRects({ L: 400, hgt: 120, holes: [{ t0: 50, t1: 130, z0: 0, z1: 210 }, { t0: 200, t1: 300, z0: 90, z1: 230 }, { t0: 320, t1: 380, z0: 150, z1: 200 }] })), 400 * 120 - 80 * 120 - 100 * 30);
  });
  it('i solidi dentro un blocco seguono posizione, rotazione e scala dell\'inserimento', () => {
    const doc = new Doc();
    const lav = LIBRARY.find(i => i.key === 'lavabo')!;
    doc.edit('t', () => {
      doc.blocks = { lavabo: { ents: lav.ents.map((e, i) => ({ ...e, id: i + 1 }) as never) } };
      doc.add({ t: 'insert', name: 'lavabo', p: v(500, 300), s: 2, rot: Math.PI / 2, layer: 'ARREDI' } as Omit<InsertE, 'id'>);
    });
    const solids = buildModel(doc).prisms.filter(p => p.kind === 'solid');
    expect(solids.length).toBe(1);
    expect([solids[0].z0, solids[0].z1]).toEqual([140, 170]);
    // ruotato di 90°: il lavabo (largo 60, profondo 45, verso y negative) va verso x positive, a scala 2
    const xs = solids[0].pts.map(p => p.x), ys = solids[0].pts.map(p => p.y);
    close(Math.min(...xs), 500); close(Math.max(...xs), 590);
    close(Math.min(...ys), 240); close(Math.max(...ys), 360);
  });
});

describe('libreria di sanitari e arredi', () => {
  it('ogni oggetto ha un nome, sta dalla parte del muro (y ≤ 0) e ha almeno un solido per il 3D', () => {
    const keys = new Set<string>();
    for (const it of LIBRARY) {
      expect(keys.has(it.key)).toBe(false);
      keys.add(it.key);
      expect(it.name.length).toBeGreaterThan(3);
      const solids = it.ents.filter(e => 'z' in e && e.z);
      expect(solids.length).toBeGreaterThan(0);
      for (const e of it.ents) {
        const ys = e.t === 'poly' ? e.pts.map(p => p.y) : e.t === 'line' ? [e.a.y, e.b.y] : e.t === 'circle' ? [e.c.y + e.r] : e.t === 'ellipse' ? [e.c.y + (Math.abs(e.a.y) > Math.abs(e.a.x) ? Math.hypot(e.a.x, e.a.y) : Math.hypot(e.a.x, e.a.y) * e.k)] : [0];
        for (const y of ys) expect(y).toBeLessThanOrEqual(1e-9);
      }
    }
    expect(LIBRARY.length).toBeGreaterThanOrEqual(15);
  });
});
