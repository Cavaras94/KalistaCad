// Documento: entità, layer, impostazioni, annulla/ripeti.
import type { Ent, NewEnt, PrimCtx, Blocks } from './entities';
import { entBox, transform, blockUses } from './entities';
import { buildWallCtx } from './walls';
import { Box, emptyBox, boxUnion, boxValid, v, add, sub, mul, dot, norm, dist, angleOf, scaleAbout } from './geom';

export type LineType = 'continuous' | 'dashed' | 'hidden' | 'center' | 'dashdot';
export type Units = 'mm' | 'cm' | 'm';

export interface Layer {
  name: string;
  color: string;
  /** spessore di stampa in mm */
  lw: number;
  lt: LineType;
  visible: boolean;
  locked: boolean;
}

export interface Settings {
  units: Units;
  textH: number;
  dimH: number;
  dimDec: number;
  wallTh: number;
  doorW: number;
  windowW: number;
  hatchSp: number;
  ltScale: number;
  grid: number;
  snap: number;
  filletR: number;
  /** quote lineari con le frecce invece dei tratti obliqui */
  dimArrow: boolean;
  chamferD1: number;
  chamferD2: number;
  offsetD: number;
}

export const UNIT_MM: Record<Units, number> = { mm: 1, cm: 10, m: 1000 };
export const UNIT_LABEL: Record<Units, string> = { mm: 'millimetri', cm: 'centimetri', m: 'metri' };

/** Pattern dei tipi di linea, in mm di carta. */
export const LT_PATTERNS: Record<LineType, number[]> = {
  continuous: [],
  dashed: [4, 2],
  hidden: [2, 1],
  center: [8, 1.5, 1.5, 1.5],
  dashdot: [5, 1.5, 0.3, 1.5],
};
export const LT_NAMES: Record<LineType, string> = {
  continuous: 'Continua', dashed: 'Tratteggiata', hidden: 'Nascosta', center: 'Asse', dashdot: 'Tratto-punto',
};

/** Impostazioni che sono lunghezze nelle unità del disegno. */
const LENGTH_KEYS = ['textH', 'dimH', 'wallTh', 'doorW', 'windowW', 'hatchSp', 'grid', 'snap', 'filletR', 'offsetD', 'chamferD1', 'chamferD2'] as const;

export function defaultSettings(units: Units = 'cm'): Settings {
  const k = 10 / UNIT_MM[units]; // valori pensati in cm
  return {
    units,
    textH: 20 * k, // 2 mm su carta a 1:100, 4 mm a 1:50
    dimH: 15 * k,
    dimDec: units === 'm' ? 2 : 0,
    wallTh: 30 * k,
    doorW: 80 * k,
    windowW: 120 * k,
    hatchSp: 10 * k,
    ltScale: 1,
    grid: 50 * k,
    snap: 5 * k,
    filletR: 0,
    dimArrow: false,
    chamferD1: 0,
    chamferD2: 0,
    offsetD: 10 * k,
  };
}

export function defaultLayers(): Layer[] {
  return [
    { name: '0', color: '#ffffff', lw: 0.25, lt: 'continuous', visible: true, locked: false },
    { name: 'MURI', color: '#e0e0e0', lw: 0.5, lt: 'continuous', visible: true, locked: false },
    { name: 'SERRAMENTI', color: '#4fc3f7', lw: 0.25, lt: 'continuous', visible: true, locked: false },
    { name: 'QUOTE', color: '#81c784', lw: 0.18, lt: 'continuous', visible: true, locked: false },
    { name: 'TESTI', color: '#ffd54f', lw: 0.25, lt: 'continuous', visible: true, locked: false },
    { name: 'LOCALI', color: '#ce93d8', lw: 0.18, lt: 'continuous', visible: true, locked: false },
    { name: 'ARREDI', color: '#ff8a65', lw: 0.18, lt: 'continuous', visible: true, locked: false },
    { name: 'TRATTEGGI', color: '#90a4ae', lw: 0.13, lt: 'continuous', visible: true, locked: false },
  ];
}

/** Layer predefinito per ciascun tipo di entità "da planimetria". */
export const TYPE_LAYER: Partial<Record<Ent['t'], string>> = {
  wall: 'MURI', door: 'SERRAMENTI', window: 'SERRAMENTI', dim: 'QUOTE', room: 'LOCALI', hatch: 'TRATTEGGI',
};

/** editing: durante la modifica di un blocco, il disegno vero che aspetta e il nome del blocco. */
interface Snapshot {
  ents: Ent[]; layers: Layer[]; settings: Settings; blocks: Blocks; current: string;
  editing: { name: string; ents: Ent[] } | null;
  isolated: Doc['isolated'];
}

export interface DocData {
  /** 'planimetrie' è il nome che il programma aveva prima di chiamarsi Kalista. */
  format: 'kalista' | 'planimetrie';
  version: 1;
  ents: Ent[];
  layers: Layer[];
  current: string;
  settings: Settings;
  nextId: number;
  blocks?: Blocks;
  cartiglio?: Cartiglio;
}

/** Scritte del cartiglio di stampa: stanno nel disegno, così ogni file ha le sue. */
export interface Cartiglio { cliente: string; posa: string; note: string }
export const emptyCartiglio = (): Cartiglio => ({ cliente: '', posa: '', note: '' });

const MAX_UNDO = 100;

export class Doc {
  ents: Ent[] = [];
  layers: Layer[] = defaultLayers();
  current = '0';
  settings: Settings = defaultSettings();
  /** definizioni dei blocchi; ogni definizione si sostituisce intera, non si modifica sul posto */
  blocks: Blocks = {};
  cartiglio: Cartiglio = emptyCartiglio();
  nextId = 1;
  /** cambia a ogni modifica: chi disegna lo usa per sapere quando ridisegnare */
  version = 0;
  dirty = false;
  private undoStack: { label: string; snap: Snapshot }[] = [];
  private redoStack: { label: string; snap: Snapshot }[] = [];
  private ctxCache: { version: number; ctx: PrimCtx } | null = null;
  private listeners: (() => void)[] = [];
  /**
   * Modifica di un blocco sul posto: finché è attiva, ents è il contenuto del blocco e il disegno vero
   * aspetta qui. undoLen = lunghezza della pila di annullamento all'inizio: più indietro non si annulla.
   */
  editing: { name: string; ents: Ent[]; undoLen: number } | null = null;
  /** entità create su layer nascosti dall'ultima volta che qualcuno ha guardato (layer → quante) */
  hiddenAdds = new Map<string, number>();
  /** visibilità dei layer e layer corrente prima di ISOLA, per ANNULLAISOLA; null se niente è isolato */
  isolated: { visible: Map<string, boolean>; current: string } | null = null;

  onChange(fn: () => void) { this.listeners.push(fn); }

  private snapshot(): Snapshot {
    return {
      ents: this.ents.slice(), layers: this.layers.map(l => ({ ...l })), settings: { ...this.settings }, blocks: this.blocks,
      current: this.current, isolated: this.isolated,
      editing: this.editing ? { name: this.editing.name, ents: this.editing.ents } : null,
    };
  }

  private restore(s: Snapshot) {
    this.ents = s.ents;
    this.blocks = s.blocks;
    this.isolated = s.isolated;
    // anche il disegno che aspetta dietro la modifica di un blocco torna com'era (cambio unità, layer, nomi)
    if (this.editing && s.editing) this.editing = { ...s.editing, undoLen: this.editing.undoLen };
    this.layers = s.layers;
    this.settings = s.settings;
    this.current = this.layers.some(l => l.name === s.current) ? s.current : this.layers[0].name;
  }

  changed() {
    this.version++;
    this.dirty = true;
    this.listeners.forEach(f => f());
  }

  /** Esegue una modifica annullabile. Le entità non si modificano mai sul posto: si sostituiscono. */
  edit(label: string, fn: () => void) {
    const before = this.snapshot();
    const hosts = this.ents.some(e => e.t === 'door' || e.t === 'window') ? this.ctx().walls?.hosts : undefined;
    const firstNew = this.nextId;
    fn();
    if (hosts?.size) this.followWalls(before.ents, hosts);
    // entità nuove finite su layer nascosti: chi disegna va avvisato, perché non le vede
    if (this.nextId > firstNew) {
      for (let i = this.ents.length - 1; i >= 0 && this.ents[i].id >= firstNew; i--) {
        const name = this.ents[i].layer;
        if (!this.layer(name).visible) this.hiddenAdds.set(name, (this.hiddenAdds.get(name) ?? 0) + 1);
      }
    }
    this.undoStack.push({ label, snap: before });
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
      // la pila è scorsa di un posto: anche il punto da cui è cominciata la modifica del blocco
      if (this.editing && this.editing.undoLen > 0) this.editing.undoLen--;
    }
    this.redoStack = [];
    this.changed();
  }

  /**
   * Porte e finestre seguono il muro che le ospita: se in questa modifica il muro è stato spostato,
   * ruotato o stirato e l'apertura no, la si riporta sul muro alla stessa distanza dal suo inizio;
   * se il muro è stato cancellato, se ne va anche lei.
   */
  private followWalls(prev: readonly Ent[], hosts: Map<number, number>) {
    const was = new Map<number, Ent>();
    for (const e of prev) if (hosts.has(e.id) || e.t === 'wall') was.set(e.id, e);
    const now = new Map<number, Ent>();
    for (const e of this.ents) if (was.has(e.id)) now.set(e.id, e);
    const gone: number[] = [];
    const moved: Ent[] = [];
    let rehost: Map<number, number> | null = null;
    for (const [oid, wid] of hosts) {
      const o = now.get(oid), o0 = was.get(oid);
      if (!o || o !== o0 || (o.t !== 'door' && o.t !== 'window')) continue; // toccata direttamente: decide chi l'ha toccata
      const w0 = was.get(wid), w = now.get(wid);
      if (w === w0 || !w0 || w0.t !== 'wall') continue;
      if (!w || w.t !== 'wall') {
        // Il muro non c'è più con quel numero: può essere stato cancellato, oppure tagliato o spezzato
        // (i pezzi sono entità nuove). L'apertura resta se uno dei muri di adesso la ospita ancora.
        rehost ??= buildWallCtx(this.ents).hosts;
        if (!rehost.has(oid)) gone.push(oid);
        continue;
      }
      const th = o.th === w0.th ? w.th : o.th;
      const eps = 1e-9 * Math.max(1, dist(w0.a, w0.b));
      if (dist(w.a, w0.a) <= eps && dist(w.b, w0.b) <= eps) {
        // stesso asse: è cambiata una proprietà del muro (spessore, colore, layer)
        if (th !== o.th) moved.push({ ...o, th });
        continue;
      }
      const L = dist(w.a, w.b);
      if (L < o.w) { gone.push(oid); continue; }
      const u0 = norm(sub(w0.b, w0.a)), u = norm(sub(w.b, w.a));
      const n0 = { x: -u0.y, y: u0.x };
      const clamp = (s: number) => Math.max(o.w / 2, Math.min(L - o.w / 2, s));
      if (Math.abs(u0.x * u.y - u0.y * u.x) < 1e-9 && Math.abs(dot(sub(w.a, w0.a), n0)) <= eps) {
        // il muro è stato allungato, accorciato o rovesciato sulla sua stessa retta: l'apertura resta dov'è
        moved.push({ ...o, p: add(w.a, mul(u, clamp(dot(sub(o.p, w.a), u)))), th });
      } else {
        // il muro è stato spostato o ruotato: l'apertura lo segue, alla stessa distanza dal suo inizio
        moved.push({ ...o, p: add(w.a, mul(u, clamp(dot(sub(o.p, w0.a), u0)))), ang: o.ang + angleOf(w.a, w.b) - angleOf(w0.a, w0.b), th });
      }
    }
    if (moved.length) this.replace(moved);
    if (gone.length) this.remove(gone);
  }

  undo(): string | null {
    if (this.editing && this.undoStack.length <= this.editing.undoLen) return null;
    const it = this.undoStack.pop();
    if (!it) return null;
    this.redoStack.push({ label: it.label, snap: this.snapshot() });
    this.restore(it.snap);
    this.changed();
    return it.label;
  }

  redo(): string | null {
    const it = this.redoStack.pop();
    if (!it) return null;
    this.undoStack.push({ label: it.label, snap: this.snapshot() });
    this.restore(it.snap);
    this.changed();
    return it.label;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // -- entità (da chiamare dentro edit)

  add(e: NewEnt): Ent {
    const ent = { ...e, id: this.nextId++ } as Ent;
    if (!ent.layer) ent.layer = this.current;
    this.ents = [...this.ents, ent];
    return ent;
  }

  addMany(list: NewEnt[]): Ent[] {
    const out = list.map(e => ({ ...e, id: this.nextId++, layer: e.layer || this.current }) as Ent);
    this.ents = this.ents.concat(out);
    return out;
  }

  /** Come addMany, per le copie: i gruppi delle copie sono nuovi, non quelli degli originali. */
  addCopies(list: NewEnt[]): Ent[] {
    const groups = new Map<number, number>();
    return this.addMany(list.map(e => {
      if (e.g === undefined) return e;
      if (!groups.has(e.g)) groups.set(e.g, this.newGroupId());
      return { ...e, g: groups.get(e.g) };
    }));
  }

  replace(updated: Ent[]) {
    const m = new Map(updated.map(e => [e.id, e]));
    this.ents = this.ents.map(e => m.get(e.id) ?? e);
  }

  remove(ids: Iterable<number>) {
    const s = new Set(ids);
    this.ents = this.ents.filter(e => !s.has(e.id));
  }

  byId(id: number): Ent | undefined {
    return this.ents.find(e => e.id === id);
  }

  newGroupId(): number {
    return this.nextId++;
  }

  // -- layer

  layer(name: string): Layer {
    return this.layers.find(l => l.name === name) ?? this.layers[0];
  }

  ensureLayer(name: string, init?: Partial<Layer>): Layer {
    let l = this.layers.find(x => x.name === name);
    if (!l) {
      l = { name, color: '#ffffff', lw: 0.25, lt: 'continuous', visible: true, locked: false, ...init };
      this.layers = [...this.layers, l];
    }
    return l;
  }

  /** Quante entità usano il layer, comprese quelle dentro i blocchi. */
  layerUse(name: string): number {
    let n = 0;
    const count = (list: readonly Ent[]) => { for (const e of list) if (e.layer === name) n++; };
    count(this.ents);
    if (this.editing) count(this.editing.ents);
    for (const b of Object.values(this.blocks)) count(b.ents);
    return n;
  }

  /** Elimina un layer (non lo 0): ciò che contiene passa sul layer 0. Da chiamare dentro edit. */
  deleteLayer(name: string) {
    if (name === '0' || !this.layers.some(l => l.name === name)) return;
    const mv = (e: Ent): Ent => (e.layer === name ? ({ ...e, layer: '0' } as Ent) : e);
    this.ents = this.ents.map(mv);
    if (this.editing) this.editing.ents = this.editing.ents.map(mv);
    this.blocks = Object.fromEntries(Object.entries(this.blocks).map(([k, b]) => [k, { ents: b.ents.map(mv) }]));
    this.layers = this.layers.filter(l => l.name !== name);
    if (this.current === name) this.current = '0';
  }

  isEditable(e: Ent): boolean {
    const l = this.layer(e.layer);
    return l.visible && !l.locked;
  }

  /**
   * Cambia unità tenendo ferme le misure reali: un muro di 500 cm diventa di 5 m. Riscala le
   * coordinate, le definizioni dei blocchi e le impostazioni che sono lunghezze. Da chiamare
   * dentro edit.
   */
  convertUnits(to: Units) {
    const from = this.settings.units;
    const f = UNIT_MM[from] / UNIT_MM[to];
    if (f === 1) return;
    const m = scaleAbout(v(0, 0), f);
    // di un inserimento si sposta solo il punto: la scala la porta già la definizione del blocco
    const conv = (e: Ent): Ent => (e.t === 'insert' ? { ...e, p: mul(e.p, f) } : transform(e, m));
    this.ents = this.ents.map(conv);
    if (this.editing) this.editing.ents = this.editing.ents.map(conv);
    this.blocks = Object.fromEntries(Object.entries(this.blocks).map(([k, d]) => [k, { ents: d.ents.map(conv) }]));
    const s: Settings = { ...this.settings, units: to };
    for (const k of LENGTH_KEYS) s[k] = Math.round(s[k] * f * 1e9) / 1e9;
    if (to === 'm') s.dimDec = Math.max(s.dimDec, 2);
    else if (from === 'm' && s.dimDec === 2) s.dimDec = 0;
    this.settings = s;
  }

  // -- blocchi

  /** Apre un blocco per modificarlo: da qui in poi il disegno mostra solo il suo contenuto. */
  beginBlockEdit(name: string): boolean {
    const def = this.blocks[name];
    if (!def || this.editing) return false;
    this.editing = { name, ents: this.ents, undoLen: this.undoStack.length };
    this.ents = def.ents.map(e => ({ ...e, id: this.nextId++ }));
    this.redoStack = [];
    this.changed();
    return true;
  }

  /**
   * Chiude la modifica del blocco e torna al disegno. Con save il contenuto diventa la nuova
   * definizione (un solo passo di annullamento); gli inserimenti del blocco dentro se stesso
   * vengono tolti, e il loro numero è il risultato.
   */
  endBlockEdit(save: boolean): number {
    const ed = this.editing;
    if (!ed) return 0;
    const content = this.ents.filter(e => !blockUses([e], ed.name, this.blocks));
    const dropped = this.ents.length - content.length;
    this.ents = ed.ents;
    this.editing = null;
    this.undoStack.length = Math.min(this.undoStack.length, ed.undoLen);
    this.redoStack = [];
    if (save) {
      const before = this.snapshot();
      this.blocks = { ...this.blocks, [ed.name]: { ents: content } };
      this.undoStack.push({ label: 'Modifica blocco', snap: before });
    }
    this.changed();
    return dropped;
  }

  /** Rinomina un blocco e tutti i suoi inserimenti, anche dentro altri blocchi. Da chiamare dentro edit. */
  renameBlock(old: string, name: string) {
    const ren = (e: Ent): Ent => (e.t === 'insert' && e.name === old ? { ...e, name } : e);
    this.ents = this.ents.map(ren);
    if (this.editing) this.editing = { ...this.editing, ents: this.editing.ents.map(ren), name: this.editing.name === old ? name : this.editing.name };
    this.blocks = Object.fromEntries(Object.entries(this.blocks).map(([k, d]) => [k === old ? name : k, { ents: d.ents.map(ren) }]));
  }

  /** Nomi dei blocchi che nessun inserimento usa, nemmeno dentro altri blocchi usati. */
  unusedBlocks(): string[] {
    const used = new Set<string>();
    const visit = (ents: readonly Ent[]) => {
      for (const e of ents) if (e.t === 'insert' && !used.has(e.name)) { used.add(e.name); visit(this.blocks[e.name]?.ents ?? []); }
    };
    visit(this.editing ? [...this.editing.ents, ...this.ents] : this.ents);
    if (this.editing) used.add(this.editing.name);
    return Object.keys(this.blocks).filter(n => !used.has(n));
  }

  // -- contesto di rappresentazione

  ctx(): PrimCtx {
    if (this.ctxCache?.version === this.version) return this.ctxCache.ctx;
    const ctx: PrimCtx = {
      dimH: this.settings.dimH,
      dimDec: this.settings.dimDec,
      areaDiv: (1000 / UNIT_MM[this.settings.units]) ** 2,
      walls: buildWallCtx(this.ents),
      blocks: this.blocks,
      dimArrow: this.settings.dimArrow,
    };
    this.ctxCache = { version: this.version, ctx };
    return ctx;
  }

  extents(onlyVisible = true): Box | null {
    const ctx = this.ctx();
    let b = emptyBox();
    for (const e of this.ents) {
      if (onlyVisible && !this.layer(e.layer).visible) continue;
      const eb = entBox(e, ctx);
      if (boxValid(eb)) b = boxUnion(b, eb);
    }
    return boxValid(b) ? b : null;
  }

  // -- file

  toData(): DocData {
    // un blocco in corso di modifica si salva com'è in questo momento: altrimenti il file direbbe
    // "salvato" senza contenere il lavoro fatto dentro il blocco
    const ed = this.editing;
    const blocks = ed ? { ...this.blocks, [ed.name]: { ents: this.ents.filter(e => !blockUses([e], ed.name, this.blocks)) } } : this.blocks;
    return {
      // durante la modifica di un blocco il disegno da salvare è quello vero, non il contenuto del blocco
      format: 'kalista', version: 1, ents: this.editing ? this.editing.ents : this.ents, layers: this.layers,
      current: this.current, settings: this.settings, nextId: this.nextId,
      ...(Object.keys(blocks).length ? { blocks } : {}),
      ...(Object.values(this.cartiglio).some(Boolean) ? { cartiglio: this.cartiglio } : {}),
    };
  }

  /** Non passa dall'annulla: è un dato del file, come il suo nome. */
  setCartiglio(c: Cartiglio) {
    this.cartiglio = { ...c };
    this.changed();
  }

  load(d: DocData) {
    if (d.format !== 'kalista' && d.format !== 'planimetrie') throw new Error('Il file non è un disegno di Kalista');
    this.editing = null;
    this.isolated = null;
    this.ents = d.ents ?? [];
    this.blocks = d.blocks ?? {};
    this.cartiglio = { ...emptyCartiglio(), ...d.cartiglio };
    this.layers = d.layers?.length ? d.layers : defaultLayers();
    this.settings = { ...defaultSettings(d.settings?.units ?? 'cm'), ...d.settings };
    this.current = this.layers.some(l => l.name === d.current) ? d.current : this.layers[0].name;
    // un ciclo, non Math.max(...): con centinaia di migliaia di entità gli argomenti non starebbero nello stack
    let next = Math.max(d.nextId ?? 1, 1);
    for (const e of this.ents) if (e.id >= next) next = e.id + 1;
    this.nextId = next;
    this.undoStack = [];
    this.redoStack = [];
    this.changed();
    this.dirty = false;
  }

  reset(units: Units = 'cm') {
    this.editing = null;
    this.isolated = null;
    this.ents = [];
    this.blocks = {};
    this.cartiglio = emptyCartiglio();
    this.layers = defaultLayers();
    this.current = '0';
    this.settings = defaultSettings(units);
    this.nextId = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.changed();
    this.dirty = false;
  }
}
