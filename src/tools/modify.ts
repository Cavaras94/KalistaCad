// Comandi di modifica.
import type { Ent, NewEnt, LineE, WallE } from '../model/entities';
import { transform, explode, stretch, entBox, editCurves } from '../model/entities';
import { offsetEnt, trimEnt, extendEnt, fillet, chamfer, arrayRect, arrayPolar, joinEnts, boundaryCurves } from '../model/ops';
import {
  Vec, Box, Mat, Curve, add, sub, dist, angleOf, translate, rotateAbout, scaleAbout, mirrorAcross, inBox, boxOf, emptyBox, boxUnion, boxValid, distToCurve, TAU,
} from '../model/geom';
import { Tool, SelTool, O, parseNum, parseAngle, fmtLen } from './base';

const strip = (e: Ent): NewEnt => { const { id: _id, ...rest } = e; return rest as NewEnt; };

// ---------------------------------------------------------------- CANCELLA

export class EraseTool extends SelTool {
  readonly name = 'CANCELLA';
  afterSelect() {
    const ids = this.selIds;
    this.h.doc.edit('Cancella', () => this.h.doc.remove(ids));
    this.h.msg(`${ids.size} entità cancellate.`);
    this.h.setSelection([]);
    this.h.done();
  }
}

// ---------------------------------------------------------------- SPOSTA / COPIA

abstract class BaseToSecond extends SelTool {
  protected from: Vec | null = null;
  afterSelect() {
    this.snapExclude = this.selIds;
    this.ask('Specificare punto base o', [O('S', 'Spostamento')]);
  }
  option(k: string) {
    // lo spostamento parte da 0,0: anche @dx,dy va contato da lì e non dall'ultimo punto disegnato
    if (k === 'S') { this.from = { x: 0, y: 0 }; this.h.lastPoint = { x: 0, y: 0 }; this.ask('Specificare spostamento come @dx,dy o dx,dy'); }
  }
  point(p: Vec) {
    if (!this.from) { this.from = p; this.base = p; this.ask(this.secondPrompt()); return; }
    this.apply(translate(p.x - this.from.x, p.y - this.from.y));
  }
  protected secondPrompt() { return 'Specificare secondo punto'; }
  protected abstract apply(m: Mat): void;
  ghosts(p: Vec): NewEnt[] {
    if (!this.from || !this.base) return [];
    const m = translate(p.x - this.from.x, p.y - this.from.y);
    return this.sel.map(e => strip(transform(e, m)));
  }
}

export class MoveTool extends BaseToSecond {
  readonly name = 'SPOSTA';
  protected apply(m: Mat) {
    const moved = this.sel.map(e => transform(e, m));
    this.h.doc.edit('Sposta', () => this.h.doc.replace(moved));
    this.h.setSelection([]);
    this.h.done();
  }
}

export class CopyTool extends BaseToSecond {
  readonly name = 'COPIA';
  protected secondPrompt() { return 'Specificare secondo punto (Invio per finire)'; }
  protected apply(m: Mat) {
    const copies = this.sel.map(e => strip(transform(e, m)));
    this.h.doc.edit('Copia', () => this.h.doc.addCopies(copies));
    this.ask(this.secondPrompt());
  }
  enter() { this.h.setSelection([]); this.h.done(); }
}

// ---------------------------------------------------------------- RUOTA

export class RotateTool extends SelTool {
  readonly name = 'RUOTA';
  private c: Vec | null = null;
  private copy = false;
  private ref: { step: 'a1' | 'a2' | 'new'; p1?: Vec; ang?: number } | null = null;

  afterSelect() { this.snapExclude = this.selIds; this.ask('Specificare punto base'); }

  private askAngle() {
    this.numberAsText = true;
    this.ask('Specificare angolo di rotazione o', [O('C', 'Copia'), O('R', 'Riferimento')], '0');
  }

  point(p: Vec) {
    if (!this.c) { this.c = p; this.base = p; this.askAngle(); return; }
    if (this.ref) {
      if (this.ref.step === 'a1') { this.ref = { step: 'a2', p1: p }; this.base = p; this.ask('Specificare secondo punto'); return; }
      if (this.ref.step === 'a2') { this.ref = { step: 'new', ang: angleOf(this.ref.p1!, p) }; this.base = this.c; this.ask('Specificare nuovo angolo'); return; }
      this.apply(angleOf(this.c, p) - (this.ref.ang ?? 0));
      return;
    }
    this.apply(angleOf(this.c, p));
  }

  text(s: string): boolean {
    const a = parseAngle(s);
    if (a === null || !this.c) return false;
    if (this.ref && this.ref.step !== 'new') {
      // angolo di riferimento digitato: ora serve il nuovo angolo
      this.ref = { step: 'new', ang: a };
      this.base = this.c;
      this.ask('Specificare nuovo angolo');
      return true;
    }
    this.apply(this.ref ? a - (this.ref.ang ?? 0) : a);
    return true;
  }

  option(k: string) {
    if (k === 'C') { this.copy = !this.copy; this.h.msg(this.copy ? 'Ruota una copia.' : 'Ruota gli originali.'); this.askAngle(); }
    else if (k === 'R') {
      this.ref = { step: 'a1' };
      this.numberAsText = true;
      this.ask('Specificare angolo di riferimento (o due punti)', [], '0');
    }
  }

  enter() { if (this.c && !this.ref) this.apply(0); else this.h.done(); }

  private apply(ang: number) {
    const m = rotateAbout(this.c!, ang);
    const out = this.sel.map(e => transform(e, m));
    this.h.doc.edit('Ruota', () => (this.copy ? this.h.doc.addCopies(out.map(strip)) : this.h.doc.replace(out)));
    this.h.setSelection([]);
    this.h.done();
  }

  ghosts(p: Vec): NewEnt[] {
    if (!this.c || this.ref) return [];
    const m = rotateAbout(this.c, angleOf(this.c, p));
    return this.sel.map(e => strip(transform(e, m)));
  }
}

// ---------------------------------------------------------------- SPECCHIO

export class MirrorTool extends SelTool {
  readonly name = 'SPECCHIO';
  private p1: Vec | null = null;
  private p2: Vec | null = null;

  afterSelect() { this.snapExclude = this.selIds; this.ask('Specificare primo punto dell\'asse di specchio'); }

  point(p: Vec) {
    if (!this.p1) { this.p1 = p; this.base = p; this.ask('Specificare secondo punto dell\'asse di specchio'); return; }
    if (!this.p2) {
      if (dist(this.p1, p) < 1e-12) return;
      this.p2 = p; this.base = null;
      this.ask('Cancellare le entità di origine?', [O('S', 'Sì'), O('N', 'No')], 'No', 'none');
    }
  }

  option(k: string) { if (this.p2) this.apply(k === 'S'); }
  enter() { if (this.p2) this.apply(false); else this.h.done(); }

  private apply(erase: boolean) {
    const m = mirrorAcross(this.p1!, this.p2!);
    const out = this.sel.map(e => transform(e, m));
    this.h.doc.edit('Specchio', () => (erase ? this.h.doc.replace(out) : this.h.doc.addCopies(out.map(strip))));
    this.h.setSelection([]);
    this.h.done();
  }

  ghosts(p: Vec): NewEnt[] {
    if (!this.p1 || this.p2 || dist(this.p1, p) < 1e-12) return [];
    const m = mirrorAcross(this.p1, p);
    return this.sel.map(e => strip(transform(e, m)));
  }
}

// ---------------------------------------------------------------- SCALA

export class ScaleTool extends SelTool {
  readonly name = 'SCALA';
  private c: Vec | null = null;
  private refLen: number | null = null;
  private refStep: 0 | 1 | 2 | 3 = 0; // 1: primo punto, 2: secondo punto, 3: nuova lunghezza
  private refP1: Vec | null = null;

  afterSelect() { this.snapExclude = this.selIds; this.ask('Specificare punto base'); }

  private askFactor() { this.numberAsText = true; this.ask('Specificare fattore di scala o', [O('R', 'Riferimento')]); }

  point(p: Vec) {
    if (!this.c) { this.c = p; this.base = p; this.askFactor(); return; }
    if (this.refStep === 1) { this.refP1 = p; this.base = p; this.refStep = 2; this.ask('Specificare secondo punto'); return; }
    if (this.refStep === 2) { this.refLen = dist(this.refP1!, p); this.refStep = 3; this.base = this.c; this.ask('Specificare nuova lunghezza'); return; }
    const d = dist(this.c, p);
    this.apply(this.refStep === 3 ? d / (this.refLen || 1) : d);
  }

  text(s: string): boolean {
    const n = parseNum(s);
    if (n === null || n <= 0 || !this.c) return false;
    if (this.refStep === 1 || this.refStep === 2) { this.refLen = n; this.refStep = 3; this.base = this.c; this.ask('Specificare nuova lunghezza'); return true; }
    this.apply(this.refStep === 3 ? n / (this.refLen || 1) : n);
    return true;
  }

  option(k: string) {
    if (k === 'R') { this.refStep = 1; this.ask('Specificare lunghezza di riferimento (o due punti)', [], '1'); }
  }

  private apply(f: number) {
    if (f <= 0) return;
    const m = scaleAbout(this.c!, f);
    const out = this.sel.map(e => transform(e, m));
    this.h.doc.edit('Scala', () => this.h.doc.replace(out));
    this.h.msg(`Fattore di scala ${fmtLen(f)}.`);
    this.h.setSelection([]);
    this.h.done();
  }

  ghosts(p: Vec): NewEnt[] {
    if (!this.c || this.refStep) return [];
    const f = dist(this.c, p);
    if (f <= 1e-9) return [];
    const m = scaleAbout(this.c, f);
    return this.sel.map(e => strip(transform(e, m)));
  }
}

// ---------------------------------------------------------------- OFFSET

export class OffsetTool extends Tool {
  readonly name = 'OFFSET';
  private d = 0;
  private through = false;
  private target: Ent | null = null;

  start() {
    this.d = this.h.doc.settings.offsetD;
    this.numberAsText = true;
    this.ask('Specificare distanza di offset o', [O('P', 'Punto (passante)')], fmtLen(this.d));
  }

  text(s: string): boolean {
    if (this.mode !== 'point' || this.target) return false;
    const n = parseNum(s);
    if (n === null || n <= 0) return false;
    this.d = n;
    this.h.doc.settings.offsetD = n;
    this.through = false;
    this.askEnt();
    return true;
  }

  option(k: string) { if (k === 'P') { this.through = true; this.askEnt(); } }

  private askEnt() {
    this.target = null;
    this.numberAsText = false;
    this.ask('Selezionare entità di cui fare l\'offset (Invio per finire)', [], undefined, 'entity');
  }

  enter() {
    if (this.mode === 'point' && !this.target && !this.through && this.numberAsText) { this.askEnt(); return; }
    this.h.setSelection([]);
    this.h.done();
  }

  entity(e: Ent) {
    if (!['line', 'poly', 'circle', 'arc', 'wall'].includes(e.t)) { this.h.msg('Offset possibile su linee, polilinee, cerchi, archi e muri.'); return; }
    this.target = e;
    this.h.setSelection([e.id]);
    this.ask(this.through ? 'Specificare punto di passaggio' : 'Specificare il lato');
  }

  point(p: Vec) {
    if (!this.target) return;
    let d = this.d;
    if (this.through) {
      d = distanceTo(this.target, p);
      if (d <= 1e-12) return;
    }
    const r = offsetEnt(this.target, d, p);
    if (!r) { this.h.msg('Offset non possibile: la distanza è troppo grande per questa forma.'); return; }
    this.h.doc.edit('Offset', () => this.h.doc.add(r));
    this.h.setSelection([]);
    this.askEnt();
  }

  preview(p: Vec): NewEnt[] {
    if (!this.target) return [];
    const d = this.through ? distanceTo(this.target, p) : this.d;
    const r = d > 1e-12 ? offsetEnt(this.target, d, p) : null;
    return r ? [r] : [];
  }
}

function distanceTo(e: Ent, p: Vec): number {
  if (e.t === 'circle' || e.t === 'arc') return Math.abs(dist(p, e.c) - e.r);
  if (e.t === 'line' || e.t === 'wall') {
    const d = sub(e.b, e.a);
    const L = Math.hypot(d.x, d.y);
    return L < 1e-12 ? 0 : Math.abs((d.x * (p.y - e.a.y) - d.y * (p.x - e.a.x)) / L);
  }
  if (e.t === 'poly' && e.bulges?.some(b => Math.abs(b) > 1e-9)) return Math.min(...editCurves(e).map(c => distToCurve(p, c)));
  if (e.t === 'poly') {
    let best = Infinity;
    const n = e.pts.length;
    for (let i = 0; i < (e.closed ? n : n - 1); i++) {
      const a = e.pts[i], b = e.pts[(i + 1) % n];
      const d = sub(b, a);
      const L = Math.hypot(d.x, d.y);
      if (L > 1e-12) best = Math.min(best, Math.abs((d.x * (p.y - a.y) - d.y * (p.x - a.x)) / L));
    }
    return best;
  }
  return 0;
}

// ---------------------------------------------------------------- TAGLIA / ESTENDI

abstract class EdgeTool extends Tool {
  protected edges: Curve[] | null = null;
  /** modifiche fatte da questo comando: Annulla non deve toccare quelle di prima */
  protected edits = 0;
  private edgeIds: Set<number> | null = null;
  protected abstract verb: string;

  start() {
    const pre = this.h.doc.ents.filter(e => this.h.selection.has(e.id));
    if (pre.length) { this.useEdges(pre); return; }
    this.ask(`Selezionare i bordi (Invio = tutte le entità)`, [], undefined, 'select');
  }

  selectDone() {
    const ents = this.h.doc.ents.filter(e => this.h.selection.has(e.id));
    this.useEdges(ents.length ? ents : null);
  }

  private useEdges(ents: Ent[] | null) {
    this.edgeIds = ents ? new Set(ents.map(e => e.id)) : null;
    this.h.setSelection([]);
    this.askPick();
  }

  protected askPick() {
    this.ask(`Selezionare l'entità da ${this.verb} (Invio per finire)`, [O('A', 'Annulla')], undefined, 'entity');
  }

  protected cutters(exclude: number): Curve[] {
    const doc = this.h.doc;
    const ents = doc.ents.filter(e => e.id !== exclude && doc.layer(e.layer).visible && (!this.edgeIds || this.edgeIds.has(e.id)));
    return boundaryCurves(ents, doc.ctx());
  }

  option(k: string) {
    if (k === 'A') {
      if (this.edits) { this.h.doc.undo(); this.edits--; } else this.h.msg('Niente da annullare in questo comando.');
      this.askPick();
    }
  }

  enter() { this.h.done(); }
}

export class TrimTool extends EdgeTool {
  readonly name = 'TAGLIA';
  protected verb = 'tagliare';
  entity(e: Ent, p: Vec) {
    if (!this.h.doc.isEditable(e)) return;
    const r = trimEnt(e, this.cutters(e.id), p);
    if (!r) { this.h.msg('Nessuna intersezione con i bordi: niente da tagliare.'); return; }
    this.h.doc.edit('Taglia', () => { this.h.doc.remove([e.id]); this.h.doc.addMany(r); });
    this.edits++;
    this.askPick();
  }
}

export class ExtendTool extends EdgeTool {
  readonly name = 'ESTENDI';
  protected verb = 'estendere';
  entity(e: Ent, p: Vec) {
    if (!this.h.doc.isEditable(e)) return;
    const r = extendEnt(e, this.cutters(e.id), p);
    if (!r) { this.h.msg('Nessun bordo da raggiungere in quella direzione.'); return; }
    this.h.doc.edit('Estendi', () => this.h.doc.replace([{ ...r, id: e.id } as Ent]));
    this.edits++;
    this.askPick();
  }
}

// ---------------------------------------------------------------- RACCORDA

export class FilletTool extends Tool {
  readonly name = 'RACCORDA';
  private first: { e: LineE | WallE; p: Vec } | null = null;

  start() { this.askFirst(); }

  private askFirst() {
    this.first = null;
    this.numberAsText = false;
    this.ask(`Selezionare la prima linea o muro (raggio ${fmtLen(this.h.doc.settings.filletR)}) o`, [O('R', 'Raggio')], undefined, 'entity');
  }

  option(k: string) {
    if (k === 'R') { this.numberAsText = true; this.ask('Specificare raggio di raccordo', [], fmtLen(this.h.doc.settings.filletR)); this.mode = 'point'; }
  }

  text(s: string): boolean {
    const n = parseNum(s);
    if (n === null || n < 0) return false;
    this.h.doc.settings.filletR = n;
    this.askFirst();
    return true;
  }

  entity(e: Ent, p: Vec) {
    if (e.t !== 'line' && e.t !== 'wall') { this.h.msg('Raccordo possibile fra linee o fra muri.'); return; }
    if (!this.first) {
      this.first = { e, p };
      this.h.setSelection([e.id]);
      this.ask('Selezionare la seconda linea o muro', [], undefined, 'entity');
      return;
    }
    if (e.id === this.first.e.id) return;
    if ((e.t === 'wall') !== (this.first.e.t === 'wall')) { this.h.msg('Serve lo stesso tipo: due linee o due muri.'); return; }
    const r = fillet(this.first.e, this.first.p, e, p, this.h.doc.settings.filletR);
    if (!r) { this.h.msg('Raccordo non possibile: entità parallele, o raggio troppo grande per la loro lunghezza.'); return; }
    this.h.doc.edit('Raccorda', () => {
      this.h.doc.replace([r.a as Ent, r.b as Ent]);
      if (r.arc) this.h.doc.add(r.arc);
    });
    this.h.setSelection([]);
    this.h.done();
  }

  enter() { if (this.numberAsText) this.askFirst(); else { this.h.setSelection([]); this.h.done(); } }
}

// ---------------------------------------------------------------- SMUSSO

export class ChamferTool extends Tool {
  readonly name = 'SMUSSO';
  private first: { e: LineE; p: Vec } | null = null;
  private asking: 'd1' | 'd2' | null = null;
  private def2 = 0;

  start() { this.askFirst(); }

  private askFirst() {
    this.first = null;
    this.asking = null;
    const s = this.h.doc.settings;
    this.ask(`Selezionare la prima linea (distanze ${fmtLen(s.chamferD1)} e ${fmtLen(s.chamferD2)}) o`, [O('D', 'Distanze')], undefined, 'entity');
  }

  private askD2(def: number) {
    this.asking = 'd2';
    this.def2 = def;
    this.ask('Specificare la seconda distanza di smusso', [], fmtLen(def), 'none');
  }

  option(k: string) {
    if (k === 'D') { this.asking = 'd1'; this.ask('Specificare la prima distanza di smusso', [], fmtLen(this.h.doc.settings.chamferD1), 'none'); }
  }

  text(s: string): boolean {
    const n = parseNum(s);
    if (n === null || n < 0 || !this.asking) return false;
    if (this.asking === 'd1') { this.h.doc.settings.chamferD1 = n; this.askD2(n); }
    else { this.h.doc.settings.chamferD2 = n; this.askFirst(); }
    return true;
  }

  entity(e: Ent, p: Vec) {
    if (e.t !== 'line') { this.h.msg('Smusso possibile fra due linee.'); return; }
    if (!this.h.doc.isEditable(e)) return;
    if (!this.first) {
      this.first = { e, p };
      this.h.setSelection([e.id]);
      this.ask('Selezionare la seconda linea', [], undefined, 'entity');
      return;
    }
    if (e.id === this.first.e.id) return;
    const s = this.h.doc.settings;
    const r = chamfer(this.first.e, this.first.p, e, p, s.chamferD1, s.chamferD2);
    if (r === 'parallel') { this.h.msg('Le due linee sono parallele.'); return; }
    if (r === 'short') { this.h.msg('Distanza di smusso troppo grande per queste linee.'); return; }
    this.h.doc.edit('Smusso', () => {
      this.h.doc.replace([r.a, r.b]);
      if (r.line) this.h.doc.add(r.line);
    });
    this.h.setSelection([]);
    this.h.done();
  }

  enter() {
    if (this.asking === 'd1') this.askD2(this.h.doc.settings.chamferD1);
    else if (this.asking === 'd2') { this.h.doc.settings.chamferD2 = this.def2; this.askFirst(); }
    else { this.h.setSelection([]); this.h.done(); }
  }
}

// ---------------------------------------------------------------- SERIE

const ARRAY_MAX = 5000;

export class ArrayTool extends SelTool {
  readonly name = 'SERIE';
  private step: 'type' | 'rows' | 'cols' | 'dy' | 'dx' | 'center' | 'count' | 'fill' | 'rot' = 'type';
  private rows = 1;
  private cols = 1;
  private dy = 0;
  private c: Vec | null = null;
  private n = 0;
  private fill = TAU;

  afterSelect() {
    this.step = 'type';
    this.ask('Tipo di serie', [O('R', 'Rettangolare'), O('P', 'Polare')], 'R', 'none');
  }

  private num(step: ArrayTool['step'], prompt: string, def?: string) {
    this.step = step;
    this.ask(prompt, [], def, 'none');
  }

  option(k: string) {
    if (this.step === 'type') {
      if (k === 'R') this.num('rows', 'Numero di righe (---)', '1');
      else { this.step = 'center'; this.ask('Specificare il centro della serie'); }
    } else if (this.step === 'rot') this.polar(k === 'S');
  }

  point(p: Vec) {
    if (this.step !== 'center') return;
    this.c = p;
    this.num('count', 'Numero di elementi (originale compreso)');
  }

  text(s: string): boolean {
    const n = parseNum(s);
    if (n === null) return false;
    const count = (): boolean => {
      if (Number.isInteger(n) && n >= 1) return true;
      this.h.msg('Serve un numero intero maggiore di zero.');
      return false;
    };
    switch (this.step) {
      case 'rows': if (count()) { this.rows = n; this.num('cols', 'Numero di colonne (|||)', '1'); } return true;
      case 'cols': if (count()) { this.cols = n; this.afterCounts(); } return true;
      case 'dy': this.dy = n; this.afterDy(); return true;
      case 'dx': this.rect(n); return true;
      case 'count':
        if (!count()) return true;
        if (n < 2) { this.h.msg('Servono almeno 2 elementi.'); return true; }
        this.n = n;
        this.num('fill', 'Angolo da riempire (+ antiorario, - orario)', '360');
        return true;
      case 'fill':
        if (Math.abs(n) < 1e-9 || Math.abs(n) > 360) { this.h.msg('Angolo fra -360 e 360, diverso da zero.'); return true; }
        this.fill = (n * Math.PI) / 180;
        this.askRot();
        return true;
      default: return false;
    }
  }

  enter() {
    switch (this.step) {
      case 'type': this.option('R'); break;
      case 'rows': this.rows = 1; this.num('cols', 'Numero di colonne (|||)', '1'); break;
      case 'cols': this.cols = 1; this.afterCounts(); break;
      case 'fill': this.fill = TAU; this.askRot(); break;
      case 'rot': this.polar(true); break;
      case 'dy': case 'dx': case 'count': this.h.msg('Serve un valore.'); break;
      default: this.finish();
    }
  }

  private askRot() {
    this.step = 'rot';
    this.ask('Ruotare gli elementi copiati?', [O('S', 'Sì'), O('N', 'No')], 'S', 'none');
  }

  private afterCounts() {
    if (this.rows === 1 && this.cols === 1) { this.h.msg('Una riga e una colonna: niente da copiare.'); this.finish(); return; }
    if (this.rows > 1) this.num('dy', 'Distanza fra le righe (negativa = verso il basso)');
    else this.afterDy();
  }

  private afterDy() {
    if (this.cols > 1) this.num('dx', 'Distanza fra le colonne (negativa = verso sinistra)');
    else this.rect(0);
  }

  private rect(dx: number) { this.make(arrayRect(this.rows, this.cols, this.dy, dx)); }

  private polar(rotateItems: boolean) {
    const ctx = this.h.doc.ctx();
    let b = emptyBox();
    for (const e of this.sel) { const eb = entBox(e, ctx); if (boxValid(eb)) b = boxUnion(b, eb); }
    const ref = boxValid(b) ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : this.c!;
    this.make(arrayPolar(this.c!, this.n, this.fill, rotateItems, ref));
  }

  private make(mats: Mat[]) {
    if (mats.length * this.sel.length > ARRAY_MAX) {
      this.h.msg(`Troppe copie (${mats.length * this.sel.length}): il massimo è ${ARRAY_MAX}.`);
      this.finish();
      return;
    }
    const copies = mats.map(m => this.sel.map(e => strip(transform(e, m))));
    this.h.doc.edit('Serie', () => { for (const c of copies) this.h.doc.addCopies(c); });
    this.h.msg(`${copies.length * this.sel.length} entità create.`);
    this.finish();
  }

  private finish() { this.h.setSelection([]); this.h.done(); }
}

// ---------------------------------------------------------------- ESPLODI

export class ExplodeTool extends SelTool {
  readonly name = 'ESPLODI';
  afterSelect() {
    const doc = this.h.doc;
    const ctx = doc.ctx();
    let n = 0;
    doc.edit('Esplodi', () => {
      const ungroup: Ent[] = [];
      for (const e of this.sel) {
        if (e.g !== undefined) { const { g: _g, ...rest } = e; ungroup.push(rest as Ent); n++; continue; }
        const parts = explode(e, ctx);
        if (!parts) continue;
        doc.remove([e.id]);
        doc.addMany(parts);
        n++;
      }
      doc.replace(ungroup);
    });
    this.h.msg(n ? `${n} entità esplose.` : 'Nessuna entità esplodibile.');
    this.h.setSelection([]);
    this.h.done();
  }
}

// ---------------------------------------------------------------- STIRA

export class StretchTool extends Tool {
  readonly name = 'STIRA';
  private box: Box | null = null;
  private from: Vec | null = null;
  forceCrossing = true;

  start() { this.ask('Selezionare con una finestra di intersezione (da destra a sinistra) le parti da stirare', [], undefined, 'select'); }

  setBox(b: Box) { this.box = b; }

  selectDone() {
    if (!this.box) { this.h.msg('Serve una finestra di intersezione.'); this.h.done(); return; }
    this.ask('Specificare punto base');
  }

  point(p: Vec) {
    if (!this.from) { this.from = p; this.base = p; this.ask('Specificare secondo punto'); return; }
    const d = sub(p, this.from);
    const out = this.stretched(d);
    if (out.length) this.h.doc.edit('Stira', () => this.h.doc.replace(out));
    this.h.setSelection([]);
    this.h.done();
  }

  private stretched(d: Vec): Ent[] {
    const b = this.box!;
    const inside = (q: Vec) => inBox(q, b);
    const out: Ent[] = [];
    for (const e of this.h.doc.ents) {
      if (!this.h.selection.has(e.id) || !this.h.doc.isEditable(e)) continue;
      const r = stretch(e, inside, d);
      if (r) out.push(r);
    }
    return out;
  }

  ghosts(p: Vec): NewEnt[] {
    if (!this.from || !this.box) return [];
    return this.stretched(sub(p, this.from)).map(strip);
  }
}

// ---------------------------------------------------------------- UNISCI

export class JoinTool extends SelTool {
  readonly name = 'UNISCI';
  afterSelect() {
    const r = joinEnts(this.sel);
    if (!r) { this.h.msg('Le entità non si toccano agli estremi.'); this.h.done(); return; }
    this.h.doc.edit('Unisci', () => { this.h.doc.remove(r.used); this.h.doc.add(r.poly); });
    this.h.msg(`${r.used.length} entità unite in una polilinea.`);
    this.h.setSelection([]);
    this.h.done();
  }
}

// ---------------------------------------------------------------- CORRISPONDENZA PROPRIETÀ

export class MatchPropTool extends Tool {
  readonly name = 'CORRISPONDENZA';
  private src: Ent | null = null;
  start() { this.ask('Selezionare l\'entità di origine', [], undefined, 'entity'); }
  entity(e: Ent) {
    if (!this.src) { this.src = e; this.ask('Selezionare le entità di destinazione (Invio per finire)', [], undefined, 'entity'); return; }
    const s = this.src;
    const upd = { ...e, layer: s.layer } as Ent;
    if (s.color) upd.color = s.color; else delete upd.color;
    if (upd.t === 'wall' && s.t === 'wall') upd.th = s.th;
    if (upd.t === 'text' && s.t === 'text') upd.h = s.h;
    // fra quote passa lo stile: l'altezza del testo (se l'origine usa quella del disegno, anche la destinazione)
    if (upd.t === 'dim' && s.t === 'dim') { if (s.h !== undefined) upd.h = s.h; else delete upd.h; }
    if (upd.t === 'dim' && s.t === 'text') upd.h = s.h;
    if (upd.t === 'text' && s.t === 'dim') upd.h = s.h ?? this.h.doc.settings.dimH;
    this.h.doc.edit('Corrispondenza proprietà', () => this.h.doc.replace([upd]));
  }
  enter() { this.h.done(); }
}

export { add, boxOf };
