// Base dei comandi: richieste, opzioni, interpretazione delle coordinate digitate.
import type { Ent, NewEnt } from '../model/entities';
import type { Doc } from '../model/document';
import type { View } from '../view/view';
import { Vec, v, add, mul, sub, len, norm, dist } from '../model/geom';

export interface Opt { key: string; label: string }

export type InputMode = 'point' | 'select' | 'entity' | 'text' | 'none';

/** Ciò che l'applicazione mette a disposizione dei comandi. */
export interface Host {
  doc: Doc;
  view: View;
  selection: Set<number>;
  setSelection(ids: Iterable<number>): void;
  lastPoint: Vec | null;
  cursor: Vec;
  msg(s: string): void;
  done(): void;
  refresh(): void;
  tol(): number;
  pick(p: Vec, filter?: (e: Ent) => boolean): Ent | null;
  zoomExtents(): void;
  zoomWindow(a: Vec, b: Vec): void;
  zoomPrevious(): void;
  run(cmd: string): void;
  clipboard: { ents: NewEnt[]; base: Vec } | null;
}

export abstract class Tool {
  abstract readonly name: string;
  mode: InputMode = 'point';
  promptText = '';
  options: Opt[] = [];
  def: string | undefined;
  /** origine dell'elastico, dell'orto e della distanza diretta */
  base: Vec | null = null;
  /** se vero, un numero digitato va a text() invece di diventare un punto a distanza diretta */
  numberAsText = false;
  /** entità da escludere dagli snap (per esempio quelle che si stanno spostando) */
  snapExclude: Set<number> | undefined;
  /** selezione per riquadro solo a intersezione (STIRA) */
  forceCrossing = false;

  constructor(protected h: Host) {}

  abstract start(): void;
  point(_p: Vec): void {}
  entity(_e: Ent, _p: Vec): void {}
  selectDone(): void {}
  /** testo o numero digitato; false = non riconosciuto */
  text(_s: string): boolean { return false; }
  option(_k: string): void {}
  enter(): void { this.h.done(); }
  preview(_p: Vec): NewEnt[] { return []; }
  /** entità da disegnare come "fantasma" (tratteggiate) durante il comando */
  ghosts(_p: Vec): NewEnt[] { return []; }
  cancel(): void {}
  /** testo che l'utente sta digitando (per l'anteprima del testo) */
  typing(_s: string): void {}

  ask(prompt: string, opts: Opt[] = [], def?: string, mode: InputMode = 'point') {
    this.promptText = prompt;
    this.options = opts;
    this.def = def;
    this.mode = mode;
    this.h.refresh();
  }

  matchOption(s: string): string | null {
    const u = s.trim().toUpperCase();
    if (!u) return null;
    for (const o of this.options) if (o.key.toUpperCase() === u) return o.key;
    for (const o of this.options) if (o.label.toUpperCase().startsWith(u)) return o.key;
    return null;
  }
}

export const O = (key: string, label: string): Opt => ({ key, label });

export function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** Angolo digitato in gradi → radianti. */
export function parseAngle(s: string): number | null {
  const n = parseNum(s.replace(/[°d]$/i, ''));
  return n === null ? null : (n * Math.PI) / 180;
}

/**
 * Coordinate come in DraftSight/AutoCAD:
 *  x,y  assolute      @dx,dy  relative all'ultimo punto
 *  d<a  polari        @d<a    polari relative
 *  d    distanza diretta lungo la direzione del cursore (serve una base)
 */
export function parsePoint(s: string, last: Vec | null, base: Vec | null, cursor: Vec): Vec | null {
  let t = s.trim().replace(/\s+/g, '');
  if (!t) return null;
  let rel = false;
  if (t.startsWith('@')) { rel = true; t = t.slice(1); if (!t) return last; }
  const origin = rel ? last ?? v(0, 0) : v(0, 0);
  const pol = t.match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)<([-+]?[\d.]+)$/i);
  if (pol) {
    const d = parseFloat(pol[1]), a = (parseFloat(pol[2]) * Math.PI) / 180;
    if (!Number.isFinite(d) || !Number.isFinite(a)) return null;
    return add(origin, v(d * Math.cos(a), d * Math.sin(a)));
  }
  const xy = t.match(/^([-+]?[\d.]+(?:e[-+]?\d+)?),([-+]?[\d.]+(?:e[-+]?\d+)?)$/i);
  if (xy) {
    const x = parseFloat(xy[1]), y = parseFloat(xy[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return add(origin, v(x, y));
  }
  if (!rel && base) {
    const d = parseNum(t);
    if (d === null) return null;
    const dir = sub(cursor, base);
    const u = len(dir) < 1e-12 ? v(1, 0) : norm(dir);
    return add(base, mul(u, d));
  }
  return null;
}

/** Comando che lavora su un gruppo di entità: usa la selezione già fatta o la chiede. */
export abstract class SelTool extends Tool {
  sel: Ent[] = [];
  protected selPrompt = 'Selezionare entità';

  start() {
    const pre = this.h.doc.ents.filter(e => this.h.selection.has(e.id) && this.h.doc.isEditable(e));
    if (pre.length) {
      this.sel = pre;
      this.afterSelect();
    } else this.ask(`${this.selPrompt}:`, [], undefined, 'select');
  }

  selectDone() {
    this.sel = this.h.doc.ents.filter(e => this.h.selection.has(e.id) && this.h.doc.isEditable(e));
    if (!this.sel.length) { this.h.msg('Nessuna entità selezionata.'); this.h.done(); return; }
    this.h.msg(`${this.sel.length} entità selezionate.`);
    this.afterSelect();
  }

  abstract afterSelect(): void;

  get selIds(): Set<number> { return new Set(this.sel.map(e => e.id)); }
}

export function fmtLen(x: number): string {
  return (Math.round(x * 1000) / 1000).toString().replace('.', ',');
}

export function fmtPt(p: Vec): string {
  return `${fmtLen(p.x)}; ${fmtLen(p.y)}`;
}

export { dist };
