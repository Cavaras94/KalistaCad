// Base dei comandi: richieste, opzioni, interpretazione delle coordinate digitate.
import type { Ent, NewEnt, Prim } from '../model/entities';
import type { Doc } from '../model/document';
import type { View } from '../view/view';
import { Vec, v, add, mul, sub, len, norm, dist } from '../model/geom';

export interface Opt { key: string; label: string }

export type InputMode = 'point' | 'select' | 'entity' | 'text' | 'none';

/** Una voce della finestra con le impostazioni di un comando; when = si vede solo se la scelta when[0] vale when[1]. */
export type FormField = { when?: [string, string] } & (
  /** numero; min = il più piccolo ammesso (escluso, salvo minIncl; di partenza 0); free = qualunque numero; int = solo interi */
  | { k: 'num'; key: string; label: string; value: number; unit?: string; min?: number; minIncl?: boolean; max?: number; free?: boolean; int?: boolean; hint?: string }
  /** una scelta fra poche voci, a pulsanti */
  | { k: 'choice'; key: string; label: string; value: string; options: [string, string][] }
  /** una scelta fra riquadri con il disegno di ciascuna voce (retini, blocchi) */
  | { k: 'tiles'; key: string; label: string; value: string; tiles: { value: string; label: string; prims: Prim[] }[] }
  | { k: 'check'; key: string; label: string; value: boolean });

export interface FormSpec {
  title: string;
  fields: FormField[];
  /** riga di spiegazione in cima */
  note?: string;
  /** pulsante in più a sinistra (per esempio "Col mouse"): chiude la finestra con _extra = true */
  extra?: string;
}

export type FormValues = Record<string, number | string | boolean> & { _extra?: boolean };

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
  /** finestra con delle caselle da spuntare; null se annullata */
  choose(title: string, items: { key: string; label: string; on: boolean }[]): Promise<Record<string, boolean> | null>;
  /** fa scegliere un file di immagine; w e h sono in pixel. null se si rinuncia */
  pickImage(): Promise<{ src: string; w: number; h: number } | null>;
  /** riquadro per scrivere un testo su più righe, vicino al punto `at` del disegno; null se annullato */
  write(o: { title: string; value?: string; at?: Vec; onInput?: (s: string) => void }): Promise<string | null>;
  /** vero se i comandi aprono le finestre con le loro impostazioni (si spengono nelle Impostazioni) */
  readonly dialogs: boolean;
  /** finestra con le impostazioni di un comando; null se la si chiude senza OK */
  form(spec: FormSpec): Promise<FormValues | null>;
  /** domanda sì/no con i pulsanti; def = la risposta di Invio; null se la si chiude senza rispondere */
  confirm(title: string, text: string, def: boolean): Promise<boolean | null>;
  /** vero se il comando è ancora quello in corso (o in attesa dietro uno zoom) */
  isCurrent(t: Tool): boolean;
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
  /** shift = clic con Maiusc premuto */
  entity(_e: Ent, _p: Vec, _shift = false): void {}
  /** clic a vuoto mentre si chiede un'entità; false = non gestito (l'applicazione avvisa) */
  entityMiss(_p: Vec): boolean { return false; }
  selectDone(): void {}
  /** testo o numero digitato; false = non riconosciuto */
  text(_s: string): boolean { return false; }
  option(_k: string): void {}
  /** Invio senza altro da fare chiude il comando, senza lasciare selezionato ciò che aveva evidenziato. */
  enter(): void { this.h.setSelection([]); this.h.done(); }
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

  /**
   * Impostazioni del comando in una finestra. Con le finestre spente nelle Impostazioni si va
   * avanti subito con then(undefined) e i valori si danno nella riga di comando; chiudendo la
   * finestra senza OK il comando finisce.
   */
  protected withForm(spec: FormSpec, then: (v: FormValues | undefined) => void) {
    if (!this.h.dialogs) { then(undefined); return; }
    this.ask(`${spec.title}: impostazioni nella finestra (Invio = OK, Esc = annulla)`, [], undefined, 'none');
    void this.h.form(spec).then(v => {
      if (!this.h.isCurrent(this)) return;
      if (v === null) { this.h.msg('*Annullato*'); this.cancel(); this.h.setSelection([]); this.h.done(); return; }
      then(v);
    });
  }

  /**
   * Domanda sì/no: nella riga di comando con le opzioni S e N e, se le finestre sono accese, anche
   * in una finestra con i pulsanti. La risposta arriva a option('S' | 'N'); chiudendo la finestra
   * senza rispondere resta la domanda nella riga di comando.
   */
  protected askYesNo(question: string, def: 'S' | 'N') {
    this.ask(question, [O('S', 'Sì'), O('N', 'No')], def === 'S' ? 'Sì' : 'No', 'none');
    if (!this.h.dialogs) return;
    const asked = this.promptText;
    void this.h.confirm(this.name, question.replace(/\?$/, '') + '?', def === 'S').then(r => {
      if (r === null || !this.h.isCurrent(this) || this.promptText !== asked) return;
      this.option(r ? 'S' : 'N');
      this.h.refresh();
    });
  }

  /** exact = solo la sigla dell'opzione, senza accettare l'inizio della sua etichetta */
  matchOption(s: string, exact = false): string | null {
    // senza badare ad accenti e maiuscole: "si" vale per "Sì"
    const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const u = fold(s.trim());
    if (!u) return null;
    for (const o of this.options) if (fold(o.key) === u) return o.key;
    if (exact) return null;
    for (const o of this.options) if (fold(o.label).startsWith(u)) return o.key;
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
 *  #x,y assolute anche dove un numero con la virgola sarebbe letto come decimale
 */
export function parsePoint(s: string, last: Vec | null, base: Vec | null, cursor: Vec): Vec | null {
  let t = s.trim().replace(/\s+/g, '');
  if (t.startsWith('#')) t = t.slice(1);
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
    } else this.ask(this.selPrompt, [], undefined, 'select');
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
