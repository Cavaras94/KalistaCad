import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model/document';
import { exportDxf } from '../src/io/dxf-export';
import { importDxf, readDwgWith } from '../src/io/files';
import { cleanMText, fromDwgDatabase, buildImport, rescaleImport, importSize, guessUnits } from '../src/io/importer';
import { roomArea } from '../src/model/entities';
import type { WallE, InsertE, LineE, CircleE, RoomE } from '../src/model/entities';
import { buildSheet } from '../src/print/sheet';
import { fmt } from '../src/ui/panels';
import { v, sweep } from '../src/model/geom';
import type { ArcE, PolyE, TextE } from '../src/model/entities';

function sample(): Doc {
  const d = new Doc();
  d.edit('prova', () => {
    d.add({ t: 'line', a: v(0, 0), b: v(100, 0), layer: '0' });
    d.add({ t: 'arc', c: v(0, 0), r: 50, a0: Math.PI / 2, a1: Math.PI, layer: '0', color: '#ff0000' });
    d.add({ t: 'poly', pts: [v(0, 0), v(100, 0), v(100, 100)], bulges: [0, 0.5, 0], closed: false, layer: 'ARREDI' });
    d.add({ t: 'text', p: v(10, 10), s: 'Cucina 12 m² – è', h: 15, rot: 0, ha: 'c', va: 'b', layer: 'TESTI' });
    d.add({ t: 'wall', a: v(0, 0), b: v(400, 0), th: 30, layer: 'MURI' });
    d.add({ t: 'door', p: v(200, 0), ang: 0, w: 80, th: 30, sw: 1, hg: 1, layer: 'SERRAMENTI' });
  });
  return d;
}

const toBuf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('numeri nel pannello Proprietà', () => {
  it('gli interi tengono i loro zeri, i decimali perdono solo quelli finali', () => {
    expect(fmt(40)).toBe('40');
    expect(fmt(300)).toBe('300');
    expect(fmt(0)).toBe('0');
    expect(fmt(0.25)).toBe('0,25');
    expect(fmt(12.5)).toBe('12,5');
    expect(fmt(1.0004)).toBe('1');
    expect(fmt(100.05)).toBe('100,05');
  });
});

describe('unità del disegno', () => {
  const make = () => {
    const doc = new Doc();
    doc.edit('prova', () => {
      doc.add({ t: 'wall', a: v(0, 0), b: v(500, 0), th: 30, layer: 'MURI' });
      doc.add({ t: 'room', pts: [v(0, 0), v(500, 0), v(500, 400), v(0, 400)], name: 'Soggiorno', layer: 'LOCALI' });
      doc.add({ t: 'dim', a: v(0, 0), b: v(500, 0), p: v(0, -60), h: 25, layer: 'QUOTE' });
      doc.blocks = { sedia: { ents: [{ id: 1, layer: '0', t: 'circle', c: v(20, 0), r: 10 }] } };
      doc.add({ t: 'insert', name: 'sedia', p: v(100, 200), s: 2, rot: 0, layer: '0' });
    });
    return doc;
  };
  it('da centimetri a metri: stesse misure reali, numeri divisi per 100', () => {
    const doc = make();
    const areaBefore = roomArea(doc.ents[1] as RoomE) / doc.ctx().areaDiv;
    doc.edit('Cambio unità', () => doc.convertUnits('m'));
    const w = doc.ents[0] as WallE;
    expect(w.b.x).toBeCloseTo(5, 12);
    expect(w.th).toBeCloseTo(0.3, 12);
    expect(doc.settings.units).toBe('m');
    expect(doc.settings.wallTh).toBe(0.3);
    expect(doc.settings.textH).toBe(0.2);
    expect(doc.settings.grid).toBe(0.5);
    expect(doc.settings.dimDec).toBe(2);
    expect((doc.ents[2] as { h?: number }).h).toBeCloseTo(0.25, 12);
    expect(roomArea(doc.ents[1] as RoomE) / doc.ctx().areaDiv).toBeCloseTo(areaBefore, 9);
    expect(areaBefore).toBeCloseTo(20, 9);
  });
  it('i blocchi si convertono una volta sola', () => {
    const doc = make();
    doc.edit('Cambio unità', () => doc.convertUnits('m'));
    const ins = doc.ents[3] as InsertE;
    expect(ins.p).toEqual(v(1, 2));
    expect(ins.s).toBe(2);
    const c = doc.blocks.sedia.ents[0] as CircleE;
    expect(c.r).toBeCloseTo(0.1, 12);
    expect(c.c.x).toBeCloseTo(0.2, 12);
  });
  it('la stampa in scala non cambia', () => {
    const doc = make();
    const opts = { paper: 'A4', landscape: true, scale: 100, area: doc.extents()!, title: false, mono: true, lineweights: false, wallFill: 'nero', fields: {} } as unknown as Parameters<typeof buildSheet>[1];
    const before = buildSheet(doc, opts).svg;
    doc.edit('Cambio unità', () => doc.convertUnits('m'));
    const after = buildSheet(doc, { ...opts, area: doc.extents()! }).svg;
    // solo la geometria: il testo della quota cambia apposta, da 500 a 5,00
    const nums = (s: string) => (s.match(/ d="[^"]*"/g) ?? []).join(' ').match(/-?\d+\.?\d*/g)!.map(Number);
    const a = nums(before), b = nums(after);
    expect(b.length).toBe(a.length);
    a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(0.02));
  });
  it('andata e ritorno, e annulla', () => {
    const doc = make();
    doc.edit('Cambio unità', () => doc.convertUnits('m'));
    doc.edit('Cambio unità', () => doc.convertUnits('cm'));
    expect((doc.ents[0] as WallE).b.x).toBeCloseTo(500, 9);
    expect(doc.settings.wallTh).toBe(30);
    expect(doc.settings.dimDec).toBe(0);
    doc.undo();
    expect(doc.settings.units).toBe('m');
    expect((doc.blocks.sedia.ents[0] as CircleE).r).toBeCloseTo(0.1, 12);
    doc.undo();
    expect(doc.settings.units).toBe('cm');
    expect((doc.ents[0] as WallE).b.x).toBe(500);
  });
});

describe('unità dei file importati', () => {
  const raw = (insUnits: number | undefined) => ({
    ents: [{ type: 'LINE' as const, layer: '0', a: v(0, 0), b: v(12.4, 9.8) }], blocks: new Map(), layers: [], insUnits,
  });
  it('un file che dichiara millimetri ma è in metri si può rileggere in metri', () => {
    const r = buildImport(raw(4) as unknown as Parameters<typeof buildImport>[0], 'cm');
    expect((r.ents[0] as LineE).b.x).toBeCloseTo(1.24, 9);
    expect(importSize(r)!.w).toBeCloseTo(12.4, 9);
    const fixed = rescaleImport(r, 'm', 'cm');
    expect((fixed.ents[0] as LineE).b.x).toBeCloseTo(1240, 9);
    expect(fixed.srcUnits).toBe('m');
    expect(fixed.scale).toBe(100);
    expect(rescaleImport(r, 'mm', 'cm').ents).toBe(r.ents);
  });
  it('propone l\'unità che dà la taglia di un edificio', () => {
    expect(guessUnits({ w: 12.4, h: 9.8 }, 'mm', 'cm')).toBe('m');
    expect(guessUnits({ w: 1240, h: 980 }, 'mm', 'cm')).toBe('cm');
    expect(guessUnits({ w: 12400, h: 9800 }, 'mm', 'cm')).toBe('mm');
    expect(guessUnits({ w: 12400, h: 9800 }, null, 'cm')).toBe('mm');
    expect(guessUnits({ w: 1240, h: 980 }, 'cm', 'm')).toBe('cm');
    expect(guessUnits({ w: 0.01, h: 0.01 }, 'cm', 'm')).toBe('cm');
    expect(guessUnits(null, null, 'cm')).toBe('cm');
  });
});

describe('DXF', () => {
  it('esporta e reimporta', () => {
    const doc = sample();
    const txt = exportDxf(doc);
    expect(txt.startsWith('0\r\nSECTION')).toBe(true);
    expect(txt.trim().endsWith('EOF')).toBe(true);
    const r = importDxf(toBuf(txt), 'cm');
    expect(r.srcUnits).toBe('cm');
    expect(r.scale).toBe(1);
    const arc = r.ents.find(e => e.t === 'arc' && e.layer === '0') as ArcE;
    expect(arc.color).toBe('#ff0000');
    expect(Math.abs(sweep(arc.a0, arc.a1) - Math.PI / 2)).toBeLessThan(1e-6);
    const poly = r.ents.find(e => e.t === 'poly' && e.layer === 'ARREDI') as PolyE;
    expect(poly.bulges?.[1]).toBeCloseTo(0.5, 9);
    const text = r.ents.find(e => e.t === 'text') as TextE;
    expect(text.s).toBe('Cucina 12 m² – è');
    expect(text.ha).toBe('c');
    expect(text.p.x).toBeCloseTo(10, 6);
    // muro con porta: due tratti di bordo per lato, testate, spallette, anta e arco
    expect(r.ents.filter(e => e.layer === 'MURI').length).toBeGreaterThanOrEqual(8);
    expect(r.ents.some(e => e.layer === 'SERRAMENTI' && e.t === 'arc')).toBe(true);
    expect(r.layers.map(l => l.name)).toContain('QUOTE');
  });

  it('converte le unità', () => {
    const doc = sample();
    doc.settings.units = 'cm';
    const r = importDxf(toBuf(exportDxf(doc)), 'mm');
    expect(r.scale).toBe(10);
    const line = r.ents.find(e => e.t === 'line' && e.layer === '0')!;
    expect(line.t === 'line' && line.b.x).toBe(1000);
  });

  it('pulisce i codici MTEXT', () => {
    expect(cleanMText('{\\fArial|b1;Soggiorno}\\PS = 20%%d')).toBe('Soggiorno\nS = 20°');
    expect(cleanMText('\\H2.5;Bagno\\~1')).toBe('Bagno 1');
  });
});

describe('DWG', () => {
  it('converte un database DWG con blocchi e quote', () => {
    const db = {
      header: { INSUNITS: 4 },
      tables: {
        LAYER: { entries: [{ name: 'A', colorIndex: 1 }, { name: 'B', colorIndex: -3 }] },
        BLOCK_RECORD: {
          entries: [
            { name: '*Model_Space', basePoint: { x: 0, y: 0 }, entities: [] },
            { name: 'SEDIA', basePoint: { x: 0, y: 0 }, entities: [{ type: 'LINE', layer: '0', colorIndex: 0, startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } }] },
            { name: '*D1', basePoint: { x: 0, y: 0 }, entities: [{ type: 'TEXT', layer: 'A', colorIndex: 256, text: '250', startPoint: { x: 5, y: 5 }, textHeight: 2, rotation: 0 }] },
          ],
        },
      },
      entities: [
        { type: 'LWPOLYLINE', layer: 'A', colorIndex: 256, flag: 0x200, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 100, y: 0, bulge: 0 }, { x: 100, y: 100, bulge: 0 }] },
        { type: 'INSERT', layer: 'B', colorIndex: 3, name: 'SEDIA', insertionPoint: { x: 50, y: 50 }, xScale: 2, yScale: 2, rotation: Math.PI / 2, attribs: [] },
        { type: 'DIMENSION', layer: 'A', name: '*D1' },
        { type: 'ARC', layer: 'A', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI },
        { type: 'MLINE', layer: 'A' },
      ],
    };
    const { drawing, skipped } = fromDwgDatabase(db);
    const r = buildImport(drawing, 'cm');
    expect(r.scale).toBeCloseTo(0.1, 12);
    const poly = r.ents.find(e => e.t === 'poly') as PolyE;
    expect(poly.closed).toBe(true);
    expect(poly.pts[1].x).toBeCloseTo(10, 9);
    // linea del blocco: layer e colore ereditati dall'inserimento, ruotata di 90° e scalata ×2
    const chair = r.ents.find(e => e.t === 'line')!;
    expect(chair.layer).toBe('B');
    expect(chair.color).toBe('#00ff00');
    if (chair.t === 'line') { expect(chair.b.x).toBeCloseTo(5, 9); expect(chair.b.y).toBeCloseTo(7, 9); }
    expect(chair.g).toBeDefined();
    expect(r.ents.some(e => e.t === 'text' && e.s === '250')).toBe(true);
    expect(r.layers.find(l => l.name === 'B')!.visible).toBe(false);
    expect(skipped.get('MLINE')).toBe(1);
  });

  it('il modulo LibreDWG si carica e un file non valido dà errore esplicito', async () => {
    const { LibreDwg } = await import('@mlightcad/libredwg-web');
    const lib = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm');
    const junk = new TextEncoder().encode('AC1032' + 'x'.repeat(2000)).buffer as ArrayBuffer;
    expect(() => readDwgWith(lib, junk, 'cm')).toThrow(/DWG non leggibile \(versione 2018\), codice LibreDWG \d+/);
    expect(() => readDwgWith(lib, new TextEncoder().encode('ciao').buffer as ArrayBuffer, 'cm')).toThrow(/non sembra un DWG/);
  }, 60000);
});
