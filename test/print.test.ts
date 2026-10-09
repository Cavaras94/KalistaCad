import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model/document';
import { buildSheet, fitScale, PrintOpts } from '../src/print/sheet';
import { v } from '../src/model/geom';

const fields = { progetto: 'Casa', titolo: 'Pianta', committente: '', indirizzo: '', disegnatore: '', data: '', tavola: '1' };

function opts(doc: Doc, scale: number): PrintOpts {
  return { paper: 'A3', landscape: true, scale, area: doc.extents()!, mono: true, lineweights: true, wallFill: 'grigio', title: true, fields };
}

describe('stampa', () => {
  it('una linea di 500 cm a 1:100 misura 50 mm sul foglio', () => {
    const d = new Doc();
    d.edit('x', () => { d.add({ t: 'line', a: v(0, 0), b: v(500, 0), layer: '0' }); });
    const sh = buildSheet(d, opts(d, 100));
    expect(sh.w).toBe(420);
    expect(sh.h).toBe(297);
    const m = sh.svg.match(/<path d="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)"/)!;
    expect(parseFloat(m[3]) - parseFloat(m[1])).toBeCloseTo(50, 6);
    expect(sh.svg).toContain('width="420mm" height="297mm"');
    expect(sh.svg).toContain('1:100');
  });
  it('in millimetri: 5000 mm a 1:50 = 100 mm', () => {
    const d = new Doc();
    d.reset('mm');
    d.edit('x', () => { d.add({ t: 'line', a: v(0, 0), b: v(5000, 0), layer: '0' }); });
    const sh = buildSheet(d, opts(d, 50));
    const m = sh.svg.match(/<path d="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)"/)!;
    expect(parseFloat(m[3]) - parseFloat(m[1])).toBeCloseTo(100, 6);
  });
  it('adatta: sceglie la scala standard più piccola che fa entrare il disegno', () => {
    const d = new Doc();
    d.edit('x', () => { d.add({ t: 'line', a: v(0, 0), b: v(3100, 1000), layer: '0' }); });
    // 31 m su 400 mm utili: a 1:75 sarebbero 413 mm, a 1:100 310 mm
    expect(fitScale(d, opts(d, 0))).toBe(100);
    expect(buildSheet(d, opts(d, 0)).fits).toBe(true);
    expect(buildSheet(d, opts(d, 20)).fits).toBe(false);
  });
});
