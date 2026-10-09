import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model/document';
import { exportDxf } from '../src/io/dxf-export';
import { importDxf, readDwgWith } from '../src/io/files';
import { cleanMText, fromDwgDatabase, buildImport } from '../src/io/importer';
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
