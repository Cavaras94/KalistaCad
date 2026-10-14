// Comandi di disegno.
import type { Ent, NewEnt, HAlign, HatchPattern, Prim } from '../model/entities';
import { HATCH_NAMES, retext, prims } from '../model/entities';
import { arc3 } from '../model/entities';
import { closedLoopAt, islandsIn } from '../model/ops';
import { findRegion } from '../model/region';
import { polyPoints } from '../model/entities';
import { Vec, v, sub, dist, angleOf, same, norm, cross, dot, len, mid, TAU, tessArc } from '../model/geom';
import { Tool, O, parseNum, parseAngle, fmtLen } from './base';

// ---------------------------------------------------------------- LINEA

export class LineTool extends Tool {
  readonly name = 'LINEA';
  private pts: Vec[] = [];
  private created = 0;

  start() { this.ask('Specificare punto iniziale (Invio = dall\'ultimo punto)'); }

  /** Invio al primo punto riparte dall'ultimo punto indicato, come in AutoCAD. */
  enter() {
    if (!this.pts.length && this.h.lastPoint) this.point(this.h.lastPoint);
    else super.enter();
  }

  private next() {
    const opts = [O('A', 'Annulla')];
    if (this.pts.length >= 3) opts.unshift(O('C', 'Chiudi'));
    this.ask('Specificare punto successivo o', opts);
  }

  point(p: Vec) {
    if (!this.pts.length) { this.pts.push(p); this.base = p; this.next(); return; }
    const a = this.pts[this.pts.length - 1];
    if (same(a, p, 1e-12)) return;
    this.h.doc.edit('Linea', () => { this.h.doc.add({ t: 'line', a, b: p, layer: this.h.doc.current }); });
    this.created++;
    this.pts.push(p);
    this.base = p;
    this.next();
  }

  option(k: string) {
    if (k === 'C') { this.point(this.pts[0]); this.h.done(); return; }
    if (k === 'A') {
      if (this.created) { this.h.doc.undo(); this.created--; this.pts.pop(); this.base = this.pts[this.pts.length - 1]; this.next(); }
      else { this.pts = []; this.base = null; this.start(); }
    }
  }

  preview(p: Vec): NewEnt[] {
    return this.base ? [{ t: 'line', a: this.base, b: p, layer: this.h.doc.current }] : [];
  }
}

// ---------------------------------------------------------------- POLILINEA

export class PolylineTool extends Tool {
  readonly name = 'POLILINEA';
  private pts: Vec[] = [];
  private bulges: number[] = [];
  private arcMode = false;
  private tangent: Vec = v(1, 0);

  start() { this.ask('Specificare punto iniziale'); }

  private next() {
    const opts = this.arcMode ? [O('L', 'Linea')] : [O('A', 'Arco')];
    if (this.pts.length >= 2) opts.push(O('C', 'Chiudi'));
    opts.push(O('N', 'aNnulla'));
    this.ask(this.arcMode ? 'Specificare punto finale dell\'arco o' : 'Specificare punto successivo o', opts);
  }

  private bulgeTo(p: Vec): { b: number; endTan: Vec } {
    const last = this.pts[this.pts.length - 1];
    const chord = sub(p, last);
    const alpha = Math.atan2(cross(this.tangent, chord), dot(this.tangent, chord));
    const b = Math.tan(alpha / 2);
    const c = Math.cos(2 * alpha), s = Math.sin(2 * alpha);
    const t = this.tangent;
    return { b, endTan: norm(v(t.x * c - t.y * s, t.x * s + t.y * c)) };
  }

  point(p: Vec) {
    if (!this.pts.length) { this.pts.push(p); this.base = p; this.next(); return; }
    const last = this.pts[this.pts.length - 1];
    if (same(last, p, 1e-12)) return;
    if (this.arcMode) {
      const { b, endTan } = this.bulgeTo(p);
      this.bulges.push(b);
      this.tangent = endTan;
    } else {
      this.bulges.push(0);
      this.tangent = norm(sub(p, last));
    }
    this.pts.push(p);
    this.base = p;
    this.next();
  }

  private commit(closed: boolean) {
    let pts = this.pts.slice(), bulges = this.bulges.slice();
    if (closed && pts.length > 2 && same(pts[0], pts[pts.length - 1], 1e-9)) { pts.pop(); }
    if (!closed) bulges = bulges.slice(0, pts.length - 1);
    if (pts.length < 2) { this.h.done(); return; }
    const e: NewEnt = { t: 'poly', pts, closed, layer: this.h.doc.current };
    if (bulges.some(b => Math.abs(b) > 1e-9)) e.bulges = bulges;
    this.h.doc.edit('Polilinea', () => { this.h.doc.add(e); });
    this.h.done();
  }

  option(k: string) {
    if (k === 'A') { this.arcMode = true; this.next(); }
    else if (k === 'L') { this.arcMode = false; this.next(); }
    else if (k === 'C') {
      if (this.arcMode) {
        const { b } = this.bulgeTo(this.pts[0]);
        this.bulges.push(b);
      } else this.bulges.push(0);
      this.commit(true);
    } else if (k === 'N') {
      if (this.pts.length > 1) {
        this.pts.pop(); this.bulges.pop();
        this.base = this.pts[this.pts.length - 1];
        const n = this.pts.length;
        this.tangent = n > 1 ? norm(sub(this.pts[n - 1], this.pts[n - 2])) : v(1, 0);
        this.next();
      } else { this.pts = []; this.base = null; this.start(); }
    }
  }

  enter() { this.commit(false); }

  preview(p: Vec): NewEnt[] {
    if (!this.pts.length) return [];
    const pts = [...this.pts, p];
    const bulges = [...this.bulges, this.arcMode ? this.bulgeTo(p).b : 0];
    return [{ t: 'poly', pts, bulges, closed: false, layer: this.h.doc.current }];
  }
}

// ---------------------------------------------------------------- RETTANGOLO

export class RectTool extends Tool {
  readonly name = 'RETTANGOLO';
  private a: Vec | null = null;
  /** dimensioni digitate con l'opzione Dimensioni: poi basta indicare da che parte va il rettangolo */
  private size: { w?: number; h?: number } | null = null;
  start() { this.ask('Specificare primo angolo'); }
  private askCorner() { this.ask('Specificare angolo opposto (oppure @larghezza,altezza) o', [O('D', 'Dimensioni')]); }
  option(k: string) {
    if (k === 'D' && this.a) { this.size = {}; this.ask('Larghezza', [], undefined, 'none'); }
  }
  text(s: string): boolean {
    const n = parseNum(s);
    if (n === null || !this.size || this.size.h !== undefined) return false;
    if (n <= 0) { this.h.msg('Serve un valore maggiore di zero.'); return true; }
    if (this.size.w === undefined) { this.size.w = n; this.ask('Altezza', [], undefined, 'none'); }
    else { this.size.h = n; this.ask('Indicare da che parte del primo angolo va il rettangolo'); }
    return true;
  }
  /** Angolo opposto: quello indicato, oppure quello dato dalle dimensioni nel quadrante del punto. */
  private corner(p: Vec): Vec {
    const a = this.a!, z = this.size;
    if (z?.w === undefined || z.h === undefined) return p;
    return v(a.x + (p.x >= a.x ? z.w : -z.w), a.y + (p.y >= a.y ? z.h : -z.h));
  }
  point(q: Vec) {
    if (!this.a) { this.a = q; this.base = q; this.askCorner(); return; }
    const p = this.corner(q);
    if (Math.abs(p.x - this.a.x) < 1e-12 || Math.abs(p.y - this.a.y) < 1e-12) return;
    const e = this.rect(this.a, p);
    this.h.doc.edit('Rettangolo', () => { this.h.doc.add(e); });
    this.h.done();
  }
  private rect(a: Vec, b: Vec): NewEnt {
    return { t: 'poly', pts: [a, v(b.x, a.y), b, v(a.x, b.y)], closed: true, layer: this.h.doc.current };
  }
  preview(p: Vec): NewEnt[] { return this.a && this.mode === 'point' ? [this.rect(this.a, this.corner(p))] : []; }
}

// ---------------------------------------------------------------- ELLISSE

export class EllipseTool extends Tool {
  readonly name = 'ELLISSE';
  private byCenter = false;
  private p1: Vec | null = null;
  private c: Vec | null = null;
  private a: Vec | null = null;
  /** arco di ellisse: dopo la forma si chiedono i due estremi */
  private arc = false;
  private k = 0;
  private a0: number | null = null;

  start() { this.ask(`Specificare primo estremo dell'asse${this.arc ? ' (arco di ellisse)' : ''} o`, this.arc ? [O('C', 'Centro')] : [O('C', 'Centro'), O('A', 'Arco')]); }

  option(k: string) {
    if (this.p1 || this.c) return;
    if (k === 'C') { this.byCenter = true; this.ask('Specificare centro dell\'ellisse'); }
    else if (k === 'A') { this.arc = true; this.start(); }
  }

  /** Parametro dell'ellisse nella direzione del punto p visto dal centro. */
  private param(p: Vec): number {
    const c = this.c!, a = this.a!;
    const d = sub(p, c), L = len(a);
    const ux = v(a.x / L, a.y / L);
    return Math.atan2((-d.x * ux.y + d.y * ux.x) / (L * this.k), (d.x * ux.x + d.y * ux.y) / L);
  }

  point(p: Vec) {
    if (this.c && this.a && this.k) {
      if (dist(this.c, p) < 1e-9) return;
      if (this.a0 === null) { this.a0 = this.param(p); this.ask('Specificare la direzione dell\'estremo finale (in senso antiorario)'); return; }
      const e = this.make(this.k * len(this.a));
      if (!e || e.t !== 'ellipse') return;
      const a1 = this.param(p);
      if (Math.abs(Math.sin((a1 - this.a0) / 2)) < 1e-9) return;
      this.h.doc.edit('Arco di ellisse', () => { this.h.doc.add({ ...e, a0: this.a0!, a1 }); });
      this.h.done();
      return;
    }
    if (this.c && this.a) { this.commit(dist(this.c, p)); return; }
    if (this.byCenter) {
      if (!this.c) { this.c = p; this.base = p; this.ask('Specificare estremo dell\'asse'); return; }
      if (dist(this.c, p) < 1e-9) return;
      this.a = sub(p, this.c);
    } else {
      if (!this.p1) { this.p1 = p; this.base = p; this.ask('Specificare secondo estremo dell\'asse'); return; }
      if (dist(this.p1, p) < 1e-9) return;
      this.c = mid(this.p1, p);
      this.a = sub(p, this.c);
    }
    // un numero digitato qui è una distanza diretta dal centro, quindi la lunghezza del semiasse;
    // niente numberAsText, altrimenti una coordinata come 6100,190 verrebbe letta come 6100,19
    this.base = this.c;
    this.ask('Specificare lunghezza dell\'altro semiasse');
  }

  private make(d: number): NewEnt | null {
    if (!this.c || !this.a || d < 1e-9) return null;
    return { t: 'ellipse', c: this.c, a: this.a, k: d / len(this.a), layer: this.h.doc.current };
  }

  private commit(d: number) {
    const e = this.make(d);
    if (!e) return;
    if (this.arc) {
      this.k = d / len(this.a!);
      this.base = this.c;
      this.ask('Specificare la direzione dell\'estremo iniziale');
      return;
    }
    this.h.doc.edit('Ellisse', () => { this.h.doc.add(e); });
    this.h.done();
  }

  preview(p: Vec): NewEnt[] {
    if (this.c && this.a && this.k) {
      const e = this.make(this.k * len(this.a));
      if (!e || e.t !== 'ellipse' || dist(this.c, p) < 1e-9) return [];
      const ray: NewEnt = { t: 'line', a: this.c, b: p, layer: this.h.doc.current };
      return this.a0 === null ? [e, ray] : [{ ...e, a0: this.a0, a1: this.param(p) }, ray];
    }
    if (this.c && this.a) { const e = this.make(dist(this.c, p)); return e ? [e] : []; }
    const from = this.byCenter ? this.c : this.p1;
    return from ? [{ t: 'line', a: from, b: p, layer: this.h.doc.current }] : [];
  }
}

// ---------------------------------------------------------------- SPLINE

export class SplineTool extends Tool {
  readonly name = 'SPLINE';
  private pts: Vec[] = [];

  start() { this.askNext(); }

  private askNext() {
    const n = this.pts.length;
    if (!n) { this.base = null; this.ask('Specificare primo punto'); return; }
    this.base = this.pts[n - 1];
    this.ask('Specificare punto successivo (Invio per finire) o', [...(n >= 3 ? [O('C', 'Chiudi')] : []), O('A', 'Annulla')]);
  }

  point(p: Vec) {
    const n = this.pts.length;
    if (n && dist(this.pts[n - 1], p) < 1e-9) return;
    this.pts.push(p);
    this.askNext();
  }

  option(k: string) {
    if (k === 'A') { this.pts.pop(); this.askNext(); }
    else if (k === 'C' && this.pts.length >= 3) this.commit(true);
  }

  enter() {
    if (this.pts.length >= 2) this.commit(false);
    else this.h.done();
  }

  private commit(closed: boolean) {
    const pts = this.pts;
    this.h.doc.edit('Spline', () => { this.h.doc.add({ t: 'spline', pts, closed, layer: this.h.doc.current }); });
    this.h.done();
  }

  preview(p: Vec): NewEnt[] {
    return this.pts.length ? [{ t: 'spline', pts: [...this.pts, p], closed: false, layer: this.h.doc.current }] : [];
  }
}

// ---------------------------------------------------------------- CERCHIO

export class CircleTool extends Tool {
  readonly name = 'CERCHIO';
  static lastR = 0;
  static lastUnits = '';
  /** ultimo raggio usato, valido solo finché il disegno resta nelle stesse unità */
  private get last(): number { return CircleTool.lastUnits === this.h.doc.settings.units ? CircleTool.lastR : 0; }
  private c: Vec | null = null;
  private diam = false;
  private how: 'cr' | '2p' | '3p' = 'cr';
  private pts: Vec[] = [];

  start() { this.ask('Specificare centro o', [O('3P', '3Punti'), O('2P', '2Punti')]); }

  option(k: string) {
    if (k === '3P') { this.how = '3p'; this.ask('Specificare primo punto sulla circonferenza'); }
    else if (k === '2P') { this.how = '2p'; this.ask('Specificare primo estremo del diametro'); }
    else if (k === 'D') { this.diam = true; this.ask('Specificare diametro', [], this.last ? fmtLen(this.last * 2) : undefined); }
  }

  private make(c: Vec, r: number) {
    if (r <= 1e-12) return;
    CircleTool.lastR = r;
    CircleTool.lastUnits = this.h.doc.settings.units;
    this.h.doc.edit('Cerchio', () => { this.h.doc.add({ t: 'circle', c, r, layer: this.h.doc.current }); });
    this.h.done();
  }

  point(p: Vec) {
    if (this.how === '3p') {
      this.pts.push(p);
      this.base = p;
      if (this.pts.length === 1) this.ask('Specificare secondo punto');
      else if (this.pts.length === 2) this.ask('Specificare terzo punto');
      else {
        const a = arc3(this.pts[0], this.pts[1], this.pts[2]);
        if (a) this.make(a.c, a.r);
        else { this.pts.pop(); this.base = this.pts[1]; this.h.msg('I tre punti sono allineati: indicare un altro terzo punto.'); }
      }
      return;
    }
    if (this.how === '2p') {
      this.pts.push(p);
      this.base = p;
      if (this.pts.length === 1) this.ask('Specificare secondo estremo del diametro');
      else if (dist(this.pts[0], this.pts[1]) <= 1e-12) { this.pts.pop(); this.base = this.pts[0]; }
      else this.make(mid(this.pts[0], this.pts[1]), dist(this.pts[0], this.pts[1]) / 2);
      return;
    }
    if (!this.c) {
      this.c = p;
      this.base = p;
      this.numberAsText = true;
      this.ask('Specificare raggio o', [O('D', 'Diametro')], this.last ? fmtLen(this.last) : undefined);
      return;
    }
    const d = dist(this.c, p);
    this.make(this.c, this.diam ? d / 2 : d);
  }

  text(s: string): boolean {
    const n = parseNum(s);
    if (n === null || !this.c || n <= 0) return false;
    this.make(this.c, this.diam ? n / 2 : n);
    return true;
  }

  enter() {
    if (this.c && this.last) this.make(this.c, this.last);
    else this.h.done();
  }

  preview(p: Vec): NewEnt[] {
    const L = this.h.doc.current;
    if (this.how === '3p' && this.pts.length === 2) {
      const a = arc3(this.pts[0], this.pts[1], p);
      return a ? [{ t: 'circle', c: a.c, r: a.r, layer: L }] : [];
    }
    if (this.how === '2p' && this.pts.length === 1) return [{ t: 'circle', c: mid(this.pts[0], p), r: dist(this.pts[0], p) / 2, layer: L }];
    if (this.c) {
      const d = dist(this.c, p);
      return d > 0 ? [{ t: 'circle', c: this.c, r: this.diam ? d / 2 : d, layer: L }] : [];
    }
    return [];
  }
}

// ---------------------------------------------------------------- ARCO

export class ArcTool extends Tool {
  readonly name = 'ARCO';
  private pts: Vec[] = [];
  private center: Vec | null = null;
  private byCenter = false;

  start() { this.ask('Specificare punto iniziale o', [O('C', 'Centro')]); }

  option(k: string) {
    if (k === 'C') { this.byCenter = true; this.ask('Specificare centro'); }
  }

  point(p: Vec) {
    const L = this.h.doc.current;
    if (this.byCenter) {
      if (!this.center) { this.center = p; this.base = p; this.ask('Specificare punto iniziale'); return; }
      if (!this.pts.length) { this.pts.push(p); this.ask('Specificare punto finale (in senso antiorario)'); return; }
      const c = this.center, r = dist(c, this.pts[0]);
      if (r <= 1e-12) return;
      this.h.doc.edit('Arco', () => { this.h.doc.add({ t: 'arc', c, r, a0: angleOf(c, this.pts[0]), a1: angleOf(c, p), layer: L }); });
      this.h.done();
      return;
    }
    this.pts.push(p);
    this.base = p;
    if (this.pts.length === 1) this.ask('Specificare secondo punto');
    else if (this.pts.length === 2) this.ask('Specificare punto finale');
    else {
      const a = arc3(this.pts[0], this.pts[1], this.pts[2]);
      if (!a) { this.pts.pop(); this.h.msg('I tre punti sono allineati.'); return; }
      this.h.doc.edit('Arco', () => { this.h.doc.add({ t: 'arc', ...a, layer: L }); });
      this.h.done();
    }
  }

  preview(p: Vec): NewEnt[] {
    const L = this.h.doc.current;
    if (this.byCenter && this.center && this.pts.length === 1) {
      const c = this.center;
      return [{ t: 'arc', c, r: dist(c, this.pts[0]), a0: angleOf(c, this.pts[0]), a1: angleOf(c, p), layer: L }];
    }
    if (!this.byCenter && this.pts.length === 2) {
      const a = arc3(this.pts[0], this.pts[1], p);
      return a ? [{ t: 'arc', ...a, layer: L }] : [];
    }
    if (!this.byCenter && this.pts.length === 1) return [{ t: 'line', a: this.pts[0], b: p, layer: L }];
    return [];
  }
}

// ---------------------------------------------------------------- TESTO

export class TextTool extends Tool {
  readonly name = 'TESTO';
  static ha: HAlign = 'l';
  private p: Vec | null = null;
  private hgt = 0;
  private rot = 0;
  private step: 'p' | 'h' | 'r' | 'txt' | 'just' = 'p';
  private typed = '';
  /** altezza e rotazione già date nella finestra: dopo il punto si scrive subito */
  private fromForm = false;

  start() {
    const s = this.h.doc.settings;
    this.hgt = s.textH;
    this.withForm({
      title: 'Testo',
      fields: [
        { k: 'num', key: 'h', label: 'Altezza', unit: s.units, value: s.textH },
        { k: 'num', key: 'rot', label: 'Rotazione', unit: '°', value: 0, free: true },
        { k: 'choice', key: 'ha', label: 'Allineamento', value: TextTool.ha, options: [['l', 'Sinistra'], ['c', 'Centro'], ['r', 'Destra']] },
      ],
    }, v => {
      if (v) {
        this.hgt = s.textH = v.h as number;
        this.rot = ((v.rot as number) * Math.PI) / 180;
        TextTool.ha = v.ha as HAlign;
        this.fromForm = true;
      }
      this.askPoint();
    });
  }

  private askPoint() {
    this.step = 'p';
    this.ask('Specificare punto di inserimento o', [O('G', 'Giustificazione')]);
  }

  option(k: string) {
    if (this.step === 'just') {
      TextTool.ha = k === 'C' ? 'c' : k === 'D' ? 'r' : 'l';
      this.askPoint();
      return;
    }
    if (k === 'G') { this.step = 'just'; this.ask('Giustificazione', [O('S', 'Sinistra'), O('C', 'Centro'), O('D', 'Destra')], undefined, 'none'); }
  }

  point(p: Vec) {
    if (this.step === 'p' && this.fromForm) { this.p = p; this.askText(); }
    else if (this.step === 'p') {
      this.p = p; this.base = p; this.step = 'h'; this.numberAsText = true;
      this.ask('Specificare altezza', [], fmtLen(this.hgt));
    } else if (this.step === 'h' && this.p) {
      const d = dist(this.p, p);
      if (d > 0) { this.hgt = d; this.askRot(); }
    } else if (this.step === 'r' && this.p) {
      this.rot = angleOf(this.p, p);
      this.askText();
    }
  }

  private askRot() { this.step = 'r'; this.ask('Specificare angolo di rotazione', [], '0'); }
  /** Il testo si scrive in un riquadro a più righe accanto al punto, con l'anteprima nel disegno. */
  private askText() {
    this.step = 'txt'; this.base = null; this.typed = '';
    this.ask('Scrivere il testo nel riquadro (Invio = a capo, Ctrl+Invio = conferma)', [], undefined, 'none');
    const p = this.p!;
    void this.h.write({ title: 'Testo', at: p, onInput: s => { this.typed = s; this.h.refresh(); } }).then(raw => {
      if (this.step !== 'txt' || this.p !== p) return; // comando annullato nel frattempo
      const s = (raw ?? '').replace(/\s+$/, '');
      if (s.trim()) this.h.doc.edit('Testo', () => { this.h.doc.add(this.make(p, s)); });
      this.h.done();
    });
  }

  /** La prima riga sta sul punto cliccato, le altre scendono. */
  private make(p: Vec, s: string): NewEnt {
    return retext({ t: 'text' as const, p, s: '', h: this.hgt, rot: this.rot, ha: TextTool.ha, va: 'b' as const, layer: this.h.doc.current }, s);
  }

  cancel() { this.step = 'p'; this.p = null; }

  text(s: string): boolean {
    if (this.step === 'h') {
      const n = parseNum(s);
      if (n === null || n <= 0) return false;
      this.hgt = n; this.h.doc.settings.textH = n; this.askRot(); return true;
    }
    if (this.step === 'r') {
      const a = parseAngle(s);
      if (a === null) return false;
      this.rot = a; this.askText(); return true;
    }
    return false;
  }

  enter() {
    if (this.step === 'h') this.askRot();
    else if (this.step === 'r') this.askText();
    else this.h.done();
  }

  typing(s: string) { this.typed = s; }

  preview(p: Vec): NewEnt[] {
    const L = this.h.doc.current;
    if (this.step === 'txt' && this.p) {
      return [this.make(this.p, this.typed || '|')];
    }
    if (this.step === 'p') return [{ t: 'text', p, s: 'Testo', h: this.hgt, rot: this.fromForm ? this.rot : 0, ha: TextTool.ha, va: 'b', layer: L }];
    return [];
  }
}

// ---------------------------------------------------------------- TRATTEGGIO

/** Retini: sigla per sceglierli dall'opzione Pattern, nome mostrato. */
export const PAT_OPTS: [string, string, HatchPattern][] = [
  ['PI', 'PIeno', 'solid'], ['45', '45 gradi', 'ansi31'], ['D', 'Doppie a 45 (muratura)', 'ansi32'], ['X', 'incrociato (X)', 'ansi37'], ['LI', 'LInee', 'lines'],
  ['Q', 'Quadretti', 'grid'], ['M', 'Mattoni', 'brick'], ['LS', 'ListoniSfalsati', 'plank'], ['S', 'Spina di pesce', 'herring'],
  ['T', 'Tratteggiate', 'dash'], ['PU', 'PUntinato', 'dots'], ['Z', 'Zig-zag (isolante)', 'zigzag'], ['C', 'Calcestruzzo', 'concrete'],
];
const PATTERNS: Record<string, HatchPattern> = {
  SOLIDO: 'solid', SOLID: 'solid', PIENO: 'solid', ANSI31: 'ansi31', ANSI32: 'ansi32', MURATURA: 'ansi32', ANSI37: 'ansi37', LINEE: 'lines', QUADRETTI: 'grid',
  PIASTRELLE: 'grid', MATTONI: 'brick', LISTONI: 'plank', PARQUET: 'plank', SPINA: 'herring', SPINADIPESCE: 'herring', TRATTEGGIATE: 'dash', PUNTINATO: 'dots',
  ZIGZAG: 'zigzag', ISOLANTE: 'zigzag', CALCESTRUZZO: 'concrete', CLS: 'concrete',
};

const TILE_SQ = [v(0, 0), v(100, 0), v(100, 75), v(0, 75)];

/** Riquadri con il disegno di ogni retino, per sceglierli in una finestra; normal = anche il riempimento normale dei muri. */
export function patternTiles(normal = false): { value: string; label: string; prims: Prim[] }[] {
  const frame: Prim = { k: 'pl', pts: TILE_SQ, closed: true };
  const out = PAT_OPTS.map(([, , pat]) => ({ value: pat as string, label: HATCH_NAMES[pat], prims: [frame, ...prims({ id: 0, layer: '0', t: 'hatch', loops: [TILE_SQ], pat, sp: 10, ang: 0 })] }));
  if (normal) out.unshift({ value: '', label: 'Normale (pieno)', prims: [{ k: 'pl', pts: TILE_SQ, closed: true, fill: 'wall' }] });
  return out;
}

export class HatchTool extends Tool {
  readonly name = 'TRATTEGGIO';
  static pat: HatchPattern = 'ansi31';
  static ang = 0;
  private sub: '' | 'pat' | 'sp' | 'ang' | 'obj' = '';
  private made = 0;

  start() { this.settings(); }

  /** Retino, passo e angolo nella finestra (con le finestre accese), poi la richiesta del punto interno. */
  private settings() {
    const s = this.h.doc.settings;
    this.withForm({
      title: 'Tratteggio',
      fields: [
        { k: 'tiles', key: 'pat', label: 'Retino', value: HatchTool.pat, tiles: patternTiles() },
        { k: 'num', key: 'sp', label: 'Passo (più grande = retino più largo)', unit: s.units, value: s.hatchSp },
        { k: 'num', key: 'ang', label: 'Angolo', unit: '°', value: Math.round(((HatchTool.ang * 180) / Math.PI) * 1000) / 1000, free: true },
      ],
    }, v => {
      if (v) { HatchTool.pat = v.pat as HatchPattern; s.hatchSp = v.sp as number; HatchTool.ang = ((v.ang as number) * Math.PI) / 180; }
      this.prompt();
    });
  }

  private prompt() {
    this.sub = '';
    const name = HATCH_NAMES[HatchTool.pat];
    this.ask(`Specificare punto interno (${name}, passo ${fmtLen(this.h.doc.settings.hatchSp)}) o`, [O('S', 'Selezionare oggetto'), O('P', 'Pattern'), O('PA', 'PAsso'), O('AN', 'ANgolo')]);
  }

  option(k: string) {
    if (this.sub === 'pat') {
      HatchTool.pat = PAT_OPTS.find(o => o[0] === k)?.[2] ?? HatchTool.pat;
      this.prompt();
      return;
    }
    if (k === 'S') { this.sub = 'obj'; this.ask('Selezionare polilinea chiusa, cerchio o locale', [], undefined, 'entity'); }
    else if (k === 'P' && this.h.dialogs) this.settings();
    else if (k === 'P') { this.sub = 'pat'; this.ask('Retino', PAT_OPTS.map(o => O(o[0], o[1])), undefined, 'none'); }
    else if (k === 'PA') { this.sub = 'sp'; this.numberAsText = true; this.ask('Passo del retino (più grande = retino più largo)', [], fmtLen(this.h.doc.settings.hatchSp)); }
    else if (k === 'AN') { this.sub = 'ang'; this.numberAsText = true; this.ask('Angolo aggiuntivo del pattern', [], fmtLen((HatchTool.ang * 180) / Math.PI)); }
  }

  text(s: string): boolean {
    if (this.sub === 'sp') { const n = parseNum(s); if (n === null || n <= 0) return false; this.h.doc.settings.hatchSp = n; this.numberAsText = false; this.prompt(); return true; }
    if (this.sub === 'ang') { const a = parseAngle(s); if (a === null) return false; HatchTool.ang = a; this.numberAsText = false; this.prompt(); return true; }
    const p = PATTERNS[s.trim().toUpperCase()];
    if (p) { HatchTool.pat = p; this.prompt(); return true; }
    return false;
  }

  private create(loops: Vec[][]) {
    this.h.doc.edit('Tratteggio', () => {
      this.h.doc.ensureLayer('TRATTEGGI');
      this.h.doc.add({ t: 'hatch', loops, pat: HatchTool.pat, sp: this.h.doc.settings.hatchSp, ang: HatchTool.ang, layer: 'TRATTEGGI' });
    });
    this.made++;
  }

  point(p: Vec) {
    const doc = this.h.doc;
    const vis = doc.ents.filter(e => doc.layer(e.layer).visible);
    const found = closedLoopAt(vis, p);
    let loop = found?.loop ?? null;
    let islands: Vec[][] = found ? islandsIn(vis, found.loop, found.id) : [];
    const region = findRegion(vis, doc.ctx(), p, doc.settings.wallTh * 30, doc.extents());
    if (region && (!loop || Math.abs(areaOf(region)) < Math.abs(areaOf(loop)))) { loop = region; islands = []; }
    if (!loop) { this.h.msg('Nessun contorno chiuso attorno al punto.'); return; }
    this.create([loop, ...islands]);
    this.prompt();
  }

  entity(e: Ent) {
    let loop: Vec[] | null = null;
    if (e.t === 'poly' && e.closed) loop = polyPoints(e);
    else if (e.t === 'room') loop = e.pts;
    else if (e.t === 'circle') loop = tessArc(e.c, e.r, 0, TAU).slice(0, -1);
    if (!loop) { this.h.msg('Serve un contorno chiuso.'); return; }
    this.create([loop]);
    this.prompt();
  }

  enter() {
    if (this.sub) { this.numberAsText = false; this.prompt(); return; }
    this.h.done();
  }
}

function areaOf(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i], pts[(i + 1) % pts.length]);
  return s / 2;
}

export { len };
