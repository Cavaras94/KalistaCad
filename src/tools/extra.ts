// Altri comandi di disegno e modifica: poligono, punto, spezza, allunga, dividi, modifica polilinea, layer.
import type { Ent, NewEnt, PolyE } from '../model/entities';
import { breakEnt, lengthenEnt, pointsAlong, entLength, polyAddVertex, polyRemoveVertex } from '../model/ops';
import { Vec, dist, angleOf, polar } from '../model/geom';
import { Tool, SelTool, O, parseNum, fmtLen } from './base';
import type { Host } from './base';

// ---------------------------------------------------------------- POLIGONO

export class PolygonTool extends Tool {
  readonly name = 'POLIGONO';
  static sides = 6;
  private n = 0;
  private c: Vec | null = null;
  private inscribed = true;
  private step: 'n' | 'c' | 'how' | 'r' = 'n';

  start() { this.step = 'n'; this.ask('Numero di lati', [], String(PolygonTool.sides), 'none'); }

  private setSides(n: number) {
    this.n = n;
    PolygonTool.sides = n;
    this.step = 'c';
    this.ask('Specificare centro del poligono');
  }

  text(s: string): boolean {
    if (this.step !== 'n') return false;
    const n = parseNum(s);
    if (n === null) return false;
    if (!Number.isInteger(n) || n < 3 || n > 1024) { this.h.msg('Servono da 3 a 1024 lati.'); return true; }
    this.setSides(n);
    return true;
  }

  private askRadius() {
    this.step = 'r';
    this.ask(this.inscribed ? 'Specificare un vertice (o il raggio)' : 'Specificare il punto medio di un lato (o il raggio)');
  }

  option(k: string) {
    if (this.step !== 'how') return;
    this.inscribed = k === 'I';
    this.askRadius();
  }

  enter() {
    if (this.step === 'n') this.setSides(PolygonTool.sides);
    else if (this.step === 'how') { this.inscribed = true; this.askRadius(); }
    else super.enter();
  }

  point(p: Vec) {
    if (this.step === 'c') {
      this.c = p;
      this.base = p;
      this.step = 'how';
      this.ask('Tipo', [O('I', 'Inscritto nel cerchio'), O('C', 'Circoscritto al cerchio')], 'I', 'none');
      return;
    }
    if (this.step !== 'r') return;
    const e = this.make(p);
    if (!e) return;
    this.h.doc.edit('Poligono', () => { this.h.doc.add(e); });
    this.h.done();
  }

  private make(p: Vec): NewEnt | null {
    if (!this.c || dist(this.c, p) < 1e-9) return null;
    const step = (2 * Math.PI) / this.n;
    const r = dist(this.c, p), ang = angleOf(this.c, p);
    // circoscritto: il punto dato sta a metà di un lato, i vertici sono più lontani e sfasati di mezzo passo
    const R = this.inscribed ? r : r / Math.cos(step / 2);
    const a0 = this.inscribed ? ang : ang + step / 2;
    const pts = Array.from({ length: this.n }, (_, i) => polar(this.c!, R, a0 + i * step));
    return { t: 'poly', pts, closed: true, layer: this.h.doc.current };
  }

  preview(p: Vec): NewEnt[] {
    if (this.step !== 'r') return [];
    const e = this.make(p);
    return e ? [e] : [];
  }
}

// ---------------------------------------------------------------- PUNTO

export class PointTool extends Tool {
  readonly name = 'PUNTO';
  start() { this.ask('Specificare un punto (Invio per finire)'); }
  point(p: Vec) {
    this.h.doc.edit('Punto', () => { this.h.doc.add({ t: 'point', p, layer: this.h.doc.current }); });
    this.h.refresh();
  }
}

// ---------------------------------------------------------------- IMMAGINE

/** Inserisce un'immagine (JPG, PNG): per un logo, una foto, una pianta scansita da ricalcare. */
export class ImageTool extends Tool {
  readonly name = 'IMMAGINE';
  private img: { src: string; w: number; h: number } | null = null;
  private p: Vec | null = null;
  private dead = false;

  start() {
    this.ask('Scegliere il file dell\'immagine nella finestra che si è aperta', [], undefined, 'none');
    void this.h.pickImage().then(img => {
      if (this.dead) return;
      if (!img) { this.h.msg('Nessuna immagine scelta.'); this.h.done(); return; }
      this.img = img;
      this.ask('Specificare il punto di inserimento (angolo in basso a sinistra)');
    });
  }

  private make(q: Vec): NewEnt | null {
    if (!this.img || !this.p) return null;
    const w = dist(this.p, q);
    if (w < 1e-9) return null;
    return { t: 'image', p: this.p, w, h: (w * this.img.h) / this.img.w, rot: 0, src: this.img.src, layer: this.h.doc.current };
  }

  point(q: Vec) {
    if (!this.img) return;
    if (!this.p) { this.p = q; this.base = q; this.ask('Specificare la larghezza dell\'immagine (un numero, o un punto)'); return; }
    const e = this.make(q);
    if (!e) return;
    this.h.doc.edit('Immagine', () => { this.h.doc.add(e); });
    this.h.done();
  }

  preview(q: Vec): NewEnt[] {
    const e = this.make(q);
    return e ? [e] : [];
  }

  /** Chiuso il comando, una scelta di file che arriva dopo non deve più fare niente. */
  enter() { this.dead = true; super.enter(); }
  cancel() { this.dead = true; }
}

// ---------------------------------------------------------------- SPEZZA

export class BreakTool extends Tool {
  readonly name = 'SPEZZA';
  private e: Ent | null = null;
  private p1: Vec | null = null;
  private askingFirst = false;

  start() { this.ask('Selezionare l\'entità da spezzare, nel primo punto di interruzione', [], undefined, 'entity'); }

  entity(e: Ent, p: Vec) {
    if (!this.h.doc.isEditable(e)) return;
    if (entLength(e) === null) { this.h.msg('Si possono spezzare linee, archi, cerchi, polilinee, muri, ellissi e spline.'); return; }
    this.e = e;
    this.p1 = p;
    // come in AutoCAD, @ al secondo punto vuol dire "lo stesso punto": l'entità viene divisa in due lì
    this.h.lastPoint = p;
    this.h.setSelection([e.id]);
    this.ask('Specificare secondo punto di interruzione o', [O('P', 'Primo punto'), O('U', 'Un punto solo')]);
  }

  option(k: string) {
    if (!this.e) return;
    if (k === 'P') { this.askingFirst = true; this.ask('Specificare primo punto di interruzione'); }
    else if (k === 'U' && this.p1) this.apply(this.p1, this.p1);
  }

  point(p: Vec) {
    if (!this.e) return;
    if (this.askingFirst) {
      this.askingFirst = false;
      this.p1 = p;
      this.ask('Specificare secondo punto di interruzione o', [O('U', 'Un punto solo')]);
      return;
    }
    if (this.p1) this.apply(this.p1, p);
  }

  private apply(p1: Vec, p2: Vec) {
    const e = this.e!;
    const parts = breakEnt(e, p1, p2);
    if (!parts) { this.h.msg('Niente da spezzare in quei punti.'); return; }
    this.h.doc.edit('Spezza', () => {
      this.h.doc.remove([e.id]);
      // i pezzi restano nel gruppo dell'entità di partenza
      this.h.doc.addMany(e.g === undefined ? parts : parts.map(x => ({ ...x, g: e.g })));
    });
    this.h.setSelection([]);
    this.h.done();
  }

  cancel() { this.h.setSelection([]); }
}

// ---------------------------------------------------------------- ALLUNGA

export class LengthenTool extends Tool {
  readonly name = 'ALLUNGA';
  static delta = 0;
  private by: { delta?: number; total?: number } | null = null;
  private asking: 'delta' | 'total' | null = null;
  private edits = 0;

  start() {
    this.asking = null;
    this.ask('Selezionare un\'entità per leggerne la lunghezza, oppure', [O('D', 'Delta'), O('T', 'Totale')], undefined, 'entity');
  }

  option(k: string) {
    if (k === 'D') { this.asking = 'delta'; this.ask('Variazione di lunghezza (negativa per accorciare)', [], LengthenTool.delta ? fmtLen(LengthenTool.delta) : undefined, 'none'); }
    else if (k === 'T') { this.asking = 'total'; this.ask('Lunghezza totale', [], undefined, 'none'); }
    else if (k === 'A') {
      if (this.edits) { this.h.doc.undo(); this.edits--; } else this.h.msg('Niente da annullare in questo comando.');
    }
  }

  private askTarget() {
    this.asking = null;
    this.ask('Selezionare l\'entità da modificare, vicino all\'estremo da spostare (Invio per finire)', [O('A', 'Annulla')], undefined, 'entity');
  }

  text(s: string): boolean {
    const n = parseNum(s);
    if (n === null || !this.asking) return false;
    if (this.asking === 'delta') {
      if (n === 0) { this.h.msg('La variazione non può essere zero.'); return true; }
      LengthenTool.delta = n;
      this.by = { delta: n };
    } else {
      if (n <= 0) { this.h.msg('La lunghezza deve essere maggiore di zero.'); return true; }
      this.by = { total: n };
    }
    this.askTarget();
    return true;
  }

  enter() {
    if (this.asking === 'delta' && LengthenTool.delta) { this.by = { delta: LengthenTool.delta }; this.askTarget(); }
    else if (this.asking) this.start();
    else super.enter();
  }

  entity(e: Ent, p: Vec) {
    if (!this.by) {
      const L = entLength(e);
      this.h.msg(L === null ? 'Questa entità non ha una lunghezza.' : `Lunghezza: ${fmtLen(L)}`);
      return;
    }
    if (!this.h.doc.isEditable(e)) return;
    const r = lengthenEnt(e, p, this.by);
    if (!r) { this.h.msg('Non si può allungare o accorciare così questa entità (solo linee, muri, archi e tratti finali dritti di polilinee aperte).'); return; }
    this.h.doc.edit('Allunga', () => this.h.doc.replace([r]));
    this.edits++;
    this.h.refresh();
  }
}

// ---------------------------------------------------------------- DIVIDI / MISURA

export class DivideTool extends Tool {
  readonly name: string;
  private e: Ent | null = null;

  constructor(h: Host, private measure: boolean) {
    super(h);
    this.name = measure ? 'MISURA' : 'DIVIDI';
  }

  start() { this.ask(this.measure ? 'Selezionare l\'entità da misurare' : 'Selezionare l\'entità da dividere', [], undefined, 'entity'); }

  entity(e: Ent) {
    if (entLength(e) === null) { this.h.msg('Vale per linee, archi, cerchi, polilinee, muri, ellissi e spline.'); return; }
    this.e = e;
    this.h.setSelection([e.id]);
    this.ask(this.measure ? 'Lunghezza di ogni tratto' : 'Numero di parti', [], undefined, 'none');
  }

  text(s: string): boolean {
    const n = parseNum(s);
    if (n === null || !this.e) return false;
    const pts = pointsAlong(this.e, this.measure ? { d: n } : { n });
    if (!pts) { this.h.msg(this.measure ? 'Serve una lunghezza maggiore di zero (e non troppo piccola rispetto all\'entità).' : 'Serve un numero intero di parti, da 2 a 5000.'); return true; }
    if (!pts.length) { this.h.msg('Il tratto è più lungo dell\'entità: nessun punto da mettere.'); return true; }
    const doc = this.h.doc;
    doc.edit(this.measure ? 'Misura' : 'Dividi', () => doc.addMany(pts.map(p => ({ t: 'point' as const, p, layer: doc.current }))));
    this.h.msg(`${pts.length} punti messi sull'entità: si agganciano con lo snap Fine (digitando FIN o NOD).`);
    this.h.setSelection([]);
    this.h.done();
    return true;
  }

  cancel() { this.h.setSelection([]); }
}

// ---------------------------------------------------------------- EDITPL

export class PeditTool extends Tool {
  readonly name = 'EDITPL';
  private id: number | null = null;
  private sub: '' | 'add' | 'del' = '';

  start() {
    const sel = this.h.doc.ents.filter(e => this.h.selection.has(e.id));
    if (sel.length === 1 && this.take(sel[0])) return;
    this.ask('Selezionare una polilinea (una linea viene trasformata in polilinea)', [], undefined, 'entity');
  }

  private poly(): PolyE | null {
    const e = this.id === null ? undefined : this.h.doc.byId(this.id);
    return e && e.t === 'poly' ? e : null;
  }

  private take(e: Ent): boolean {
    const doc = this.h.doc;
    if (!doc.isEditable(e)) return false;
    if (e.t === 'line') {
      const { a, b, t: _t, ...rest } = e;
      doc.edit('Linea in polilinea', () => doc.replace([{ ...rest, t: 'poly', pts: [a, b], closed: false }]));
    } else if (e.t !== 'poly') { this.h.msg('Serve una polilinea o una linea.'); return false; }
    this.id = e.id;
    this.h.setSelection([e.id]);
    this.menu();
    return true;
  }

  entity(e: Ent) { if (this.id === null) this.take(e); }

  private menu() {
    const p = this.poly();
    if (!p) { this.finish(); return; }
    this.sub = '';
    this.ask('Opzione (Invio per finire)', [p.closed ? O('AP', 'APri') : O('C', 'Chiudi'), O('A', 'Aggiungi vertice'), O('R', 'Rimuovi vertice')], undefined, 'none');
  }

  option(k: string) {
    const p = this.poly();
    if (!p) return;
    if (k === 'C' || k === 'AP') {
      if (!p.closed && p.pts.length < 3) { this.h.msg('Per chiuderla servono almeno 3 vertici.'); return; }
      this.h.doc.edit(p.closed ? 'Apri polilinea' : 'Chiudi polilinea', () => this.h.doc.replace([{ ...p, closed: !p.closed }]));
      this.menu();
    } else if (k === 'A') { this.sub = 'add'; this.ask('Indicare sul tratto il punto del nuovo vertice (Invio per tornare alle opzioni)'); }
    else if (k === 'R') { this.sub = 'del'; this.ask('Indicare il vertice da togliere (Invio per tornare alle opzioni)'); }
  }

  point(pt: Vec) {
    const p = this.poly();
    if (!p || !this.sub) return;
    const r = this.sub === 'add' ? polyAddVertex(p, pt) : polyRemoveVertex(p, pt);
    if (!r) {
      this.h.msg(this.sub === 'add' ? 'Lì non si può: il punto cade su un vertice o su un tratto ad arco.' : 'Non si può togliere: resterebbero troppo pochi vertici.');
      return;
    }
    this.h.doc.edit(this.sub === 'add' ? 'Aggiungi vertice' : 'Rimuovi vertice', () => this.h.doc.replace([r]));
    this.h.refresh();
  }

  enter() { if (this.sub) this.menu(); else this.finish(); }

  private finish() { this.h.setSelection([]); this.h.done(); }
  cancel() { this.h.setSelection([]); }
}

// ---------------------------------------------------------------- layer

/** Visibilità dei layer e layer corrente prima dell'ultimo ISOLA, per poterli ripristinare. */

/** Rende corrente il layer dell'entità indicata. */
export class LayerCurrentTool extends Tool {
  readonly name = 'LAYER CORRENTE';
  start() { this.ask('Selezionare un\'entità: il suo layer diventa quello corrente', [], undefined, 'entity'); }
  entity(e: Ent) {
    const doc = this.h.doc;
    doc.current = e.layer;
    doc.changed();
    this.h.msg(`Layer corrente: ${e.layer}`);
    this.h.done();
  }
}

/** Lascia visibili solo i layer delle entità selezionate. */
export class LayerIsolateTool extends SelTool {
  readonly name = 'ISOLA LAYER';
  afterSelect() {
    const doc = this.h.doc;
    const keep = new Set(this.sel.map(e => e.layer));
    doc.edit('Isola layer', () => {
      // lo stato di prima resta nel documento (e nella pila di annullamento), non in giro per il programma
      doc.isolated ??= { visible: new Map(doc.layers.map(l => [l.name, l.visible])), current: doc.current };
      for (const l of doc.layers) l.visible = keep.has(l.name);
      if (!keep.has(doc.current)) doc.current = [...keep][0];
    });
    this.h.msg(`Visibili solo: ${[...keep].join(', ')}. Per tornare come prima: ANNULLAISOLA.`);
    this.h.setSelection([]);
    this.h.done();
  }
}

/** Spegne il layer dell'entità indicata. */
export class LayerOffTool extends Tool {
  readonly name = 'SPEGNI LAYER';
  start() { this.ask('Selezionare un\'entità sul layer da spegnere (Invio per finire)', [], undefined, 'entity'); }
  entity(e: Ent) {
    const doc = this.h.doc;
    doc.edit('Spegni layer', () => { doc.layer(e.layer).visible = false; });
    this.h.msg(`Layer ${e.layer} spento${e.layer === doc.current ? ' (è quello corrente: ciò che si disegna non si vedrà)' : ''}. Per riaccenderli tutti: ACCENDILAYER.`);
    this.h.setSelection([]);
    this.h.refresh();
  }
}

/** Azioni sui layer senza richieste: ripristino dopo ISOLA e accensione di tutti. */
export function layerAction(h: Host, what: 'unisolate' | 'allon') {
  const doc = h.doc;
  if (what === 'unisolate') {
    const saved = doc.isolated;
    if (!saved) { h.msg('Nessun layer isolato da ripristinare.'); return; }
    doc.edit('Annulla isola layer', () => {
      doc.isolated = null;
      for (const l of doc.layers) l.visible = saved.visible.get(l.name) ?? true;
      if (doc.layers.some(l => l.name === saved.current)) doc.current = saved.current;
    });
    h.msg('Visibilità dei layer ripristinata.');
  } else {
    doc.edit('Accendi layer', () => { doc.isolated = null; for (const l of doc.layers) l.visible = true; });
    h.msg('Tutti i layer sono visibili.');
  }
}

/** Elimina un layer: quello che contiene passa sul layer 0. */
export class LayerDeleteTool extends Tool {
  readonly name = 'ELIMINA LAYER';
  private target = '';

  private names(): string[] { return this.h.doc.layers.map(l => l.name).filter(n => n !== '0'); }

  start() {
    if (this.h.doc.editing) { this.h.msg('Durante la modifica di un blocco i layer non si eliminano: prima CHIUDIBLOCCO.'); this.h.done(); return; }
    const names = this.names();
    if (!names.length) { this.h.msg('C\'è solo il layer 0, che non si può eliminare.'); this.h.done(); return; }
    this.ask('Nome del layer da eliminare', names.map(n => O(n, n)), undefined, 'text');
  }

  text(raw: string): boolean {
    if (this.mode !== 'text') return false;
    const s = raw.trim().toLowerCase();
    if (!s) { this.h.done(); return true; }
    const name = this.names().find(n => n.toLowerCase() === s);
    if (!name) { this.h.msg(`Layer "${raw.trim()}" non trovato (il layer 0 non si può eliminare).`); return true; }
    this.target = name;
    const n = this.h.doc.layerUse(name);
    if (!n) { this.apply(); return true; }
    this.askYesNo(`Il layer ${name} contiene ${n} entità: passeranno sul layer 0. Eliminarlo?`, 'N');
    return true;
  }

  option(k: string) {
    if (this.mode === 'text') { this.text(k); return; }
    if (k === 'S') this.apply(); else this.h.done();
  }

  private apply() {
    const doc = this.h.doc;
    doc.edit('Elimina layer', () => doc.deleteLayer(this.target));
    this.h.msg(`Layer ${this.target} eliminato.`);
    this.h.setSelection([]);
    this.h.done();
  }
}
