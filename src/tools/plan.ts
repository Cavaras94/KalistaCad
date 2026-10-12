// Comandi da planimetria: muri, porte, finestre, locali, quote.
import type { Ent, NewEnt, WallE, DimE } from '../model/entities';
import { polyPoints, dimGeometry, editCurves } from '../model/entities';
import { offsetPolyPts } from '../model/ops';
import { findRegion } from '../model/region';
import { Vec, Curve, Seg, add, sub, mul, dot, dist, norm, perp, angleOf, same, closestOnSeg, distToCurve, lineLine, arcStart, arcEnd } from '../model/geom';
import { Tool, O, parseNum, fmtLen } from './base';
import type { Host } from './base';

// ---------------------------------------------------------------- MURO

type Just = 'C' | 'S' | 'D';
const JUST_NAME: Record<Just, string> = { C: 'centro', S: 'filo sinistro', D: 'filo destro' };

export class WallTool extends Tool {
  readonly name = 'MURO';
  static just: Just = 'C';
  private pts: Vec[] = [];
  private sub: '' | 'th' | 'just' = '';

  start() { this.prompt(); }

  private prompt() {
    const s = this.h.doc.settings;
    const info = `(spessore ${fmtLen(s.wallTh)}, ${JUST_NAME[WallTool.just]})`;
    const opts = [O('S', 'Spessore'), O('G', 'Giustificazione')];
    if (!this.pts.length) { this.ask(`Specificare punto iniziale ${info} o`, opts); return; }
    if (this.pts.length >= 3) opts.push(O('C', 'Chiudi'));
    opts.push(O('A', 'Annulla'));
    this.ask(`Specificare punto successivo ${info} o`, opts);
  }

  option(k: string) {
    if (this.sub === 'just') { WallTool.just = k as Just; this.sub = ''; this.prompt(); return; }
    // richiesta solo numerica: un clic qui non deve aggiungere un vertice
    if (k === 'S') { this.sub = 'th'; this.ask('Spessore del muro', [], fmtLen(this.h.doc.settings.wallTh), 'none'); }
    else if (k === 'G') { this.sub = 'just'; this.ask('Giustificazione', [O('C', 'Centro'), O('S', 'Sinistra'), O('D', 'Destra')], undefined, 'none'); }
    else if (k === 'C') this.commit(true);
    else if (k === 'A') {
      this.pts.pop();
      this.base = this.pts[this.pts.length - 1] ?? null;
      this.prompt();
    }
  }

  text(s: string): boolean {
    if (this.sub !== 'th') return false;
    const n = parseNum(s);
    if (n === null || n <= 0) return false;
    this.h.doc.settings.wallTh = n;
    this.sub = ''; this.numberAsText = false;
    this.prompt();
    return true;
  }

  point(p: Vec) {
    if (this.pts.length && same(this.pts[this.pts.length - 1], p, 1e-12)) return;
    this.pts.push(p);
    this.base = p;
    this.prompt();
  }

  private walls(pts: Vec[], closed: boolean): NewEnt[] {
    if (pts.length < 2) return [];
    const th = this.h.doc.settings.wallTh;
    const off = WallTool.just === 'C' ? 0 : WallTool.just === 'S' ? -th / 2 : th / 2;
    const axis = off === 0 ? pts : offsetPolyPts(pts, closed, off);
    if (!axis) return [];
    const out: NewEnt[] = [];
    const n = axis.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      out.push({ t: 'wall', a: axis[i], b: axis[(i + 1) % n], th, layer: 'MURI' });
    }
    return out;
  }

  private commit(closed: boolean) {
    const list = this.walls(this.pts, closed && this.pts.length >= 3);
    if (list.length) this.h.doc.edit('Muro', () => { this.h.doc.ensureLayer('MURI'); this.h.doc.addMany(list); });
    this.h.done();
  }

  enter() {
    if (this.sub) { this.sub = ''; this.numberAsText = false; this.prompt(); return; }
    this.commit(false);
  }

  preview(p: Vec): NewEnt[] {
    if (!this.pts.length || this.sub) return [];
    return this.walls([...this.pts, p], false);
  }
}

// ---------------------------------------------------------------- PORTA / FINESTRA

abstract class OpeningTool extends Tool {
  protected wall: WallE | null = null;
  protected s = 0; // ascissa del centro lungo il muro
  protected sw: 1 | -1 = 1;
  protected hg: 1 | -1 = 1;
  protected pickPt: Vec | null = null;
  private sub: '' | 'w' = '';
  abstract readonly kind: 'door' | 'window';

  protected abstract get width(): number;
  protected abstract set width(w: number);

  start() {
    this.wall = null; this.sub = ''; this.numberAsText = false;
    this.ask(`Specificare punto sul muro (larghezza ${fmtLen(this.width)}) o`, [O('L', 'Larghezza')]);
  }

  option(k: string) {
    if (k === 'L') { this.sub = 'w'; this.ask('Larghezza del vano', [], fmtLen(this.width), 'none'); }
  }

  private axis(w: WallE) {
    const u = norm(sub(w.b, w.a));
    return { u, n: perp(u), L: dist(w.a, w.b) };
  }

  private clampS(s: number): number {
    const { L } = this.axis(this.wall!);
    return Math.max(this.width / 2, Math.min(L - this.width / 2, s));
  }

  point(p: Vec) {
    if (!this.wall) {
      const w = this.h.pick(p, e => e.t === 'wall') as WallE | null;
      if (!w) { this.h.msg('Nessun muro in quel punto.'); return; }
      const { u, L } = this.axis(w);
      if (L < this.width) { this.h.msg('Il muro è più corto del vano.'); return; }
      this.wall = w;
      this.pickPt = p;
      this.s = this.clampS(dot(sub(closestOnSeg(p, w.a, w.b).p, w.a), u));
      this.numberAsText = true;
      this.ask(this.kind === 'door'
        ? 'Specificare verso di apertura o distanza dallo spigolo più vicino'
        : 'Confermare con un clic o specificare distanza dallo spigolo più vicino', [O('L', 'Larghezza')]);
      return;
    }
    this.orient(p);
    this.place();
  }

  private orient(p: Vec) {
    if (!this.wall) return;
    const { u, n } = this.axis(this.wall);
    const c = add(this.wall.a, mul(u, this.s));
    this.sw = dot(sub(p, c), n) >= 0 ? 1 : -1;
    this.hg = dot(sub(p, c), u) >= 0 ? 1 : -1;
  }

  text(str: string): boolean {
    const n = parseNum(str);
    if (n === null) return false;
    if (this.sub === 'w') {
      if (n <= 0) return false;
      this.width = n;
      this.sub = '';
      if (this.wall) { this.s = this.clampS(this.s); this.numberAsText = true; this.ask('Specificare verso o distanza dallo spigolo più vicino', [O('L', 'Larghezza')]); }
      else this.start();
      return true;
    }
    if (!this.wall || n < 0) return false;
    const { u, L } = this.axis(this.wall);
    const fromA = dot(sub(this.pickPt!, this.wall.a), u) < L / 2;
    // La distanza si conta dallo spigolo che si vede dentro la stanza: dove il muro fa angolo con un
    // altro, l'asse arriva mezzo spessore più in là della faccia interna.
    const info = this.h.doc.ctx().walls?.walls.get(this.wall.id);
    const joined = info ? !(fromA ? info.capS : info.capE) : false;
    const off = joined ? this.wall.th / 2 : 0;
    this.s = this.clampS(fromA ? n + off + this.width / 2 : L - n - off - this.width / 2);
    this.h.msg(`Vano a ${fmtLen(n)} ${joined ? 'dallo spigolo interno' : 'dalla fine del muro'}.`);
    if (this.kind === 'window') this.place();
    return true;
  }

  enter() {
    if (this.sub) {
      // Invio alla richiesta della larghezza: resta quella proposta e si torna dov'eravamo
      this.sub = '';
      if (this.wall) { this.numberAsText = true; this.ask('Specificare verso o distanza dallo spigolo più vicino', [O('L', 'Larghezza')]); }
      else this.start();
      return;
    }
    if (this.wall) { this.place(); return; }
    this.h.done();
  }

  protected entityAt(): NewEnt | null {
    if (!this.wall) return null;
    const { u } = this.axis(this.wall);
    const p = add(this.wall.a, mul(u, this.s));
    const ang = Math.atan2(u.y, u.x);
    const th = this.wall.th;
    return this.kind === 'door'
      ? { t: 'door', p, ang, w: this.width, th, sw: this.sw, hg: this.hg, layer: 'SERRAMENTI' }
      : { t: 'window', p, ang, w: this.width, th, layer: 'SERRAMENTI' };
  }

  private place() {
    const e = this.entityAt();
    if (!e) return;
    this.h.doc.edit(this.kind === 'door' ? 'Porta' : 'Finestra', () => { this.h.doc.ensureLayer('SERRAMENTI'); this.h.doc.add(e); });
    this.start();
  }

  preview(p: Vec): NewEnt[] {
    if (!this.wall) return [];
    this.orient(p);
    const e = this.entityAt();
    return e ? [e] : [];
  }
}

export class DoorTool extends OpeningTool {
  readonly name = 'PORTA';
  readonly kind = 'door' as const;
  protected get width() { return this.h.doc.settings.doorW; }
  protected set width(w: number) { this.h.doc.settings.doorW = w; }
}

export class WindowTool extends OpeningTool {
  readonly name = 'FINESTRA';
  readonly kind = 'window' as const;
  protected get width() { return this.h.doc.settings.windowW; }
  protected set width(w: number) { this.h.doc.settings.windowW = w; }
}

// ---------------------------------------------------------------- LOCALE

export class RoomTool extends Tool {
  readonly name = 'LOCALE';
  static lastName = 'Locale';
  private pts: Vec[] = [];
  private pending: Vec[] | null = null;
  private manual = false;

  start() {
    this.pts = []; this.pending = null; this.manual = false; this.base = null;
    this.ask('Fare clic dentro il locale o', [O('V', 'Vertici'), O('O', 'Oggetto')]);
  }

  option(k: string) {
    if (k === 'V') { this.manual = true; this.ask('Specificare primo vertice'); }
    else if (k === 'O') this.ask('Selezionare polilinea chiusa', [], undefined, 'entity');
  }

  point(p: Vec) {
    if (this.manual) {
      this.pts.push(p);
      this.base = p;
      this.ask(this.pts.length < 3 ? 'Specificare vertice successivo' : 'Specificare vertice successivo o Invio per chiudere');
      return;
    }
    const doc = this.h.doc;
    const vis = doc.ents.filter(e => doc.layer(e.layer).visible);
    const loop = findRegion(vis, doc.ctx(), p, doc.settings.wallTh * 30, doc.extents());
    if (!loop) { this.h.msg('Non trovo un contorno chiuso attorno al punto: usare l\'opzione Vertici.'); return; }
    this.askName(loop);
  }

  entity(e: Ent) {
    if (e.t !== 'poly' || !e.closed) { this.h.msg('Serve una polilinea chiusa.'); return; }
    this.askName(polyPoints(e));
  }

  private askName(pts: Vec[]) {
    this.pending = pts;
    this.base = null;
    this.ask('Nome del locale', [], RoomTool.lastName, 'text');
  }

  text(s: string): boolean {
    if (!this.pending) return false;
    const name = s.trim() || RoomTool.lastName;
    RoomTool.lastName = name;
    const pts = this.pending;
    this.h.doc.edit('Locale', () => { this.h.doc.ensureLayer('LOCALI'); this.h.doc.add({ t: 'room', pts, name, layer: 'LOCALI' }); });
    this.start();
    return true;
  }

  enter() {
    if (this.pending) { this.text(''); return; }
    if (this.manual && this.pts.length >= 3) { this.askName(this.pts); return; }
    this.h.done();
  }

  preview(p: Vec): NewEnt[] {
    if (this.pending) return [{ t: 'room', pts: this.pending, name: RoomTool.lastName, layer: 'LOCALI' }];
    if (this.manual && this.pts.length) return [{ t: 'poly', pts: [...this.pts, p], closed: this.pts.length >= 2, layer: 'LOCALI' }];
    return [];
  }
}

// ---------------------------------------------------------------- QUOTE

export let lastDimId: number | null = null;

export class DimTool extends Tool {
  readonly name: string;
  private a: Vec | null = null;
  private b: Vec | null = null;
  private override: string | undefined;

  constructor(h: Host, private aligned: boolean) {
    super(h);
    this.name = aligned ? 'QUOTA ALLINEATA' : 'QUOTA LINEARE';
  }

  start() { this.ask('Specificare origine della prima linea di estensione o <seleziona oggetto>'); }

  point(p: Vec) {
    if (!this.a) { this.a = p; this.base = p; this.ask('Specificare origine della seconda linea di estensione'); return; }
    if (!this.b) {
      if (same(this.a, p, 1e-12)) return;
      this.b = p; this.base = null;
      this.ask('Specificare posizione della linea di quota o', [O('T', 'Testo')]);
      return;
    }
    this.commit(p);
  }

  entity(e: Ent, p: Vec) {
    let ends: [Vec, Vec] | null = null;
    if (e.t === 'line' || e.t === 'wall') ends = [e.a, e.b];
    else if (e.t === 'poly') {
      let best = Infinity;
      const n = e.pts.length;
      for (let i = 0; i < (e.closed ? n : n - 1); i++) {
        const a = e.pts[i], b = e.pts[(i + 1) % n];
        const d = dist(p, closestOnSeg(p, a, b).p);
        if (d < best) { best = d; ends = [a, b]; }
      }
    }
    if (!ends) { this.h.msg('Selezionare una linea, una polilinea o un muro.'); return; }
    [this.a, this.b] = ends;
    this.ask('Specificare posizione della linea di quota o', [O('T', 'Testo')]);
  }

  option(k: string) {
    if (k === 'T') this.ask('Testo della quota (vuoto = misura)', [], undefined, 'text');
  }

  text(s: string): boolean {
    if (this.mode !== 'text') return false;
    this.override = s.trim() || undefined;
    this.ask('Specificare posizione della linea di quota o', [O('T', 'Testo')]);
    return true;
  }

  enter() {
    if (!this.a) { this.ask('Selezionare l\'oggetto da quotare', [], undefined, 'entity'); return; }
    this.h.done();
  }

  private make(p: Vec): NewEnt | null {
    if (!this.a || !this.b) return null;
    const e: NewEnt = { t: 'dim', a: this.a, b: this.b, p, layer: 'QUOTE' };
    if (!this.aligned) {
      const x0 = Math.min(this.a.x, this.b.x), x1 = Math.max(this.a.x, this.b.x);
      const y0 = Math.min(this.a.y, this.b.y), y1 = Math.max(this.a.y, this.b.y);
      const dx = p.x < x0 ? x0 - p.x : p.x > x1 ? p.x - x1 : 0;
      const dy = p.y < y0 ? y0 - p.y : p.y > y1 ? p.y - y1 : 0;
      e.ang = dx > dy ? Math.PI / 2 : 0;
    }
    if (this.override) e.s = this.override;
    return e;
  }

  private commit(p: Vec) {
    const e = this.make(p);
    if (!e) return;
    this.h.doc.edit('Quota', () => { this.h.doc.ensureLayer('QUOTE'); lastDimId = this.h.doc.add(e).id; });
    this.h.done();
  }

  preview(p: Vec): NewEnt[] {
    if (this.a && !this.b) return [{ t: 'line', a: this.a, b: p, layer: 'QUOTE' }];
    const e = this.make(p);
    return e ? [e] : [];
  }
}

export class DimContinueTool extends Tool {
  readonly name = 'QUOTA CONTINUA';
  private prev: DimE | null = null;

  start() {
    const d = lastDimId !== null ? this.h.doc.byId(lastDimId) : undefined;
    if (d && d.t === 'dim' && !d.k) this.useDim(d);
    else this.ask('Selezionare la quota da continuare', [], undefined, 'entity');
  }

  private useDim(d: DimE) {
    this.prev = d;
    this.base = d.b;
    this.ask('Specificare origine della linea di estensione successiva');
  }

  entity(e: Ent) {
    if (e.t !== 'dim' || e.k) { this.h.msg('Selezionare una quota lineare.'); return; }
    this.useDim(e);
  }

  private make(p: Vec): NewEnt | null {
    const d = this.prev;
    if (!d) return null;
    const g = dimGeometry(d);
    if (!g) return null;
    const ang = d.ang ?? Math.atan2(g.u.y, g.u.x);
    return { t: 'dim', a: d.b, b: p, p: g.b2, ang, layer: d.layer };
  }

  point(p: Vec) {
    const e = this.make(p);
    if (!e) return;
    this.h.doc.edit('Quota continua', () => {
      const added = this.h.doc.add(e) as DimE;
      lastDimId = added.id;
      this.useDim(added);
    });
  }

  enter() { this.h.done(); }

  preview(p: Vec): NewEnt[] {
    const e = this.make(p);
    return e ? [e] : [];
  }
}

/** Quote dalla stessa origine, una sopra l'altra: ogni nuova linea di quota si allontana di un passo. */
export class DimBaselineTool extends Tool {
  readonly name = 'QUOTA LINEA DI BASE';
  private prev: DimE | null = null;

  start() {
    const d = lastDimId !== null ? this.h.doc.byId(lastDimId) : undefined;
    if (d && d.t === 'dim' && !d.k) this.useDim(d);
    else this.ask('Selezionare la quota di base', [], undefined, 'entity');
  }

  private useDim(d: DimE) {
    this.prev = d;
    this.base = d.a;
    this.ask('Specificare origine della linea di estensione successiva');
  }

  entity(e: Ent) {
    if (e.t !== 'dim' || e.k) { this.h.msg('Selezionare una quota lineare.'); return; }
    this.useDim(e);
  }

  private make(p: Vec): NewEnt | null {
    const d = this.prev;
    const g = d && dimGeometry(d);
    if (!d || !g) return null;
    const ang = d.ang ?? Math.atan2(g.u.y, g.u.x);
    // la nuova linea di quota sta più lontana dai punti misurati, dalla stessa parte di quella di prima
    const away = sub(g.a2, d.a);
    const dir = dist(g.a2, d.a) > 1e-9 ? norm(away) : perp(g.u);
    const step = (d.h ?? this.h.doc.settings.dimH) * 2.5;
    const e: NewEnt = { t: 'dim', a: d.a, b: p, p: add(g.a2, mul(dir, step)), ang, layer: d.layer };
    if (d.h !== undefined) e.h = d.h;
    return e;
  }

  point(p: Vec) {
    const e = this.make(p);
    if (!e) return;
    this.h.doc.edit('Quota linea di base', () => {
      const added = this.h.doc.add(e) as DimE;
      lastDimId = added.id;
      this.useDim(added);
    });
  }

  preview(p: Vec): NewEnt[] {
    const e = this.make(p);
    return e ? [e] : [];
  }
}

/** Direttrice: freccia sul primo punto, spezzata, testo in fondo. */
export class LeaderTool extends Tool {
  readonly name = 'DIRETTRICE';
  private pts: Vec[] = [];

  start() { this.ask('Specificare la punta della freccia'); }

  point(p: Vec) {
    const n = this.pts.length;
    if (n && dist(this.pts[n - 1], p) < 1e-9) return;
    this.pts.push(p);
    this.base = p;
    this.ask(n ? 'Specificare punto successivo (Invio per scrivere il testo) o' : 'Specificare punto successivo o', [O('A', 'Annulla')]);
  }

  option(k: string) {
    if (k !== 'A' || this.mode === 'text') return;
    this.pts.pop();
    const n = this.pts.length;
    this.base = this.pts[n - 1] ?? null;
    if (!n) this.start();
    else this.ask(n > 1 ? 'Specificare punto successivo (Invio per scrivere il testo) o' : 'Specificare punto successivo o', [O('A', 'Annulla')]);
  }

  enter() {
    if (this.pts.length < 2) { super.enter(); return; }
    this.ask('Testo della direttrice', [], undefined, 'text');
  }

  text(raw: string): boolean {
    if (this.mode !== 'text') return false;
    const doc = this.h.doc;
    const pts = this.pts;
    doc.edit('Direttrice', () => { doc.ensureLayer('QUOTE'); doc.add({ t: 'leader', pts, s: raw.trim(), layer: 'QUOTE' }); });
    this.h.done();
    return true;
  }

  preview(p: Vec): NewEnt[] {
    if (!this.pts.length || this.mode === 'text') return this.pts.length > 1 ? [{ t: 'leader', pts: this.pts, s: '', layer: 'QUOTE' }] : [];
    return [{ t: 'leader', pts: [...this.pts, p], s: '', layer: 'QUOTE' }];
  }
}

/** Tratto dell'entità (segmento o arco) più vicino al punto cliccato. */
function nearestCurve(curves: Curve[], p: Vec): Curve | null {
  let best: Curve | null = null, bd = Infinity;
  for (const c of curves) { const d = distToCurve(p, c); if (d < bd) { bd = d; best = c; } }
  return best;
}

export class DimRadiusTool extends Tool {
  readonly name: string;
  private c: Vec | null = null;
  private r = 0;

  constructor(h: Host, private dia: boolean) {
    super(h);
    this.name = dia ? 'QUOTA DIAMETRO' : 'QUOTA RAGGIO';
  }

  start() { this.ask('Selezionare un arco o un cerchio', [], undefined, 'entity'); }

  entity(e: Ent, p: Vec) {
    const cv = nearestCurve(editCurves(e, this.h.doc.ctx()).filter(c => c.k === 'a'), p);
    if (!cv || cv.k !== 'a') { this.h.msg('Selezionare un arco o un cerchio.'); return; }
    this.c = cv.c;
    this.r = cv.r;
    this.ask('Specificare posizione del testo di quota');
  }

  private make(p: Vec): NewEnt | null {
    if (!this.c) return null;
    const d = sub(p, this.c);
    const u = dist(p, this.c) < 1e-9 ? { x: 1, y: 0 } : norm(d);
    return { t: 'dim', k: this.dia ? 'dia' : 'rad', a: this.c, b: add(this.c, mul(u, this.r)), p, layer: 'QUOTE' };
  }

  point(p: Vec) {
    const e = this.make(p);
    if (!e) return;
    this.h.doc.edit('Quota', () => { this.h.doc.ensureLayer('QUOTE'); this.h.doc.add(e); });
    this.h.done();
  }

  preview(p: Vec): NewEnt[] {
    const e = this.make(p);
    return e ? [e] : [];
  }
}

export class DimAngularTool extends Tool {
  readonly name = 'QUOTA ANGOLARE';
  private first: { s: Seg; p: Vec } | null = null;
  private geo: { a: Vec; b: Vec; c: Vec } | null = null;

  start() { this.ask('Selezionare la prima linea, oppure un arco', [], undefined, 'entity'); }

  entity(e: Ent, p: Vec) {
    const cv = nearestCurve(editCurves(e, this.h.doc.ctx()), p);
    if (!cv) { this.h.msg('Selezionare una linea, una polilinea, un muro o un arco.'); return; }
    if (!this.first) {
      if (cv.k === 'a') {
        if (cv.full) { this.h.msg('Un cerchio non ha un angolo: selezionare un arco o due linee.'); return; }
        this.geo = { a: cv.c, b: arcStart(cv), c: arcEnd(cv) };
        this.askPos();
        return;
      }
      this.first = { s: cv, p };
      this.h.setSelection([e.id]);
      this.ask('Selezionare la seconda linea', [], undefined, 'entity');
      return;
    }
    if (cv.k !== 's') { this.h.msg('Selezionare una linea.'); return; }
    const X = lineLine(this.first.s.a, this.first.s.b, cv.a, cv.b);
    if (!X) { this.h.msg('Le due linee sono parallele.'); return; }
    // lato dell'angolo: l'estremo del segmento dalla parte del clic rispetto al vertice
    const side = (s: Seg, pick: Vec): Vec | null => {
      const q = closestOnSeg(pick, s.a, s.b).p;
      const dir = dist(q, X.p) > 1e-6 ? sub(q, X.p) : sub(dist(s.a, X.p) > dist(s.b, X.p) ? s.a : s.b, X.p);
      const end = dot(sub(s.a, X.p), dir) > dot(sub(s.b, X.p), dir) ? s.a : s.b;
      return dist(end, X.p) > 1e-6 ? end : null;
    };
    const b = side(this.first.s, this.first.p), c = side(cv, p);
    if (!b || !c) { this.h.msg('Linee troppo corte per quotare l\'angolo.'); return; }
    this.geo = { a: X.p, b, c };
    this.h.setSelection([]);
    this.askPos();
  }

  private askPos() {
    this.base = this.geo!.a;
    this.ask('Specificare posizione dell\'arco di quota');
  }

  private make(p: Vec): NewEnt | null {
    if (!this.geo || dist(p, this.geo.a) < 1e-9) return null;
    return { t: 'dim', k: 'ang', ...this.geo, p, layer: 'QUOTE' };
  }

  point(p: Vec) {
    const e = this.make(p);
    if (!e) return;
    this.h.doc.edit('Quota', () => { this.h.doc.ensureLayer('QUOTE'); this.h.doc.add(e); });
    this.h.done();
  }

  preview(p: Vec): NewEnt[] {
    const e = this.make(p);
    return e ? [e] : [];
  }

  enter() { this.h.setSelection([]); this.h.done(); }

  cancel() { this.h.setSelection([]); }
}

export { angleOf };
