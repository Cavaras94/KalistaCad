// Comandi di disegno.
import type { Ent, NewEnt, HAlign, HatchPattern } from '../model/entities';
import { arc3 } from '../model/entities';
import { closedLoopAt, islandsIn } from '../model/ops';
import { findRegion } from '../model/region';
import { polyPoints } from '../model/entities';
import { Vec, v, add, sub, mul, dist, angleOf, same, dirOf, norm, cross, dot, len, mid, TAU, tessArc } from '../model/geom';
import { Tool, O, parseNum, parseAngle, fmtLen } from './base';

// ---------------------------------------------------------------- LINEA

export class LineTool extends Tool {
  readonly name = 'LINEA';
  private pts: Vec[] = [];
  private created = 0;

  start() { this.ask('Specificare punto iniziale'); }

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
  start() { this.ask('Specificare primo angolo'); }
  point(p: Vec) {
    if (!this.a) { this.a = p; this.base = p; this.ask('Specificare angolo opposto (oppure @larghezza,altezza)'); return; }
    if (Math.abs(p.x - this.a.x) < 1e-12 || Math.abs(p.y - this.a.y) < 1e-12) return;
    const e = this.rect(this.a, p);
    this.h.doc.edit('Rettangolo', () => { this.h.doc.add(e); });
    this.h.done();
  }
  private rect(a: Vec, b: Vec): NewEnt {
    return { t: 'poly', pts: [a, v(b.x, a.y), b, v(a.x, b.y)], closed: true, layer: this.h.doc.current };
  }
  preview(p: Vec): NewEnt[] { return this.a ? [this.rect(this.a, p)] : []; }
}

// ---------------------------------------------------------------- CERCHIO

export class CircleTool extends Tool {
  readonly name = 'CERCHIO';
  static lastR = 0;
  private c: Vec | null = null;
  private diam = false;
  private how: 'cr' | '2p' | '3p' = 'cr';
  private pts: Vec[] = [];

  start() { this.ask('Specificare centro o', [O('3P', '3Punti'), O('2P', '2Punti')]); }

  option(k: string) {
    if (k === '3P') { this.how = '3p'; this.ask('Specificare primo punto sulla circonferenza'); }
    else if (k === '2P') { this.how = '2p'; this.ask('Specificare primo estremo del diametro'); }
    else if (k === 'D') { this.diam = true; this.ask('Specificare diametro', [], CircleTool.lastR ? fmtLen(CircleTool.lastR * 2) : undefined); }
  }

  private make(c: Vec, r: number) {
    if (r <= 1e-12) return;
    CircleTool.lastR = r;
    this.h.doc.edit('Cerchio', () => { this.h.doc.add({ t: 'circle', c, r, layer: this.h.doc.current }); });
    this.h.done();
  }

  point(p: Vec) {
    if (this.how === '3p') {
      this.pts.push(p);
      this.base = p;
      if (this.pts.length === 1) this.ask('Specificare secondo punto');
      else if (this.pts.length === 2) this.ask('Specificare terzo punto');
      else { const a = arc3(this.pts[0], this.pts[1], this.pts[2]); if (a) this.make(a.c, a.r); }
      return;
    }
    if (this.how === '2p') {
      this.pts.push(p);
      this.base = p;
      if (this.pts.length === 1) this.ask('Specificare secondo estremo del diametro');
      else this.make(mid(this.pts[0], this.pts[1]), dist(this.pts[0], this.pts[1]) / 2);
      return;
    }
    if (!this.c) {
      this.c = p;
      this.base = p;
      this.numberAsText = true;
      this.ask('Specificare raggio o', [O('D', 'Diametro')], CircleTool.lastR ? fmtLen(CircleTool.lastR) : undefined);
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
    if (this.c && CircleTool.lastR) this.make(this.c, CircleTool.lastR);
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

  start() {
    this.hgt = this.h.doc.settings.textH;
    this.step = 'p';
    this.ask('Specificare punto di inserimento o', [O('G', 'Giustificazione')]);
  }

  option(k: string) {
    if (this.step === 'just') {
      TextTool.ha = k === 'C' ? 'c' : k === 'D' ? 'r' : 'l';
      this.start();
      return;
    }
    if (k === 'G') { this.step = 'just'; this.ask('Giustificazione', [O('S', 'Sinistra'), O('C', 'Centro'), O('D', 'Destra')], undefined, 'none'); }
  }

  point(p: Vec) {
    if (this.step === 'p') {
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
  private askText() { this.step = 'txt'; this.base = null; this.ask('Inserire testo (Invio su riga vuota per finire)', [], undefined, 'text'); }

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
    if (this.step === 'txt' && this.p) {
      if (!s) { this.h.done(); return true; }
      const p = this.p;
      this.h.doc.edit('Testo', () => {
        this.h.doc.add({ t: 'text', p, s, h: this.hgt, rot: this.rot, ha: TextTool.ha, va: 'b', layer: this.h.doc.current });
      });
      this.p = add(p, mul(dirOf(this.rot - Math.PI / 2), this.hgt * 1.5));
      this.typed = '';
      this.askText();
      return true;
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
      return [{ t: 'text', p: this.p, s: this.typed || '|', h: this.hgt, rot: this.rot, ha: TextTool.ha, va: 'b', layer: L }];
    }
    if (this.step === 'p') return [{ t: 'text', p, s: 'Testo', h: this.hgt, rot: 0, ha: TextTool.ha, va: 'b', layer: L }];
    return [];
  }
}

// ---------------------------------------------------------------- TRATTEGGIO

const PATTERNS: Record<string, HatchPattern> = { SOLIDO: 'solid', SOLID: 'solid', ANSI31: 'ansi31', ANSI37: 'ansi37' };

export class HatchTool extends Tool {
  readonly name = 'TRATTEGGIO';
  static pat: HatchPattern = 'ansi31';
  static ang = 0;
  static sp = 0;
  private sub: '' | 'pat' | 'sp' | 'ang' | 'obj' = '';
  private made = 0;

  start() {
    if (!HatchTool.sp) HatchTool.sp = this.h.doc.settings.hatchSp;
    this.sub = '';
    const name = HatchTool.pat === 'solid' ? 'SOLIDO' : HatchTool.pat.toUpperCase();
    this.ask(`Specificare punto interno (${name}, passo ${fmtLen(HatchTool.sp)}) o`, [O('S', 'Selezionare oggetto'), O('P', 'Pattern'), O('PA', 'PAsso'), O('AN', 'ANgolo')]);
  }

  option(k: string) {
    if (this.sub === 'pat') {
      HatchTool.pat = k === 'SO' ? 'solid' : k === 'A31' ? 'ansi31' : 'ansi37';
      this.start();
      return;
    }
    if (k === 'S') { this.sub = 'obj'; this.ask('Selezionare polilinea chiusa, cerchio o locale', [], undefined, 'entity'); }
    else if (k === 'P') { this.sub = 'pat'; this.ask('Pattern', [O('SO', 'SOlido'), O('A31', 'ANSI31 (linee a 45°)'), O('A37', 'ANSI37 (incrociato)')], undefined, 'none'); }
    else if (k === 'PA') { this.sub = 'sp'; this.numberAsText = true; this.ask('Passo fra le linee', [], fmtLen(HatchTool.sp)); }
    else if (k === 'AN') { this.sub = 'ang'; this.numberAsText = true; this.ask('Angolo aggiuntivo del pattern', [], fmtLen((HatchTool.ang * 180) / Math.PI)); }
  }

  text(s: string): boolean {
    if (this.sub === 'sp') { const n = parseNum(s); if (n === null || n <= 0) return false; HatchTool.sp = n; this.numberAsText = false; this.start(); return true; }
    if (this.sub === 'ang') { const a = parseAngle(s); if (a === null) return false; HatchTool.ang = a; this.numberAsText = false; this.start(); return true; }
    const p = PATTERNS[s.trim().toUpperCase()];
    if (p) { HatchTool.pat = p; this.start(); return true; }
    return false;
  }

  private create(loops: Vec[][]) {
    this.h.doc.edit('Tratteggio', () => {
      this.h.doc.add({ t: 'hatch', loops, pat: HatchTool.pat, sp: HatchTool.sp, ang: HatchTool.ang, layer: 'TRATTEGGI' });
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
    this.start();
  }

  entity(e: Ent) {
    let loop: Vec[] | null = null;
    if (e.t === 'poly' && e.closed) loop = polyPoints(e);
    else if (e.t === 'room') loop = e.pts;
    else if (e.t === 'circle') loop = tessArc(e.c, e.r, 0, TAU).slice(0, -1);
    if (!loop) { this.h.msg('Serve un contorno chiuso.'); return; }
    this.create([loop]);
    this.start();
  }

  enter() {
    if (this.sub) { this.numberAsText = false; this.start(); return; }
    this.h.done();
  }
}

function areaOf(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i], pts[(i + 1) % pts.length]);
  return s / 2;
}

export { len };
