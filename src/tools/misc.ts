// Consultazione, vista, appunti, grip.
import type { Ent, NewEnt } from '../model/entities';
import { TYPE_NAMES, grips, moveGrip, transform, polyPoints, roomArea, dimValue } from '../model/entities';
import { UNIT_MM } from '../model/document';
import { Vec, dist, angleOf, polygonArea, translate, same, TAU, sweep } from '../model/geom';
import { Tool, SelTool, O, fmtLen, fmtPt } from './base';
import type { Host } from './base';

const deg = (r: number) => fmtLen(((r * 180) / Math.PI + 360) % 360);

export class DistTool extends Tool {
  readonly name = 'DISTANZA';
  private a: Vec | null = null;
  start() { this.ask('Specificare primo punto'); }
  point(p: Vec) {
    if (!this.a) { this.a = p; this.base = p; this.ask('Specificare secondo punto'); return; }
    this.h.msg(`Distanza = ${fmtLen(dist(this.a, p))};  Angolo = ${deg(angleOf(this.a, p))}°;  ΔX = ${fmtLen(p.x - this.a.x)};  ΔY = ${fmtLen(p.y - this.a.y)}`);
    this.h.done();
  }
}

export class IdTool extends Tool {
  readonly name = 'ID';
  start() { this.ask('Specificare punto'); }
  point(p: Vec) { this.h.msg(`X = ${fmtLen(p.x)}   Y = ${fmtLen(p.y)}`); this.h.done(); }
}

export class AreaTool extends Tool {
  readonly name = 'AREA';
  private pts: Vec[] = [];
  start() { this.ask('Specificare primo vertice o', [O('O', 'Oggetto')]); }
  option(k: string) { if (k === 'O') this.ask('Selezionare polilinea chiusa, cerchio o locale', [], undefined, 'entity'); }

  private report(area: number, per: number) {
    const u = this.h.doc.settings.units;
    const toM2 = (UNIT_MM[u] / 1000) ** 2;
    this.h.msg(`Area = ${fmtLen(area)} ${u}² (${fmtLen(Math.round(area * toM2 * 100) / 100)} m²);  Perimetro = ${fmtLen(per)}`);
    this.h.done();
  }

  point(p: Vec) {
    this.pts.push(p);
    this.base = p;
    this.ask(this.pts.length < 3 ? 'Specificare vertice successivo' : 'Specificare vertice successivo o Invio per calcolare');
  }

  enter() {
    if (this.pts.length < 3) { this.h.done(); return; }
    let per = 0;
    for (let i = 0; i < this.pts.length; i++) per += dist(this.pts[i], this.pts[(i + 1) % this.pts.length]);
    this.report(Math.abs(polygonArea(this.pts)), per);
  }

  entity(e: Ent) {
    if (e.t === 'circle') { this.report(Math.PI * e.r * e.r, TAU * e.r); return; }
    let pts: Vec[] | null = null;
    if (e.t === 'poly' && e.closed) pts = polyPoints(e);
    else if (e.t === 'room') pts = e.pts;
    if (!pts) { this.h.msg('Serve un contorno chiuso.'); return; }
    let per = 0;
    for (let i = 0; i < pts.length; i++) per += dist(pts[i], pts[(i + 1) % pts.length]);
    this.report(Math.abs(polygonArea(pts)), per);
  }

  preview(p: Vec): NewEnt[] {
    return this.pts.length ? [{ t: 'poly', pts: [...this.pts, p], closed: true, layer: this.h.doc.current }] : [];
  }
}

export class ListTool extends SelTool {
  readonly name = 'LISTA';
  afterSelect() {
    for (const e of this.sel.slice(0, 50)) this.h.msg(describe(e));
    if (this.sel.length > 50) this.h.msg(`… e altre ${this.sel.length - 50}.`);
    this.h.done();
  }
}

export function describe(e: Ent): string {
  const head = `${TYPE_NAMES[e.t]} [layer ${e.layer}]`;
  switch (e.t) {
    case 'line': return `${head} da ${fmtPt(e.a)} a ${fmtPt(e.b)}, lunghezza ${fmtLen(dist(e.a, e.b))}`;
    case 'wall': return `${head} da ${fmtPt(e.a)} a ${fmtPt(e.b)}, lunghezza ${fmtLen(dist(e.a, e.b))}, spessore ${fmtLen(e.th)}`;
    case 'circle': return `${head} centro ${fmtPt(e.c)}, raggio ${fmtLen(e.r)}`;
    case 'arc': return `${head} centro ${fmtPt(e.c)}, raggio ${fmtLen(e.r)}, ampiezza ${deg(sweep(e.a0, e.a1))}°`;
    case 'poly': return `${head} ${e.pts.length} vertici${e.closed ? ', chiusa' : ''}`;
    case 'text': return `${head} "${e.s}", altezza ${fmtLen(e.h)}`;
    case 'dim': { const x = dimValue(e); return `${head} misura ${x === null ? '?' : fmtLen(x) + (e.k === 'ang' ? '°' : '')}`; }
    case 'door': case 'window': return `${head} larghezza ${fmtLen(e.w)}`;
    case 'room': return `${head} "${e.name}", superficie ${fmtLen(roomArea(e))}`;
    case 'hatch': return `${head} ${e.pat}`;
    case 'ellipse': { const r = Math.hypot(e.a.x, e.a.y); return `${head} centro ${fmtPt(e.c)}, semiassi ${fmtLen(r)} e ${fmtLen(r * e.k)}`; }
    case 'spline': return `${head} ${e.pts.length} punti${e.closed ? ', chiusa' : ''}`;
    case 'insert': return `${head} "${e.name}" in ${fmtPt(e.p)}, scala ${fmtLen(e.s)}, rotazione ${deg(e.rot)}°${e.flip ? ', specchiato' : ''}`;
  }
}

export class ZoomTool extends Tool {
  readonly name = 'ZOOM';
  private a: Vec | null = null;
  start() { this.ask('Specificare primo angolo della finestra o', [O('E', 'Estensioni'), O('P', 'Precedente'), O('F', 'Finestra')]); }
  option(k: string) {
    if (k === 'E') { this.h.zoomExtents(); this.h.done(); }
    else if (k === 'P') { this.h.zoomPrevious(); this.h.done(); }
    else this.ask('Specificare primo angolo');
  }
  point(p: Vec) {
    if (!this.a) { this.a = p; this.ask('Specificare angolo opposto'); return; }
    this.h.zoomWindow(this.a, p);
    this.h.done();
  }
  preview(p: Vec): NewEnt[] {
    if (!this.a) return [];
    const a = this.a;
    return [{ t: 'poly', pts: [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }], closed: true, layer: '0', color: '#4da3ff' }];
  }
}

export class PanTool extends Tool {
  readonly name = 'PAN';
  readonly panMode = true;
  start() { this.ask('Trascinare con il mouse. Esc o Invio per finire', [], undefined, 'none'); }
}

export class PasteTool extends Tool {
  readonly name = 'INCOLLA';
  start() {
    if (!this.h.clipboard) { this.h.msg('Gli appunti sono vuoti.'); this.h.done(); return; }
    this.ask('Specificare punto di inserimento');
  }
  private moved(p: Vec): NewEnt[] {
    const c = this.h.clipboard!;
    const m = translate(p.x - c.base.x, p.y - c.base.y);
    return c.ents.map(e => transform({ ...e, id: 0 } as Ent, m)).map(({ id: _id, ...r }) => r as NewEnt);
  }
  point(p: Vec) {
    const doc = this.h.doc;
    const list = this.moved(p);
    const groups = new Map<number, number>();
    doc.edit('Incolla', () => {
      const added = doc.addMany(list.map(e => {
        if (e.g === undefined) return e;
        if (!groups.has(e.g)) groups.set(e.g, doc.newGroupId());
        return { ...e, g: groups.get(e.g) };
      }));
      this.h.setSelection(added.map(e => e.id));
    });
    this.h.done();
  }
  ghosts(p: Vec): NewEnt[] { return this.moved(p); }
}

/** Spostamento di un grip: muove insieme i grip coincidenti di tutte le entità selezionate. */
export class GripTool extends Tool {
  readonly name = 'GRIP';
  private targets: { e: Ent; i: number }[] = [];

  constructor(h: Host, private hot: Vec) {
    super(h);
  }

  start() {
    for (const e of this.h.doc.ents) {
      if (!this.h.selection.has(e.id) || !this.h.doc.isEditable(e)) continue;
      grips(e).forEach((g, i) => { if (same(g, this.hot, 1e-9)) this.targets.push({ e, i }); });
    }
    if (!this.targets.length) { this.h.done(); return; }
    this.base = this.hot;
    this.snapExclude = new Set(this.targets.map(t => t.e.id));
    this.ask('** STIRA ** Specificare punto di stiramento');
  }

  private moved(p: Vec): Ent[] {
    return this.targets.map(t => moveGrip(t.e, t.i, p));
  }

  point(p: Vec) {
    const out = this.moved(p);
    this.h.doc.edit('Stira grip', () => this.h.doc.replace(out));
    this.h.done();
  }

  ghosts(p: Vec): NewEnt[] {
    return this.moved(p).map(({ id: _id, ...r }) => r as NewEnt);
  }
}
