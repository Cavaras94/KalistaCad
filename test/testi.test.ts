// Versione 0.4: testi su più righe, cartiglio con le scritte nel disegno.
import { describe, it, expect } from 'vitest';
import { retext, textLines } from '../src/model/entities';
import { Doc } from '../src/model/document';
import { v } from '../src/model/geom';
import { buildSheet, fitCell, textEm, PrintOpts } from '../src/print/sheet';

describe('testi su più righe', () => {
  const base = { p: v(100, 200), s: 'uno', h: 10, rot: 0, va: 'b' as 'b' | 'm' | 't' };
  const firstLine = (e: typeof base) => {
    const y = textLines(e)[0].y;
    return v(e.p.x - Math.sin(e.rot) * y, e.p.y + Math.cos(e.rot) * y);
  };

  it('aggiungendo righe la prima resta dov\'è e le altre scendono', () => {
    const e = retext(base, 'uno\ndue\ntre');
    expect(e.s).toBe('uno\ndue\ntre');
    expect(firstLine(e).x).toBeCloseTo(100, 9);
    expect(firstLine(e).y).toBeCloseTo(200, 9);
    // l'ultima riga è più in basso della prima di due interlinee
    expect(e.p.y).toBeCloseTo(200 - 2 * 15, 9);
  });

  it('vale anche per un testo ruotato e tornando a una riga sola si torna al punto di partenza', () => {
    const r = { ...base, rot: Math.PI / 2 };
    const e = retext(r, 'a\nb');
    expect(firstLine(e).x).toBeCloseTo(100, 9);
    expect(firstLine(e).y).toBeCloseTo(200, 9);
    const back = retext(e, 'a');
    expect(back.p.x).toBeCloseTo(100, 9);
    expect(back.p.y).toBeCloseTo(200, 9);
  });

  it('con gli altri allineamenti verticali la prima riga non si muove', () => {
    for (const va of ['t', 'm'] as const) {
      const a = { ...base, va };
      const e = retext(a, 'x\ny\nz\nw');
      expect(firstLine(e).y).toBeCloseTo(firstLine(a).y, 9);
    }
  });
});

describe('cartiglio', () => {
  const opts = (doc: Doc, fields: PrintOpts['fields']): PrintOpts =>
    ({ paper: 'A3', landscape: true, scale: 100, area: doc.extents()!, mono: true, lineweights: true, wallFill: 'grigio', title: true, fields });
  const doc = new Doc();
  doc.edit('x', () => { doc.add({ t: 'line', a: v(0, 0), b: v(500, 0), layer: '0' }); });

  it('ha Nome cliente, Posa gres e Note; non più scala, data, tavola e disegnatore', () => {
    const svg = buildSheet(doc, opts(doc, { cliente: 'Rossi Mario', posa: '60x60 a correre', note: 'fuga 2 mm' })).svg;
    for (const s of ['NOME CLIENTE', 'POSA GRES', 'NOTE', 'Rossi Mario', '60x60 a correre', 'fuga 2 mm']) expect(svg).toContain(s);
    for (const s of ['SCALA', 'DATA', 'TAVOLA', 'DISEGNATORE', 'PROGETTO', 'OGGETTO', 'COMMITTENTE', '1:100']) expect(svg).not.toContain(s);
  });

  it('gli a capo scritti diventano righe distinte', () => {
    const svg = buildSheet(doc, opts(doc, { cliente: '', posa: '', note: 'prima\nseconda\nterza' })).svg;
    const ys = ['prima', 'seconda', 'terza'].map(s => parseFloat(new RegExp(`y="([\\d.]+)"[^>]*>${s}<`).exec(svg)![1]));
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
  });

  it('un testo lungo va a capo da solo e, se serve, rimpicciolisce: resta nella casella', () => {
    const long = 'posa a correre con fuga da due millimetri in tutte le stanze del piano terra e del primo piano';
    const one = fitCell('breve', 60, 15, 5);
    expect(one).toEqual({ size: 5, lines: ['breve'] });
    const many = fitCell(long, 60, 15, 5);
    expect(many.lines.length).toBeGreaterThan(1);
    expect(many.size).toBeLessThan(5);
    expect(many.lines.join(' ')).toBe(long);
    for (const l of many.lines) expect(textEm(l) * many.size).toBeLessThanOrEqual(60);
    expect(many.lines.length * many.size * 1.2).toBeLessThanOrEqual(15);
    // il maiuscolo occupa più posto del minuscolo: a pari lettere va a capo prima
    expect(textEm('ZOCCOLINO COORDINATO')).toBeGreaterThan(textEm('zoccolino coordinato') * 1.15);
    // una parola sola lunghissima viene spezzata invece di uscire dalla casella
    const word = fitCell('x'.repeat(200), 40, 20, 4);
    for (const l of word.lines) expect(textEm(l) * word.size).toBeLessThanOrEqual(40);
  });

  it('le scritte si salvano con il disegno e Nuovo le azzera', () => {
    const d = new Doc();
    d.setCartiglio({ cliente: 'Bianchi', posa: '30x60', note: 'riga 1\nriga 2' });
    expect(d.dirty).toBe(true);
    const data = JSON.parse(JSON.stringify(d.toData()));
    const e = new Doc();
    e.load(data);
    expect(e.cartiglio).toEqual({ cliente: 'Bianchi', posa: '30x60', note: 'riga 1\nriga 2' });
    e.reset();
    expect(e.cartiglio).toEqual({ cliente: '', posa: '', note: '' });
    // i file vecchi, senza cartiglio, si aprono con le scritte vuote
    delete data.cartiglio;
    e.load(data);
    expect(e.cartiglio).toEqual({ cliente: '', posa: '', note: '' });
  });
});
