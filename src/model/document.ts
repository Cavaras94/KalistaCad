// Documento: entità, layer, impostazioni, annulla/ripeti.
import type { Ent, NewEnt, PrimCtx, Blocks } from './entities';
import { entBox, transform } from './entities';
import { buildWallCtx } from './walls';
import { Box, emptyBox, boxUnion, boxValid, v, mul, scaleAbout } from './geom';

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

interface Snapshot { ents: Ent[]; layers: Layer[]; settings: Settings; blocks: Blocks }

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
}

const MAX_UNDO = 100;

export class Doc {
  ents: Ent[] = [];
  layers: Layer[] = defaultLayers();
  current = '0';
  settings: Settings = defaultSettings();
  /** definizioni dei blocchi; ogni definizione si sostituisce intera, non si modifica sul posto */
  blocks: Blocks = {};
  nextId = 1;
  /** cambia a ogni modifica: chi disegna lo usa per sapere quando ridisegnare */
  version = 0;
  dirty = false;
  private undoStack: { label: string; snap: Snapshot }[] = [];
  private redoStack: { label: string; snap: Snapshot }[] = [];
  private ctxCache: { version: number; ctx: PrimCtx } | null = null;
  private listeners: (() => void)[] = [];

  onChange(fn: () => void) { this.listeners.push(fn); }

  private snapshot(): Snapshot {
    return { ents: this.ents.slice(), layers: this.layers.map(l => ({ ...l })), settings: { ...this.settings }, blocks: this.blocks };
  }

  private restore(s: Snapshot) {
    this.ents = s.ents;
    this.blocks = s.blocks;
    this.layers = s.layers;
    this.settings = s.settings;
    if (!this.layers.some(l => l.name === this.current)) this.current = this.layers[0].name;
  }

  changed() {
    this.version++;
    this.dirty = true;
    this.listeners.forEach(f => f());
  }

  /** Esegue una modifica annullabile. Le entità non si modificano mai sul posto: si sostituiscono. */
  edit(label: string, fn: () => void) {
    const before = this.snapshot();
    fn();
    this.undoStack.push({ label, snap: before });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
  }

  undo(): string | null {
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
    this.blocks = Object.fromEntries(Object.entries(this.blocks).map(([k, d]) => [k, { ents: d.ents.map(conv) }]));
    const s: Settings = { ...this.settings, units: to };
    for (const k of LENGTH_KEYS) s[k] = Math.round(s[k] * f * 1e9) / 1e9;
    if (to === 'm') s.dimDec = Math.max(s.dimDec, 2);
    else if (from === 'm' && s.dimDec === 2) s.dimDec = 0;
    this.settings = s;
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
    return {
      format: 'kalista', version: 1, ents: this.ents, layers: this.layers,
      current: this.current, settings: this.settings, nextId: this.nextId,
      ...(Object.keys(this.blocks).length ? { blocks: this.blocks } : {}),
    };
  }

  load(d: DocData) {
    if (d.format !== 'kalista' && d.format !== 'planimetrie') throw new Error('Il file non è un disegno di Kalista');
    this.ents = d.ents ?? [];
    this.blocks = d.blocks ?? {};
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
    this.ents = [];
    this.blocks = {};
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
