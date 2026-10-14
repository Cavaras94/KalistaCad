// Applicazione: vista, input, riga di comando, file.
import type { Ent, NewEnt, PrimCtx, SnapKind } from '../model/entities';
import { prims, grips, entBox, flatEnts, retext } from '../model/entities';
import { Doc, DocData, UNIT_LABEL, UNIT_MM } from '../model/document';
import { buildWallCtx } from '../model/walls';
import { Vec, Box, v, dist, boxOf, sub, angleOf, len, emptyBox, boxUnion, boxValid, same } from '../model/geom';
import { View } from '../view/view';
import { renderDoc, paint, entPrims, layerDash, whenImagesLoad } from '../view/render';
import { findSnap, pickAt, pickBox, SnapResult, SnapSettings, SNAP_LABEL } from '../view/snap';
import type { Host, Tool, FormSpec } from '../tools/base';
import { parsePoint, fmtLen } from '../tools/base';
import { GripTool } from '../tools/misc';
import { purgeBlocks } from '../tools/blocks';
import { layerAction } from '../tools/extra';
import { findCommand, suggest, COMMANDS } from './commands';
import { icon } from './icons';
import { logo, VERSION, VERSION_LONG } from './logo';
import { Panels } from './panels';
import { settingsDialog, helpDialog, printDialog, confirmBox, askText, importUnitsDialog, chooseDialog, pickImageFile, writeBox, formDialog, yesNoDialog, dialogsOn } from './dialogs';
import { exportDxf } from '../io/dxf-export';
import { importDxf, importDwg } from '../io/files';
import type { ImportResult } from '../io/importer';
import { importSize, guessUnits, rescaleImport } from '../io/importer';

const AUTOSAVE_KEY = 'planimetrie.autosave';
const BG = '#1b1f26';
const ACCENT = '#4da3ff';
const SNAP_COLOR = '#ffcf33';
const PICK_PX = 7;
const SNAP_PX = 12;
const MAX_GRIP_ENTS = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */
type FileHandle = any;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class App implements Host {
  doc = new Doc();
  view = new View();
  selection = new Set<number>();
  lastPoint: Vec | null = null;
  cursor: Vec = v(0, 0);
  clipboard: { ents: NewEnt[]; base: Vec } | null = null;

  private tool: Tool | null = null;
  private lastCmd: string | null = null;
  private snapSt: SnapSettings = { osnap: true, modes: new Set<SnapKind>(['end', 'mid', 'cen', 'int', 'perp', 'quad', 'ins']), gridSnap: false, ortho: false, polar: true, polarInc: 45, otrack: true };
  /** snap digitato (FIN, MED…), valido solo per il prossimo punto */
  private snapOnce: SnapKind | 'none' | null = null;
  /** ultimi punti agganciati con lo snap, per il puntamento */
  private acquired: Vec[] = [];
  /** comando messo in attesa da uno zoom o un pan fatto durante il comando */
  private suspended: { tool: Tool; lastPoint: Vec | null } | null = null;
  /** ultima selezione fatta per un comando, per l'opzione Precedente */
  private prevSelection: number[] = [];
  private gridOn = true;
  private lwt = false;
  private snap: SnapResult | null = null;
  private hover: Ent | null = null;
  private hotGrip: Vec | null = null;
  private mouse: Vec | null = null;
  private boxStart: Vec | null = null;
  private boxMoved = false;
  private panning: { x: number; y: number } | null = null;
  private lastMiddle = 0;
  private viewStack: { cx: number; cy: number; s: number }[] = [];
  private baseDirty = true;
  private frame = 0;
  private fileHandle: FileHandle | null = null;
  private fileName = 'Senza nome';
  private cmdHistory: string[] = [];
  private histIdx = -1;
  private printWin: Box | null = null;
  private pickingPrintWindow = false;
  private printWinStart: Vec | null = null;

  private base = $<HTMLCanvasElement>('base');
  private overlay = $<HTMLCanvasElement>('overlay');
  private gBase = this.base.getContext('2d')!;
  private gOver = this.overlay.getContext('2d')!;
  private input = $<HTMLInputElement>('cmdinput');
  private promptEl = $<HTMLElement>('prompt');
  private historyEl = $<HTMLElement>('history');
  private tipEl = $<HTMLElement>('tip');
  private suggestEl = $<HTMLElement>('suggest');
  private panels: Panels;
  private saveTimer = 0;

  constructor() {
    this.panels = new Panels(this.doc, () => this.selection, $('props'), $('layers'), () => this.updateStatus());
    this.buildToolbar();
    this.buildStatus();
    this.bindEvents();
    this.doc.onChange(() => this.onDocChange());
    whenImagesLoad(() => { this.baseDirty = true; this.schedule(); });
    const restored = this.restore();
    this.resize();
    new ResizeObserver(() => this.resize()).observe($('canvas-wrap'));
    if (restored) this.zoomExtents(); else this.defaultView();
    this.panels.refresh();
    this.setIdlePrompt();
    this.msg(`${VERSION_LONG}.`);
    this.msg('Kalista pronto. Digitare un comando (es. L, PL, MURO, PORTA, QL) oppure ? per l\'elenco.');
    window.addEventListener('beforeunload', e => { if (this.doc.dirty && !this.fileHandle) { this.autosaveNow(); } if (this.doc.dirty) { e.preventDefault(); } });
  }

  // ================================================================ Host

  msg(s: string) {
    const line = document.createElement('div');
    line.textContent = s;
    this.historyEl.append(line);
    while (this.historyEl.childElementCount > 400) this.historyEl.firstElementChild!.remove();
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  done() {
    this.snapOnce = null;
    this.acquired = [];
    const back = this.suspended;
    if (back) {
      // finito lo zoom o il pan: si riprende il comando che era in corso, dal punto in cui era
      this.suspended = null;
      this.tool = back.tool;
      this.lastPoint = back.lastPoint;
      this.snap = null;
      this.refresh();
      return;
    }
    this.tool = null;
    this.snap = null;
    this.setIdlePrompt();
    this.baseDirty = true;
    this.schedule();
  }

  refresh() {
    this.renderPrompt();
    this.baseDirty = true;
    this.schedule();
  }

  tol() { return PICK_PX / this.view.s; }

  choose(title: string, items: { key: string; label: string; on: boolean }[]) { return chooseDialog(title, items); }
  get dialogs() { return dialogsOn(); }
  form(spec: FormSpec) { return formDialog(spec); }
  confirm(title: string, text: string, def: boolean) { return yesNoDialog(title, text, def); }
  isCurrent(t: Tool) { return this.tool === t || this.suspended?.tool === t; }
  pickImage() { return pickImageFile(); }
  write(o: { title: string; value?: string; at?: Vec; onInput?: (s: string) => void }) {
    let at: { x: number; y: number } | undefined;
    if (o.at) {
      // sotto il punto, così sopra resta visibile l'anteprima nel disegno
      const s = this.view.toScreen(o.at), r = $('overlay').getBoundingClientRect();
      at = { x: r.left + s.x, y: r.top + s.y + 18 };
    }
    return writeBox({ ...o, at });
  }

  pick(p: Vec, filter?: (e: Ent) => boolean): Ent | null {
    return pickAt(this.doc, p, this.tol(), e => this.doc.isEditable(e) && (!filter || filter(e)));
  }

  setSelection(ids: Iterable<number>) {
    this.selection = new Set(ids);
    this.panels.renderProps();
    this.baseDirty = true;
    this.schedule();
  }

  zoomExtents() {
    const ext = this.doc.extents();
    if (!ext) { this.defaultView(); return; }
    this.pushView();
    const pad = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0) * 0.02 || 50;
    this.view.fit({ x0: ext.x0 - pad, y0: ext.y0 - pad, x1: ext.x1 + pad, y1: ext.y1 + pad }, 0.03);
    this.baseDirty = true;
    this.schedule();
  }

  zoomWindow(a: Vec, b: Vec) {
    if (dist(a, b) < 1e-9) return;
    this.pushView();
    this.view.fit(boxOf(a, b), 0);
    this.baseDirty = true;
    this.schedule();
  }

  zoomPrevious() {
    const s = this.viewStack.pop();
    if (!s) { this.msg('Nessuna vista precedente.'); return; }
    Object.assign(this.view, s);
    this.baseDirty = true;
    this.schedule();
  }

  run(cmd: string) {
    const def = findCommand(cmd);
    if (!def) { this.msg(`Comando sconosciuto: "${cmd}". Digitare ? per l'elenco dei comandi.`); return; }
    if (def.action) {
      // salvare o guardare layer e proprietà non deve far perdere il comando in corso
      if (this.tool && !['zoomext', 'regen', 'help', 'save', 'saveas', 'dxfout', 'layer', 'properties', 'selectall'].includes(def.action)) { this.dropSuspended(); this.cancelTool(true); }
      this.action(def.action);
      if (!['undo', 'redo'].includes(def.action)) this.lastCmd = def.name;
      return;
    }
    // zoom e pan dentro un comando non lo annullano: lo mettono in attesa e poi lo riprendono
    if (this.tool && (def.name === 'ZOOM' || def.name === 'PAN')) {
      // uno zoom dentro un pan (o viceversa) prende il suo posto: non si mettono in fila
      const isView = this.tool.name === 'ZOOM' || this.tool.name === 'PAN';
      if (!this.suspended && !isView) this.suspended = { tool: this.tool, lastPoint: this.lastPoint };
      else this.tool.cancel();
      this.boxStart = null;
      this.boxMoved = false;
      this.tool = def.make!(this);
      this.tool.start();
      this.refresh();
      return;
    }
    this.dropSuspended();
    if (this.tool) this.cancelTool(true);
    if (this.selection.size) this.prevSelection = [...this.selection];
    // un riquadro di selezione lasciato aperto non deve chiudersi sui clic del comando
    this.boxStart = null;
    this.boxMoved = false;
    this.lastCmd = def.name;
    this.tool = def.make!(this);
    this.tool.start();
    this.refresh();
  }

  /** Cambiato disegno: via ciò che il programma ricordava di quello di prima (i numeri delle entità ripartono). */
  private forgetDrawing() {
    this.printWin = null;
    this.prevSelection = [];
    this.lastPoint = null;
    this.acquired = [];
  }

  /** Annulla anche il comando che uno zoom o un pan aveva messo in attesa. */
  private dropSuspended() {
    if (!this.suspended) return;
    this.suspended.tool.cancel();
    this.suspended = null;
  }

  // ================================================================ vista

  private defaultView() {
    const s = this.doc.settings;
    const w = s.wallTh * 40;
    this.view.fit({ x0: -w * 0.05, y0: -w * 0.05, x1: w, y1: w * 0.65 }, 0);
    this.baseDirty = true;
    this.schedule();
  }

  private pushView() {
    this.viewStack.push({ cx: this.view.cx, cy: this.view.cy, s: this.view.s });
    if (this.viewStack.length > 30) this.viewStack.shift();
  }

  private resize() {
    const wrap = $('canvas-wrap');
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.base, this.overlay]) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
    this.gBase.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.gOver.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view.w = r.width;
    this.view.h = r.height;
    this.baseDirty = true;
    this.draw();
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw() {
    if (this.baseDirty) { this.renderBase(); this.baseDirty = false; }
    this.renderOverlay();
  }

  private renderBase() {
    const g = this.gBase;
    const { w, h } = this.view;
    g.fillStyle = BG;
    g.fillRect(0, 0, w, h);
    if (this.gridOn) this.renderGrid(g);
    renderDoc(g, this.view, this.doc, { lwt: this.lwt });
    if (this.selection.size) {
      const ctx = this.doc.ctx();
      g.save();
      for (const e of this.doc.ents) {
        if (!this.selection.has(e.id)) continue;
        paint(g, this.view, entPrims(e, ctx).map(p => (p.k === 'pl' && (p.fill || p.stroke === false) ? { ...p, fill: undefined, stroke: true } : p.k === 'area' ? { k: 'pl' as const, pts: p.loops[0], closed: true } : p)), {
          color: ACCENT, lw: 1.6, dash: [6, 4], wallAlpha: 0, tint: false,
        });
      }
      g.restore();
    }
  }

  private renderGrid(g: CanvasRenderingContext2D) {
    let step = this.doc.settings.grid;
    if (step <= 0) return;
    g.setLineDash([]);
    while (step * this.view.s < 12) step *= 5;
    const vb = this.view.visibleBox();
    g.save();
    g.lineWidth = 1;
    const x0 = Math.floor(vb.x0 / step) * step, y0 = Math.floor(vb.y0 / step) * step;
    for (const major of [false, true]) {
      g.strokeStyle = major ? '#2d3440' : '#232831';
      g.beginPath();
      for (let x = x0; x <= vb.x1; x += step) {
        const isMajor = Math.abs(Math.round(x / step) % 5) === 0;
        if (isMajor !== major) continue;
        const sx = Math.round(this.view.toScreen(v(x, 0)).x) + 0.5;
        g.moveTo(sx, 0); g.lineTo(sx, this.view.h);
      }
      for (let y = y0; y <= vb.y1; y += step) {
        const isMajor = Math.abs(Math.round(y / step) % 5) === 0;
        if (isMajor !== major) continue;
        const sy = Math.round(this.view.toScreen(v(0, y)).y) + 0.5;
        g.moveTo(0, sy); g.lineTo(this.view.w, sy);
      }
      g.stroke();
    }
    // assi
    const o = this.view.toScreen(v(0, 0));
    g.strokeStyle = '#3b4656';
    g.beginPath();
    g.moveTo(Math.round(o.x) + 0.5, 0); g.lineTo(Math.round(o.x) + 0.5, this.view.h);
    g.moveTo(0, Math.round(o.y) + 0.5); g.lineTo(this.view.w, Math.round(o.y) + 0.5);
    g.stroke();
    g.restore();
  }

  private previewCtx(list: Ent[]): PrimCtx {
    const s = this.doc.settings;
    const base = this.doc.ctx();
    return { dimH: s.dimH, dimDec: s.dimDec, areaDiv: base.areaDiv, walls: list.some(e => e.t === 'wall') ? buildWallCtx(list) : undefined, blocks: base.blocks };
  }

  private paintTemp(g: CanvasRenderingContext2D, list: NewEnt[], ghost: boolean) {
    if (!list.length) return;
    const ents = list.map((e, i) => ({ ...e, id: -1 - i }) as Ent);
    const ctx = this.previewCtx(ents);
    g.save();
    if (ghost) g.globalAlpha = 0.7;
    for (const e of ents) {
      const l = this.doc.layer(e.layer);
      paint(g, this.view, prims(e, ctx), {
        color: e.color ?? l.color, lw: 1, dash: ghost ? [5, 4] : layerDash(this.doc, l, this.view), wallAlpha: 0.3, tint: true,
      });
    }
    g.restore();
  }

  private renderOverlay() {
    const g = this.gOver;
    const { w, h } = this.view;
    g.clearRect(0, 0, w, h);
    const p = this.snap?.p ?? this.cursor;
    const t = this.tool;

    // entità sotto il cursore
    if (this.hover && (!t || t.mode === 'select' || t.mode === 'entity')) {
      paint(g, this.view, entPrims(this.hover, this.doc.ctx()).map(q => (q.k === 'pl' && (q.fill || q.stroke === false) ? { ...q, fill: undefined, stroke: true } : q)), {
        color: '#9cc8ff', lw: 2.2, dash: [], wallAlpha: 0, tint: false,
      });
    }

    if (t && this.mouse) {
      this.paintTemp(g, t.ghosts(p), true);
      this.paintTemp(g, t.preview(p), false);
      if (t.base && t.mode === 'point') {
        const a = this.view.toScreen(t.base), b = this.view.toScreen(p);
        g.save();
        g.strokeStyle = '#8fa3bf';
        g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.restore();
      }
    }

    // grip della selezione
    if (!t && this.selection.size && this.selection.size <= MAX_GRIP_ENTS) {
      g.save();
      for (const e of this.doc.ents) {
        if (!this.selection.has(e.id)) continue;
        grips(e, this.doc.ctx()).forEach((q, i) => {
          const s = this.view.toScreen(q);
          const hot = this.hotGrip && same(q, this.hotGrip, 1e-9);
          g.fillStyle = hot ? '#ff9800' : '#2f7cf6';
          g.strokeStyle = '#e8f0ff';
          g.lineWidth = 1;
          // il punto base di un blocco è più grande e ha una crocetta: è da lì che lo si prende per spostarlo
          const r = e.t === 'insert' && i === 0 ? 6 : 4;
          g.fillRect(s.x - r, s.y - r, 2 * r, 2 * r);
          g.strokeRect(s.x - r - 0.5, s.y - r - 0.5, 2 * r + 1, 2 * r + 1);
          if (r > 4) {
            const cx = Math.round(s.x) + 0.5, cy = Math.round(s.y) + 0.5;
            g.beginPath();
            g.moveTo(cx - 11, cy); g.lineTo(cx + 11, cy); g.moveTo(cx, cy - 11); g.lineTo(cx, cy + 11);
            g.stroke();
          }
        });
      }
      g.restore();
    }

    // riquadro di selezione
    if (this.boxStart && this.mouse) {
      const a = this.boxStart, b = this.mouse;
      const crossing = b.x < a.x || !!t?.forceCrossing;
      g.save();
      g.fillStyle = crossing ? 'rgba(80,200,120,0.12)' : 'rgba(77,163,255,0.12)';
      g.strokeStyle = crossing ? '#5ac878' : ACCENT;
      g.setLineDash(crossing ? [5, 4] : []);
      g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      g.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      g.restore();
    }
    if (this.printWinStart && this.mouse) {
      const a = this.view.toScreen(this.printWinStart), b = this.mouse;
      g.save(); g.strokeStyle = '#ff9800'; g.setLineDash([6, 4]);
      g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      g.restore();
    }

    // puntamento polare / orto
    if (this.snap?.track && this.mouse) {
      const o = this.view.toScreen(this.snap.track.from);
      const ang = this.snap.track.ang;
      const L = Math.hypot(w, h) * 2;
      g.save();
      g.strokeStyle = 'rgba(120,220,140,0.7)';
      g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(o.x + Math.cos(ang) * L, o.y - Math.sin(ang) * L); g.stroke();
      g.restore();
    }

    // puntamento snap ad oggetto: tratto dal punto acquisito al punto allineato
    if (this.snap?.align && this.mouse) {
      const q = this.view.toScreen(this.snap.p);
      g.save();
      g.strokeStyle = 'rgba(120,220,140,0.8)';
      for (const a of this.snap.align) {
        const o = this.view.toScreen(a);
        g.setLineDash([2, 4]);
        g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(q.x, q.y); g.stroke();
        g.setLineDash([]);
        g.beginPath(); g.moveTo(o.x - 4, o.y); g.lineTo(o.x + 4, o.y); g.moveTo(o.x, o.y - 4); g.lineTo(o.x, o.y + 4); g.stroke();
      }
      g.restore();
    }

    if (this.snap?.k && this.snap.k !== 'grid' && this.mouse) this.drawSnapMarker(g, this.view.toScreen(this.snap.p), this.snap.k);

    // mirino
    if (this.mouse) {
      const m = this.snap?.k && this.snap.k !== 'grid' ? this.view.toScreen(p) : t?.mode === 'point' ? this.view.toScreen(p) : this.mouse;
      g.save();
      g.strokeStyle = 'rgba(200,210,225,0.65)';
      g.lineWidth = 1;
      g.beginPath();
      const cx = Math.round(m.x) + 0.5, cy = Math.round(m.y) + 0.5;
      const arm = t?.mode === 'point' || !t ? 4000 : 18;
      g.moveTo(cx - arm, cy); g.lineTo(cx - 6, cy); g.moveTo(cx + 6, cy); g.lineTo(cx + arm, cy);
      g.moveTo(cx, cy - arm); g.lineTo(cx, cy - 6); g.moveTo(cx, cy + 6); g.lineTo(cx, cy + arm);
      g.stroke();
      if (!t || t.mode !== 'point') { g.strokeStyle = '#e0e6ef'; g.strokeRect(cx - PICK_PX, cy - PICK_PX, PICK_PX * 2, PICK_PX * 2); }
      g.restore();
    }
    this.updateTip();
  }

  private drawSnapMarker(g: CanvasRenderingContext2D, s: Vec, k: SnapKind) {
    const r = 6;
    g.save();
    g.strokeStyle = SNAP_COLOR;
    g.lineWidth = 2;
    g.beginPath();
    switch (k) {
      case 'end': g.rect(s.x - r, s.y - r, 2 * r, 2 * r); break;
      case 'mid': g.moveTo(s.x, s.y - r); g.lineTo(s.x + r, s.y + r * 0.8); g.lineTo(s.x - r, s.y + r * 0.8); g.closePath(); break;
      case 'cen': g.arc(s.x, s.y, r, 0, Math.PI * 2); break;
      case 'quad': g.moveTo(s.x, s.y - r); g.lineTo(s.x + r, s.y); g.lineTo(s.x, s.y + r); g.lineTo(s.x - r, s.y); g.closePath(); break;
      case 'int': g.moveTo(s.x - r, s.y - r); g.lineTo(s.x + r, s.y + r); g.moveTo(s.x + r, s.y - r); g.lineTo(s.x - r, s.y + r); break;
      case 'perp': g.moveTo(s.x - r, s.y + r); g.lineTo(s.x + r, s.y + r); g.moveTo(s.x, s.y + r); g.lineTo(s.x, s.y - r); break;
      case 'near': g.moveTo(s.x - r, s.y - r); g.lineTo(s.x + r, s.y - r); g.lineTo(s.x - r, s.y + r); g.lineTo(s.x + r, s.y + r); g.closePath(); break;
      case 'ins': g.rect(s.x - r, s.y - r, 2 * r, 2 * r); g.moveTo(s.x - r, s.y); g.lineTo(s.x + r, s.y); break;
      default: break;
    }
    g.stroke();
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = 'rgba(20,24,30,0.85)';
    const label = SNAP_LABEL[k];
    const tw = g.measureText(label).width;
    g.fillRect(s.x + 10, s.y + 8, tw + 8, 16);
    g.fillStyle = SNAP_COLOR;
    g.fillText(label, s.x + 14, s.y + 20);
    g.restore();
  }

  private updateTip() {
    const t = this.tool;
    const tip = this.tipEl;
    if (!this.mouse || !t || !t.promptText) { tip.style.display = 'none'; return; }
    const p = this.snap?.p ?? this.cursor;
    let txt = t.promptText.replace(/ o$/, '');
    if (t.base && t.mode === 'point') {
      const d = sub(p, t.base);
      txt += `\nL ${fmtLen(len(d))}   ∠ ${fmtLen(Math.round(((angleOf(t.base, p) * 180) / Math.PI + 360) % 360 * 100) / 100)}°`;
    }
    if (this.input.value) txt += `\n› ${this.input.value}`;
    tip.textContent = txt;
    tip.style.display = 'block';
    const W = this.view.w;
    const x = this.mouse.x + 18, y = this.mouse.y + 18;
    tip.style.left = `${Math.min(x, W - tip.offsetWidth - 6)}px`;
    tip.style.top = `${Math.min(y, this.view.h - tip.offsetHeight - 6)}px`;
  }

  // ================================================================ input

  private screenPt(e: MouseEvent): Vec {
    const r = this.overlay.getBoundingClientRect();
    return v(e.clientX - r.left, e.clientY - r.top);
  }

  private updateCursor() {
    if (!this.mouse) return;
    const world = this.view.toWorld(this.mouse.x, this.mouse.y);
    this.cursor = world;
    const t = this.tool;
    if (t && t.mode === 'point') {
      this.snap = findSnap(this.doc, world, SNAP_PX / this.view.s, this.snapSt, t.base ?? undefined, t.snapExclude, { only: this.snapOnce ?? undefined, acquired: this.acquired });
      // un punto agganciato resta "acquisito": muovendosi in orizzontale o in verticale da lì ci si allinea
      const sk = this.snap.k;
      if (this.snapSt.otrack && sk && sk !== 'grid' && sk !== 'near' && sk !== 'perp') {
        const q = this.snap.p;
        if (!this.acquired.some(a => same(a, q, 1e-9))) this.acquired = [q, ...this.acquired].slice(0, 2);
      }
      this.hover = null;
    } else {
      this.snap = null;
      this.hover = !this.boxStart ? pickAt(this.doc, world, this.tol(), e => this.doc.isEditable(e)) : null;
    }
    this.hotGrip = null;
    if (!t && this.selection.size && this.selection.size <= MAX_GRIP_ENTS) {
      const tolPx = 6;
      for (const e of this.doc.ents) {
        if (!this.selection.has(e.id)) continue;
        for (const q of grips(e, this.doc.ctx())) {
          const s = this.view.toScreen(q);
          if (Math.abs(s.x - this.mouse.x) <= tolPx && Math.abs(s.y - this.mouse.y) <= tolPx) { this.hotGrip = q; break; }
        }
        if (this.hotGrip) break;
      }
    }
    this.updateCoords();
  }

  private bindEvents() {
    const c = this.overlay;
    c.addEventListener('mousemove', e => {
      const s = this.screenPt(e);
      if (this.panning) {
        this.view.panBy(s.x - this.panning.x, s.y - this.panning.y);
        this.panning = s;
        this.baseDirty = true;
      }
      if (this.boxStart && dist(s, this.boxStart) > 5) this.boxMoved = true;
      this.mouse = s;
      this.updateCursor();
      this.schedule();
    });
    c.addEventListener('mouseleave', () => { this.mouse = null; this.hover = null; this.schedule(); });
    c.addEventListener('mousedown', e => this.onMouseDown(e));
    window.addEventListener('mouseup', e => {
      if (this.panning && (e.button === 1 || e.button === 0)) { this.panning = null; c.style.cursor = ''; }
      if (e.button === 0 && this.boxStart && this.boxMoved && this.mouse) this.finishBox(this.mouse, e.shiftKey);
      // finestra di stampa presa trascinando, oltre che con due clic
      if (e.button === 0 && this.pickingPrintWindow && this.printWinStart && this.mouse && dist(this.view.toScreen(this.printWinStart), this.mouse) > 8) this.finishPrintWindow(this.cursor);
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const s = this.screenPt(e);
      const f = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 30 : 1));
      this.view.zoomAt(s.x, s.y, Math.min(4, Math.max(0.25, f)));
      this.baseDirty = true;
      this.updateCursor();
      this.schedule();
    }, { passive: false });
    c.addEventListener('contextmenu', e => { e.preventDefault(); this.submit(''); });
    c.addEventListener('dblclick', e => {
      if (e.button !== 0 || this.tool) return;
      const hit = this.pick(this.view.toWorld(this.screenPt(e).x, this.screenPt(e).y));
      if (hit && (hit.t === 'text' || hit.t === 'room' || hit.t === 'dim' || hit.t === 'leader')) this.editText(hit);
    });

    this.input.addEventListener('keydown', e => this.onCmdKey(e));
    this.input.addEventListener('input', () => {
      this.tool?.typing(this.input.value);
      this.renderSuggest();
      this.schedule();
    });
    document.addEventListener('keydown', e => this.onGlobalKey(e));
    $('file-input').addEventListener('change', e => this.onFilePicked(e));
    this.promptEl.addEventListener('click', e => {
      const k = (e.target as HTMLElement).dataset.opt;
      if (k && this.tool) { this.tool.option(k); this.refresh(); }
    });
  }

  private onMouseDown(e: MouseEvent) {
    const s = this.screenPt(e);
    this.mouse = s;
    this.updateCursor();
    if (e.button === 1) {
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastMiddle < 350) { this.zoomExtents(); this.lastMiddle = 0; return; }
      this.lastMiddle = now;
      this.panning = s;
      this.overlay.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    this.input.focus({ preventScroll: true });
    const t = this.tool;
    const world = this.cursor;

    if (this.pickingPrintWindow) {
      if (!this.printWinStart) { this.printWinStart = world; this.msg('Specificare l\'angolo opposto.'); return; }
      this.finishPrintWindow(world);
      return;
    }
    if (t && (t as { panMode?: boolean }).panMode) { this.panning = s; return; }
    if (t && t.mode === 'point') {
      if (this.snap?.miss) { this.msg('Lì vicino non c\'è il punto di snap richiesto: avvicinarsi all\'entità (Esc per rinunciare).'); return; }
      this.feedPoint(this.snap?.p ?? world);
      return;
    }
    if (t && t.mode === 'entity') {
      const hit = this.pick(world);
      if (hit) { t.entity(hit, world, e.shiftKey); this.refresh(); }
      else if (t.entityMiss(world)) this.refresh();
      else this.msg('Nessuna entità in quel punto.');
      return;
    }
    if (t && t.mode !== 'select') return;

    // selezione (a riposo o su richiesta del comando)
    if (!t && this.hotGrip) {
      this.tool = new GripTool(this, this.hotGrip);
      this.tool.start();
      this.refresh();
      return;
    }
    if (this.boxStart) { this.finishBox(s, e.shiftKey); return; }
    const hit = t?.forceCrossing ? null : this.pick(world);
    if (hit) {
      const ids = this.groupOf(hit);
      const sel = new Set(this.selection);
      if (e.shiftKey) ids.forEach(i => sel.delete(i)); else ids.forEach(i => sel.add(i));
      this.setSelection(sel);
      return;
    }
    this.boxStart = s;
    this.boxMoved = false;
  }

  private groupOf(e: Ent): number[] {
    if (e.g === undefined) return [e.id];
    return this.doc.ents.filter(x => x.g === e.g).map(x => x.id);
  }

  private finishBox(endScreen: Vec, remove: boolean) {
    const a = this.boxStart!;
    this.boxStart = null;
    this.boxMoved = false;
    if (dist(a, endScreen) < 3) { this.schedule(); return; }
    const wa = this.view.toWorld(a.x, a.y), wb = this.view.toWorld(endScreen.x, endScreen.y);
    const box = boxOf(wa, wb);
    const crossing = endScreen.x < a.x || !!this.tool?.forceCrossing;
    const found = pickBox(this.doc, box, crossing).filter(e => this.doc.isEditable(e));
    const sel = new Set(this.selection);
    for (const e of found) for (const id of this.groupOf(e)) { if (remove) sel.delete(id); else sel.add(id); }
    this.setSelection(sel);
    const st = this.tool as unknown as { setBox?: (b: Box) => void } | null;
    if (st?.setBox) st.setBox(box);
    if (this.tool?.mode === 'select') this.msg(`${found.length} trovate, ${sel.size} selezionate in totale.`);
  }

  private feedPoint(p: Vec) {
    if (!this.tool) return;
    this.lastPoint = p;
    this.snapOnce = null;
    this.acquired = [];
    this.tool.point(p);
    this.updateCursor();
    this.refresh();
  }

  private onCmdKey(e: KeyboardEvent) {
    const t = this.tool;
    if (e.key === 'Enter' || (e.key === ' ' && (!t || t.mode !== 'text'))) {
      e.preventDefault();
      const first = this.suggestEl.querySelector<HTMLElement>('.sg.active');
      // Invio completa il comando suggerito solo da due lettere in su: una lettera sola che non è un
      // comando (una risposta S o N arrivata tardi) non deve lanciare NUOVO o SALVA.
      const typed = this.input.value.trim();
      const val = !t && first && e.key === 'Enter' && typed.length >= 2 && !findCommand(typed) ? first.dataset.cmd! : this.input.value;
      this.input.value = '';
      this.renderSuggest();
      this.submit(val);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.input.value = '';
      this.renderSuggest();
      this.escape();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!this.cmdHistory.length) return;
      e.preventDefault();
      this.histIdx = e.key === 'ArrowUp' ? Math.max(0, (this.histIdx < 0 ? this.cmdHistory.length : this.histIdx) - 1) : Math.min(this.cmdHistory.length, this.histIdx + 1);
      this.input.value = this.cmdHistory[this.histIdx] ?? '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const first = this.suggestEl.querySelector<HTMLElement>('.sg');
      if (first) { this.input.value = first.dataset.cmd!; this.renderSuggest(); }
    }
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement;
    return t !== this.input && (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement);
  }

  private onGlobalKey(e: KeyboardEvent) {
    if (document.querySelector('.modal')) return;
    // Un menu a tendina dei pannelli che tiene il fuoco userebbe le lettere per cercare fra le voci
    // (M sposterebbe la selezione sul layer MURI): le lettere vanno alla riga di comando.
    if (e.target instanceof HTMLSelectElement && e.target.closest('#side') && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.target.blur();
      this.input.focus({ preventScroll: true });
      this.input.value += e.key;
      this.input.dispatchEvent(new Event('input'));
      return;
    }
    if (this.isTyping(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const fkeys: Record<string, () => void> = {
      F1: () => this.run('HELP'),
      F2: () => document.body.classList.toggle('history-open'),
      F3: () => this.toggle('osnap'),
      F7: () => this.toggle('grid'),
      F8: () => this.toggle('ortho'),
      F9: () => this.toggle('snap'),
      F10: () => this.toggle('polar'),
      F11: () => this.toggle('otrack'),
    };
    if (fkeys[k]) { e.preventDefault(); fkeys[k](); return; }
    if (ctrl) {
      const key = k.toLowerCase();
      const map: Record<string, string> = { z: 'UNDO', y: 'REDO', s: e.shiftKey ? 'SAVEAS' : 'SAVE', o: 'OPEN', n: 'NEW', p: 'PRINT', a: 'SELECTALL', '1': 'PROPERTIES', v: 'PASTECLIP' };
      if (key === 'c' || key === 'x') {
        if (e.target === this.input && this.input.selectionStart !== this.input.selectionEnd) return;
        e.preventDefault();
        this.run(key === 'c' ? 'COPYCLIP' : 'CUTCLIP');
        return;
      }
      if (map[key]) { e.preventDefault(); this.run(map[key]); }
      return;
    }
    // Canc vale anche con il cursore nella riga di comando, se non c'è niente da cancellare lì
    if (k === 'Delete' && e.target === this.input && !this.input.value && !this.tool && this.selection.size) { e.preventDefault(); this.run('ERASE'); return; }
    if (e.target === this.input) return;
    if (k === 'Escape') { e.preventDefault(); this.escape(); return; }
    if (k === 'Delete' && !this.tool && this.selection.size) { e.preventDefault(); this.run('ERASE'); return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); this.submit(this.input.value); this.input.value = ''; return; }
    if (k.length === 1 && !e.altKey) {
      e.preventDefault();
      this.input.focus({ preventScroll: true });
      this.input.value += k;
      this.input.dispatchEvent(new Event('input'));
    }
  }

  private escape() {
    if (this.pickingPrintWindow) { this.pickingPrintWindow = false; this.printWinStart = null; this.msg('*Annullato*'); this.schedule(); return; }
    if (this.boxStart) { this.boxStart = null; this.schedule(); return; }
    if (this.tool) { this.cancelTool(false); return; }
    if (this.selection.size) this.setSelection([]);
  }

  private cancelTool(silent: boolean) {
    if (!this.tool) return;
    this.tool.cancel();
    if (!silent) this.msg('*Annullato*');
    this.tool = null;
    this.boxStart = null;
    // se dietro c'è un comando in attesa (annullato solo lo zoom), la sua selezione resta
    if (!this.suspended) this.setSelection([]);
    this.done();
  }

  private submit(raw: string) {
    const s = raw.trim();
    const t = this.tool;
    this.msg(`${this.promptEl.textContent ?? ''} ${raw}`.trim());
    if (s && !t) { this.cmdHistory.push(s); this.histIdx = -1; }
    if (!t) {
      if (s) this.run(s);
      else if (this.lastCmd) this.run(this.lastCmd);
      return;
    }
    if (t.mode === 'text') { t.text(raw); this.refresh(); return; }
    if (!s) {
      if (t.mode === 'select') {
        this.boxStart = null;
        if (this.selection.size) this.prevSelection = [...this.selection];
        t.selectDone();
      } else t.enter();
      this.refresh();
      return;
    }
    // Prima la sigla esatta di un'opzione, poi le parole chiave, e solo dopo l'inizio di un'etichetta:
    // altrimenti CEN diventerebbe l'opzione Centro, INT l'opzione Interno, FIN l'opzione Finestra.
    const exact = t.matchOption(s, true);
    if (exact) { t.option(exact); this.refresh(); return; }
    if (t.mode === 'select' && this.selectKeyword(s)) return;
    if (t.mode === 'point' && this.snapKeyword(s)) return;
    const opt = t.matchOption(s);
    if (opt) { t.option(opt); this.refresh(); return; }
    const view = this.viewCommand(s);
    if (view) { this.run(view); return; }
    if (t.mode !== 'point') {
      if (!t.text(s)) this.msg('Opzione non valida.');
      this.refresh();
      return;
    }
    if (t.numberAsText && !s.startsWith('#') && t.text(s)) {
      // a questo passo si aspetta un numero, e la virgola è la virgola dei decimali
      if (/^[-+]?\d{2,}(\.\d+)?,\d{2,}$/.test(s)) this.msg(`"${s}" letto come numero con la virgola. Per indicare un punto a questo passo: un clic, oppure #x,y.`);
      this.refresh();
      return;
    }
    const p = parsePoint(s, this.lastPoint, t.base, this.snap?.p ?? this.cursor);
    if (p) {
      // in metri "2,40" dopo un primo punto è quasi sempre una distanza scritta con la virgola: qui però è il punto (2; 40)
      if (t.base && this.doc.settings.units === 'm' && /^[-+]?\d+,\d+$/.test(s)) this.msg(`"${s}" letto come il punto (${s.replace(',', '; ')}). Per una distanza con i decimali usare il punto: ${s.replace(',', '.')}`);
      this.feedPoint(p);
      return;
    }
    if (t.text(s)) { this.refresh(); return; }
    this.msg('Punto o opzione non validi. Esempi: 100,50   @200,0   @300<45   oppure una distanza.');
  }

  /** Zoom e pan digitati durante un comando: Z, ZE, PAN, oppure qualunque comando di vista con l'apostrofo ('Z). */
  private viewCommand(s: string): string | null {
    const d = findCommand(s);
    if (!d || !['ZOOM', 'PAN', 'ZOOMEXTENTS', 'REGEN'].includes(d.name)) return null;
    return s.startsWith('\'') || ['Z', 'ZOOM', 'ZE', 'PAN'].includes(s.toUpperCase()) ? d.name : null;
  }

  /** Alla richiesta "Selezionare entità": TUTTO, Ultimo, Precedente. */
  private selectKeyword(s: string): boolean {
    const u = s.toUpperCase();
    const doc = this.doc;
    let ids: number[] | null = null;
    if (['TUTTO', 'TUTTI', 'TUTTE', 'ALL', 'T'].includes(u)) ids = doc.ents.filter(e => doc.isEditable(e)).map(e => e.id);
    else if (['ULTIMO', 'ULTIMA', 'U', 'LAST', 'L'].includes(u)) {
      const last = [...doc.ents].reverse().find(e => doc.isEditable(e));
      ids = last ? this.groupOf(last) : [];
    } else if (['PRECEDENTE', 'P', 'PREVIOUS'].includes(u)) {
      ids = this.prevSelection.filter(id => { const e = doc.byId(id); return !!e && doc.isEditable(e); });
    }
    if (!ids) return false;
    const sel = new Set(this.selection);
    ids.forEach(i => sel.add(i));
    this.setSelection(sel);
    this.msg(`${ids.length} trovate, ${sel.size} selezionate in totale.`);
    this.refresh();
    return true;
  }

  /** Snap digitato mentre si chiede un punto: vale solo per quel punto. */
  private snapKeyword(s: string): boolean {
    const words: Record<string, SnapKind | 'none'> = {
      FIN: 'end', END: 'end', NOD: 'end', MED: 'mid', MID: 'mid', INT: 'int', PER: 'perp', PERP: 'perp',
      CEN: 'cen', QUA: 'quad', QUAD: 'quad', VIC: 'near', NEA: 'near', INS: 'ins', NES: 'none', NON: 'none',
    };
    const k = words[s.toUpperCase()];
    if (!k) return false;
    this.snapOnce = k;
    this.msg(k === 'none' ? 'Nessuno snap per il prossimo punto.' : `Snap ${SNAP_LABEL[k]} per il prossimo punto.`);
    this.updateCursor();
    this.refresh();
    return true;
  }

  private renderPrompt() {
    const t = this.tool;
    if (!t) { this.setIdlePrompt(); return; }
    this.promptEl.innerHTML = '';
    this.promptEl.append(`${t.name}: ${t.promptText}`);
    if (t.options.length) {
      this.promptEl.append(' [');
      t.options.forEach((o, i) => {
        if (i) this.promptEl.append('/');
        const sp = document.createElement('span');
        sp.className = 'opt';
        sp.dataset.opt = o.key;
        sp.textContent = o.label;
        this.promptEl.append(sp);
      });
      this.promptEl.append(']');
    }
    if (t.def !== undefined) this.promptEl.append(` <${t.def}>`);
    this.promptEl.append(':');
  }

  private setIdlePrompt() {
    this.promptEl.textContent = 'Comando:';
  }

  private renderSuggest() {
    const el = this.suggestEl;
    el.innerHTML = '';
    if (this.tool) return;
    const list = suggest(this.input.value);
    list.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'sg' + (i === 0 ? ' active' : '');
      d.dataset.cmd = s.key;
      d.innerHTML = `<b>${s.key}</b> <span>${s.cmd.label}</span>`;
      d.onmousedown = ev => { ev.preventDefault(); this.input.value = ''; this.renderSuggest(); this.submit(s.key); };
      el.append(d);
    });
  }

  private async editText(e: Ent) {
    // tutti in un riquadro a più righe, accanto al testo: Invio va a capo
    const cur = e.t === 'text' || e.t === 'leader' ? e.s : e.t === 'room' ? e.name : e.t === 'dim' ? e.s ?? '' : '';
    const title = e.t === 'room' ? 'Nome del locale' : e.t === 'dim' ? 'Testo della quota (vuoto = misura)' : e.t === 'leader' ? 'Testo della direttrice' : 'Modifica testo';
    const at = e.t === 'text' || e.t === 'dim' ? e.p : e.t === 'leader' ? e.pts[e.pts.length - 1] : undefined;
    const val = await this.write({ title, value: cur, at });
    if (val === null || !this.doc.byId(e.id)) return;
    const s = val.trimEnd();
    let next: Ent;
    if (e.t === 'text') { if (!s.trim()) return; next = retext(e, s); }
    else if (e.t === 'leader') next = { ...e, s: s.trim() };
    else if (e.t === 'room') next = { ...e, name: s.trim() };
    else if (e.t === 'dim') { next = { ...e }; if (s.trim()) next.s = s.trim(); else delete next.s; }
    else return;
    this.doc.edit('Modifica testo', () => this.doc.replace([next]));
  }

  // ================================================================ azioni

  private action(a: string) {
    const doc = this.doc;
    switch (a) {
      case 'undo': { const l = doc.undo(); this.msg(l ? `Annullato: ${l}` : 'Niente da annullare.'); this.pruneSelection(); break; }
      case 'redo': { const l = doc.redo(); this.msg(l ? `Ripristinato: ${l}` : 'Niente da ripristinare.'); this.pruneSelection(); break; }
      case 'selectall': this.setSelection(doc.ents.filter(e => doc.isEditable(e)).map(e => e.id)); this.msg(`${this.selection.size} entità selezionate.`); break;
      case 'copyclip': case 'cutclip': {
        // tagliare toglie solo ciò che si può modificare: i layer bloccati restano dove sono
        const sel = doc.ents.filter(e => this.selection.has(e.id) && (a === 'copyclip' || doc.isEditable(e)));
        if (!sel.length) { this.msg('Selezionare prima le entità.'); break; }
        const ctx = doc.ctx();
        let b = emptyBox();
        for (const e of sel) { const eb = entBox(e, ctx); if (boxValid(eb)) b = boxUnion(b, eb); }
        if (!boxValid(b)) b = { x0: 0, y0: 0, x1: 0, y1: 0 };
        this.clipboard = { ents: sel.map(({ id: _id, ...r }) => r as NewEnt), base: v(b.x0, b.y0) };
        if (a === 'cutclip') { doc.edit('Taglia', () => doc.remove(sel.map(e => e.id))); this.setSelection([]); }
        this.msg(`${sel.length} entità negli appunti. Ctrl+V per incollare.`);
        break;
      }
      case 'zoomext': this.zoomExtents(); break;
      case 'regen': this.baseDirty = true; this.schedule(); break;
      case 'new': this.newDoc(); break;
      case 'open': this.pickFile('open'); break;
      case 'import': this.pickFile('import'); break;
      case 'save': this.save(false); break;
      case 'saveas': this.save(true); break;
      case 'newfrom': this.pickFile('base'); break;
      case 'dxfout': this.exportDxfFile(); break;
      case 'print': this.openPrint(); break;
      case 'layer': $('layers-panel').scrollIntoView({ behavior: 'smooth' }); $('layers-panel').classList.add('flash'); setTimeout(() => $('layers-panel').classList.remove('flash'), 800); break;
      case 'properties': $('props-panel').classList.add('flash'); setTimeout(() => $('props-panel').classList.remove('flash'), 800); break;
      case 'settings': settingsDialog(doc, this.snapSt, (s, convert) => {
        const from = doc.settings.units, to = s.units;
        if (doc.editing && to !== from) {
          this.msg('Durante la modifica di un blocco le unità non si cambiano: prima CHIUDIBLOCCO. Le altre impostazioni sono state salvate.');
          s.units = from;
        }
        const converting = convert && s.units !== from;
        doc.edit(converting ? 'Cambio unità' : 'Impostazioni', () => {
          // i valori della finestra sono ancora nell'unità di prima: si convertono insieme al disegno
          doc.settings = converting ? { ...s, units: from } : s;
          if (converting) doc.convertUnits(to);
        });
        if (to !== from) {
          this.printWin = null;
          this.zoomExtents();
          this.msg(converting
            ? `Unità cambiate da ${UNIT_LABEL[from]} a ${UNIT_LABEL[to]}: disegno convertito, le misure reali sono le stesse.`
            : `Unità cambiate da ${UNIT_LABEL[from]} a ${UNIT_LABEL[to]} senza convertire: i numeri sono gli stessi, le misure reali no.`);
        }
        this.updateStatus();
      }); break;
      case 'help': helpDialog(); break;
      case 'purge': purgeBlocks(this); break;
      case 'layunisolate': layerAction(this, 'unisolate'); break;
      case 'layallon': layerAction(this, 'allon'); break;
    }
  }

  private pruneSelection() {
    const ids = new Set(this.doc.ents.map(e => e.id));
    this.setSelection([...this.selection].filter(i => ids.has(i)));
  }

  /** Menu sopra un pulsante della barra di stato: tipi di snap, passo dello snap e della griglia, angolo polare. */
  private statusMenu(what: 'grid' | 'snap' | 'polar' | 'osnap', anchor: HTMLElement) {
    document.querySelector('.st-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'st-pop';
    const s = this.snapSt, doc = this.doc;
    const close = () => { pop.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', key, true); this.input.focus(); };
    const out = (e: MouseEvent) => { if (!pop.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); close(); }
    };
    const head = (t: string) => { const d = document.createElement('div'); d.className = 'st-pop-head'; d.textContent = t; pop.append(d); };
    const redraw = () => { this.baseDirty = true; this.updateStatus(); this.updateCursor(); this.schedule(); };
    // passo scritto a mano, con la virgola o il punto; vale subito
    const step = (label: string, k: 'grid' | 'snap', turnOn: () => void) => {
      const row = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'text';
      i.value = fmtLen(doc.settings[k]);
      const apply = () => {
        const n = parseFloat(i.value.replace(',', '.'));
        if (!Number.isFinite(n) || n <= 0 || n === doc.settings[k]) { i.value = fmtLen(doc.settings[k]); return; }
        doc.edit(label, () => { doc.settings = { ...doc.settings, [k]: n }; });
        turnOn();
        this.msg(`${label}: ${fmtLen(n)} ${doc.settings.units}`);
        redraw();
      };
      i.onchange = apply;
      row.append(`${label} (${doc.settings.units}) `, i);
      pop.append(row);
      const quick = document.createElement('div');
      quick.className = 'st-pop-quick';
      const mm = UNIT_MM[doc.settings.units];
      for (const v of [1, 5, 10, 50, 100, 500].map(x => x / mm)) { // 1 mm … 50 cm
        const q = document.createElement('button');
        q.textContent = fmtLen(v);
        q.onclick = () => { i.value = fmtLen(v); apply(); };
        quick.append(q);
      }
      pop.append(quick);
      setTimeout(() => i.select(), 0);
    };
    if (what === 'osnap') {
      head('Snap ad oggetto (F3)');
      const kinds: SnapKind[] = ['end', 'mid', 'cen', 'quad', 'int', 'perp', 'ins', 'near'];
      const boxes: HTMLInputElement[] = [];
      for (const k of kinds) {
        const row = document.createElement('label');
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.checked = s.modes.has(k);
        c.onchange = () => { if (c.checked) { s.modes.add(k); s.osnap = true; } else s.modes.delete(k); redraw(); };
        boxes.push(c);
        row.append(c, ` ${SNAP_LABEL[k]}`);
        pop.append(row);
      }
      const quick = document.createElement('div');
      quick.className = 'st-pop-quick';
      for (const [label, on] of [['Tutti', true], ['Nessuno', false]] as [string, boolean][]) {
        const q = document.createElement('button');
        q.textContent = label;
        q.onclick = () => { s.modes = new Set(on ? kinds : []); boxes.forEach(c => { c.checked = on; }); if (on) s.osnap = true; redraw(); };
        quick.append(q);
      }
      pop.append(quick);
    } else if (what === 'snap') {
      head('Incremento del cursore (F9)');
      step('Passo dello snap', 'snap', () => { s.gridSnap = true; });
      const note = document.createElement('small');
      note.textContent = 'Con SNAP acceso il cursore si muove solo a multipli del passo.';
      pop.append(note);
    } else if (what === 'grid') {
      head('Griglia (F7)');
      step('Passo della griglia', 'grid', () => { this.gridOn = true; });
    } else {
      head('Puntamento polare (F10)');
      for (const a of [5, 10, 15, 22.5, 30, 45, 90]) {
        const row = document.createElement('label');
        const c = document.createElement('input');
        c.type = 'radio';
        c.name = 'st-polar';
        c.checked = s.polarInc === a;
        c.onchange = () => { s.polarInc = a; s.polar = true; s.ortho = false; redraw(); };
        row.append(c, ` ogni ${String(a).replace('.', ',')}°`);
        pop.append(row);
      }
    }
    document.body.append(pop);
    const r = anchor.getBoundingClientRect(), p = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - p.width - 4))}px`;
    pop.style.top = `${Math.max(4, r.top - p.height - 4)}px`;
    // i tasti valgono da subito; il clic fuori solo dal prossimo, perché quello che ha aperto il menu è ancora in corso
    document.addEventListener('keydown', key, true);
    setTimeout(() => document.addEventListener('mousedown', out, true), 0);
  }

  private toggle(what: 'osnap' | 'grid' | 'ortho' | 'snap' | 'polar' | 'lwt' | 'otrack') {
    const s = this.snapSt;
    let on = false;
    if (what === 'osnap') on = s.osnap = !s.osnap;
    else if (what === 'grid') { on = this.gridOn = !this.gridOn; this.baseDirty = true; }
    else if (what === 'ortho') { on = s.ortho = !s.ortho; if (on) s.polar = false; }
    else if (what === 'polar') { on = s.polar = !s.polar; if (on) s.ortho = false; }
    else if (what === 'snap') on = s.gridSnap = !s.gridSnap;
    else if (what === 'otrack') { on = s.otrack = !s.otrack; this.acquired = []; }
    else { on = this.lwt = !this.lwt; this.baseDirty = true; }
    const names = { osnap: 'Snap ad oggetto', grid: 'Griglia', ortho: 'Orto', snap: 'Snap griglia', polar: 'Polare', lwt: 'Spessori', otrack: 'Puntamento snap' };
    this.msg(`<${names[what]} ${on ? 'attivato' : 'disattivato'}>`);
    this.updateStatus();
    this.updateCursor();
    this.schedule();
  }

  // ================================================================ barre

  private buildToolbar() {
    const bar = $('toolbar');
    const groups: [string, [string, string, string][]][] = [
      ['File', [['new', 'NEW', 'Nuovo (Ctrl+N)'], ['newfrom', 'NEWFROM', 'Nuovo da un file base: lo apre come copia senza nome, il file base resta com\'è (NUOVODA)'], ['open', 'OPEN', 'Apri disegno, DXF o DWG (Ctrl+O)'], ['save', 'SAVE', 'Salva sullo stesso file (Ctrl+S)'], ['saveas', 'SAVEAS', 'Salva con nome: in un file nuovo (Ctrl+Maiusc+S)'], ['import', 'IMPORT', 'Importa DXF/DWG nel disegno'], ['export', 'DXFOUT', 'Esporta DXF'], ['print', 'PRINT', 'Stampa (Ctrl+P)']]],
      ['', [['undo', 'UNDO', 'Annulla (Ctrl+Z)'], ['redo', 'REDO', 'Ripristina (Ctrl+Y)']]],
      ['Disegno', [['line', 'LINE', 'Linea (L)'], ['pline', 'PLINE', 'Polilinea (PL)'], ['rect', 'RECTANGLE', 'Rettangolo (REC)'], ['circle', 'CIRCLE', 'Cerchio (C)'], ['arc', 'ARC', 'Arco (A)'], ['polygon', 'POLYGON', 'Poligono (POL)'], ['ellipse', 'ELLIPSE', 'Ellisse (EL)'], ['spline', 'SPLINE', 'Spline (SPL)'], ['point', 'POINT', 'Punto (PUNTO)'], ['text', 'TEXT', 'Testo (T)'], ['hatch', 'HATCH', 'Tratteggio e retini (H)'], ['image', 'IMAGE', 'Inserisci immagine JPG o PNG (IMMAGINE)']]],
      ['Planimetria', [['wall', 'WALL', 'Muro (MURO)'], ['door', 'DOOR', 'Porta (PORTA)'], ['window', 'WINDOW', 'Finestra (FINESTRA)'], ['room', 'ROOM', 'Locale con superficie (LOCALE)']]],
      ['Quote', [['dimlin', 'DIMLINEAR', 'Quota lineare (DLI)'], ['dimali', 'DIMALIGNED', 'Quota allineata (DAL)'], ['dimcont', 'DIMCONTINUE', 'Quota continua (DCO)'], ['dimrad', 'DIMRADIUS', 'Quota raggio (DRA)'], ['dimdia', 'DIMDIAMETER', 'Quota diametro (DDI)'], ['dimbase', 'DIMBASELINE', 'Quota dalla linea di base (DBA)'], ['dimang', 'DIMANGULAR', 'Quota angolare (DAN)'], ['leader', 'LEADER', 'Direttrice con testo (LE)']]],
      ['Blocchi', [['block', 'BLOCK', 'Crea blocco dalla selezione (B)'], ['insert', 'INSERT', 'Inserisci blocco (I)'], ['bedit', 'BEDIT', 'Modifica blocco sul posto (BE); per finire CHIUDIBLOCCO']]],
      ['Modifica', [['move', 'MOVE', 'Sposta (M)'], ['copy', 'COPY', 'Copia (CO)'], ['rotate', 'ROTATE', 'Ruota (RO)'], ['mirror', 'MIRROR', 'Specchio (MI)'], ['scale', 'SCALE', 'Scala (SC)'], ['offset', 'OFFSET', 'Offset (O)'], ['trim', 'TRIM', 'Taglia (TR)'], ['extend', 'EXTEND', 'Estendi (EX)'], ['fillet', 'FILLET', 'Raccorda (F)'], ['chamfer', 'CHAMFER', 'Smusso (CHA)'], ['array', 'ARRAY', 'Serie (AR)'], ['break', 'BREAK', 'Spezza (BR)'], ['lengthen', 'LENGTHEN', 'Allunga o accorcia (LEN)'], ['divide', 'DIVIDE', 'Dividi in parti uguali (DIV)'], ['pedit', 'PEDIT', 'Modifica polilinea (PE)'], ['stretch', 'STRETCH', 'Stira (S)'], ['join', 'JOIN', 'Unisci (J)'], ['explode', 'EXPLODE', 'Esplodi (X)'], ['matchprop', 'MATCHPROP', 'Copia proprietà: layer, colore, stile di quote e testi (MA)'], ['erase', 'ERASE', 'Cancella (E, Canc)']]],
      ['Vista', [['zoomext', 'ZOOMEXTENTS', 'Zoom estensioni (ZE, doppio clic rotella)'], ['zoomwin', 'ZOOM', 'Zoom (Z)'], ['pan', 'PAN', 'Pan (P)'], ['dist', 'DIST', 'Distanza (DI)'], ['area', 'AREA', 'Area (AA): per vertici, clic dentro un\'area chiusa, o di un oggetto']]],
      ['', [['settings', 'SETTINGS', 'Impostazioni (DS)'], ['help', 'HELP', 'Comandi e scorciatoie (F1)']]],
    ];
    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.innerHTML = `${logo(24)}<span>Kalista</span><small>v${VERSION}</small>`;
    brand.title = VERSION_LONG;
    bar.append(brand);
    for (const [title, btns] of groups) {
      const g = document.createElement('div');
      g.className = 'tb-group';
      if (title) g.dataset.title = title;
      for (const [ic, cmd, tip] of btns) {
        const b = document.createElement('button');
        b.className = 'tb-btn';
        b.title = tip;
        b.innerHTML = icon(ic);
        b.onclick = () => { this.msg(`Comando: _${cmd}`); this.run(cmd); this.input.focus(); };
        g.append(b);
      }
      bar.append(g);
    }
    void COMMANDS;
  }

  private buildStatus() {
    const st = $('status');
    st.innerHTML = `<span id="coords" class="coords"></span><span class="spacer"></span>`;
    const toggles: [string, string, 'grid' | 'snap' | 'ortho' | 'polar' | 'osnap' | 'lwt' | 'otrack'][] = [
      ['GRIGLIA', 'F7', 'grid'], ['SNAP', 'F9', 'snap'], ['ORTO', 'F8', 'ortho'], ['POLARE', 'F10', 'polar'], ['ESNAP', 'F3', 'osnap'], ['PUNTAMENTO', 'F11', 'otrack'], ['SPESSORI', '', 'lwt'],
    ];
    for (const [label, key, what] of toggles) {
      const b = document.createElement('button');
      b.className = 'st-btn';
      b.id = `st-${what}`;
      b.textContent = label;
      b.title = key ? `${label} (${key})` : label;
      b.onclick = () => { this.toggle(what); this.input.focus(); };
      st.append(b);
      // opzioni del pulsante: freccetta accanto, o clic destro sul pulsante
      if (what === 'grid' || what === 'snap' || what === 'polar' || what === 'osnap') {
        b.title += ' — clic destro per le opzioni';
        const more = document.createElement('button');
        more.className = 'st-more';
        more.id = `st-${what}-more`;
        more.textContent = '▾';
        more.title = `Opzioni di ${label}`;
        more.onclick = () => this.statusMenu(what, b);
        b.oncontextmenu = e => { e.preventDefault(); this.statusMenu(what, b); };
        st.append(more);
      }
    }
    const info = document.createElement('span');
    info.id = 'st-info';
    info.className = 'st-info';
    info.title = 'Clic per le impostazioni';
    info.onclick = () => this.run('SETTINGS');
    st.append(info);
    this.updateStatus();
  }

  private updateStatus() {
    const s = this.snapSt;
    const on: Record<string, boolean> = { grid: this.gridOn, snap: s.gridSnap, ortho: s.ortho, polar: s.polar, osnap: s.osnap, lwt: this.lwt, otrack: s.otrack };
    for (const [k, val] of Object.entries(on)) $(`st-${k}`)?.classList.toggle('on', val);
    const info = $('st-info');
    const ed = this.doc.editing;
    if (info) {
      info.textContent = `${ed ? `MODIFICA DEL BLOCCO "${ed.name}" (CHIUDIBLOCCO per finire) · ` : ''}${UNIT_LABEL[this.doc.settings.units]} · layer ${this.doc.current}`;
      info.classList.toggle('editing', !!ed);
    }
    document.title = `${this.fileName}${ed ? ` [blocco ${ed.name}]` : ''}${this.doc.dirty ? ' *' : ''} – Kalista`;
  }

  private updateCoords() {
    const el = $('coords');
    if (!el) return;
    const p = this.snap?.p ?? this.cursor;
    el.textContent = `${fmtLen(Math.round(p.x * 100) / 100)} ; ${fmtLen(Math.round(p.y * 100) / 100)}`;
  }

  private onDocChange() {
    for (const [name, n] of this.doc.hiddenAdds) this.msg(`Attenzione: ${n} entità create sul layer ${name}, che è nascosto: non si vedono finché non lo si riaccende (ACCENDILAYER).`);
    this.doc.hiddenAdds.clear();
    // l'entità sotto il mouse può essere stata cambiata (dal pannello, dal pennello): va ricercata, non ridisegnata vecchia
    this.hover = null;
    this.baseDirty = true;
    this.schedule();
    this.panels.refresh();
    this.updateStatus();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.autosaveNow(), 1500);
  }

  // ================================================================ file

  private autosaveNow() {
    try {
      const data = JSON.stringify({ name: this.fileName, doc: this.doc.toData() });
      if (data.length < 4_500_000) { localStorage.setItem(AUTOSAVE_KEY, data); return; }
    } catch { /* spazio esaurito o archiviazione non disponibile */ }
    // Non si è potuto salvare: via anche la copia vecchia, che al prossimo avvio verrebbe ripristinata
    // come se fosse questo disegno.
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* archiviazione non disponibile */ }
    if (!this.autosaveWarned) {
      this.autosaveWarned = true;
      this.msg('Attenzione: il disegno è troppo grande per il salvataggio automatico nel browser. Salvarlo su file con Ctrl+S.');
    }
  }
  private autosaveWarned = false;

  private restore(): boolean {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw) as { name: string; doc: DocData };
      if (!d.doc?.ents?.length && !Object.values(d.doc?.cartiglio ?? {}).some(Boolean)) return false;
      this.doc.load(d.doc);
      this.doc.dirty = true;
      this.fileName = d.name || 'Senza nome';
      this.msg(`Ripristinato il disegno della sessione precedente (${d.doc.ents.length} entità). Salvarlo con Ctrl+S per tenerne una copia su file.`);
      return true;
    } catch {
      return false;
    }
  }

  private async newDoc() {
    if (this.doc.dirty && this.hasWork() && !(await confirmBox('Nuovo disegno', 'Il disegno corrente ha modifiche non salvate. Continuare e perderle?'))) return;
    this.doc.reset(this.doc.settings.units);
    this.fileHandle = null;
    this.fileName = 'Senza nome';
    this.setSelection([]);
    this.forgetDrawing();
    this.defaultView();
    this.updateStatus();
    this.msg('Nuovo disegno.');
  }

  /** base = nuovo disegno a partire da un file, che viene aperto come copia senza nome */
  /** c'è qualcosa da perdere: entità, o scritte del cartiglio */
  private hasWork() { return this.doc.ents.length > 0 || Object.values(this.doc.cartiglio).some(Boolean); }

  private pickMode: 'open' | 'import' | 'base' = 'open';

  private async pickFile(mode: 'open' | 'import' | 'base') {
    if (mode !== 'import' && this.doc.dirty && this.hasWork() && !(await confirmBox(mode === 'base' ? 'Nuovo da file base' : 'Apri', 'Il disegno corrente ha modifiche non salvate. Continuare e perderle?'))) return;
    this.pickMode = mode;
    const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileHandle[]> };
    if (mode === 'open' && w.showOpenFilePicker) {
      // con il selettore del browser resta il riferimento al file: Salva lo riscrive senza chiedere dove
      try {
        const [h] = await w.showOpenFilePicker({ types: [{ description: 'Disegni (Kalista, DXF, DWG)', accept: { 'application/json': ['.kalista', '.planim', '.json'], 'image/vnd.dxf': ['.dxf'], 'image/vnd.dwg': ['.dwg'] } }] });
        await this.openFile(await h.getFile(), h);
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        // selettore non disponibile in questo contesto: si passa a quello classico
      }
    }
    const inp = $<HTMLInputElement>('file-input');
    inp.accept = mode === 'import' ? '.dxf,.dwg' : '.kalista,.planim,.json,.dxf,.dwg';
    inp.value = '';
    inp.click();
  }

  private async onFilePicked(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) await this.openFile(f, null);
  }

  private async openFile(f: File, handle: FileHandle | null) {
    const base = this.pickMode === 'base';
    const ext = f.name.toLowerCase().split('.').pop() ?? '';
    try {
      const buf = await f.arrayBuffer();
      if (ext === 'kalista' || ext === 'planim' || ext === 'json') {
        const d = JSON.parse(new TextDecoder().decode(buf)) as DocData;
        this.setSelection([]);
        this.forgetDrawing();
        this.doc.load(d);
        // un file base si apre come copia senza nome: al primo Salva viene chiesto dove, e lui resta com'è
        this.fileHandle = base ? null : handle;
        this.fileName = base ? 'Senza nome' : f.name.replace(/\.(kalista|planim|json)$/i, '');
        this.selection.clear();
        this.msg(base
          ? `Nuovo disegno dal file base ${f.name} (${this.doc.ents.length} entità). Il file base non viene toccato: al primo Salva verrà chiesto il nome del nuovo file.`
          : `Aperto ${f.name}: ${this.doc.ents.length} entità.`);
        this.zoomExtents();
        this.updateStatus();
        return;
      }
      if (ext !== 'dxf' && ext !== 'dwg') { this.msg(`Formato non riconosciuto: .${ext}`); return; }
      this.msg(`Lettura di ${f.name}…`);
      const docUnits = this.doc.settings.units;
      let r = ext === 'dxf' ? importDxf(buf, docUnits) : await importDwg(buf, docUnits);
      const size = importSize(r);
      if (size) {
        const src = await importUnitsDialog(f.name, r.srcUnits, size, guessUnits(size, r.srcUnits, docUnits));
        if (!src) { this.msg(`Importazione di ${f.name} annullata.`); return; }
        r = rescaleImport(r, src, docUnits);
      }
      if (this.pickMode !== 'import') {
        this.setSelection([]);
        this.forgetDrawing();
        this.doc.reset(this.doc.settings.units);
        this.fileHandle = null;
        this.fileName = base ? 'Senza nome' : f.name.replace(/\.(dxf|dwg)$/i, '');
      }
      this.mergeImport(r, f.name);
      this.zoomExtents();
    } catch (err) {
      this.msg(`Errore nell'apertura di ${f.name}: ${(err as Error).message}`);
      console.warn(err);
    }
  }

  private mergeImport(r: ImportResult, name: string) {
    const doc = this.doc;
    const groups = new Map<number, number>();
    // blocchi del file: se nel disegno c'è già un blocco con quel nome ma diverso, quello importato cambia nome
    const rename = new Map<string, string>();
    for (const [k, d] of Object.entries(r.blocks)) {
      if (!doc.blocks[k] || JSON.stringify(doc.blocks[k]) === JSON.stringify(d)) continue;
      let i = 2;
      while (doc.blocks[`${k} (${i})`] || r.blocks[`${k} (${i})`]) i++;
      rename.set(k, `${k} (${i})`);
    }
    const ren = <E extends NewEnt | Ent>(e: E): E => (e.t === 'insert' && rename.has(e.name) ? { ...e, name: rename.get(e.name)! } : e);
    doc.edit(`Importa ${name}`, () => {
      for (const l of r.layers) if (!doc.layers.some(x => x.name === l.name)) doc.layers = [...doc.layers, l];
      const defs = Object.fromEntries(Object.entries(r.blocks).map(([k, d]) => [rename.get(k) ?? k, { ents: d.ents.map(ren) }]));
      if (Object.keys(defs).length) doc.blocks = { ...doc.blocks, ...defs };
      doc.addMany(r.ents.map(ren).map(e => {
        if (e.g === undefined) return e;
        if (!groups.has(e.g)) groups.set(e.g, doc.newGroupId());
        return { ...e, g: groups.get(e.g) };
      }));
    });
    const nb = Object.keys(r.blocks).length;
    if (nb) this.msg(`${nb} blocchi del file sono diventati blocchi di Kalista: si modificano con MODBLOCCO, si aprono con ESPLODI.`);
    const units = r.srcUnits ? `misure del file lette in ${UNIT_LABEL[r.srcUnits]}` : 'unità non dichiarate';
    this.msg(`${r.ents.length} entità importate da ${name} (${units}${r.scale !== 1 ? `, scalate ×${fmtLen(r.scale)} in ${UNIT_LABEL[doc.settings.units]}` : ''}).`);
    if (r.skipped.size) this.msg(`Non importati: ${[...r.skipped].map(([k, n]) => `${k} (${n})`).join(', ')}.`);
    for (const w of r.warnings) this.msg(`Attenzione: ${w}`);
    if (!r.ents.length) this.msg('Il file non contiene entità nello spazio modello.');
  }

  private async save(as: boolean) {
    const data = JSON.stringify(this.doc.toData());
    const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileHandle> };
    // a un disegno ancora senza nome si propone quello del cliente scritto nel cartiglio
    const client = this.doc.cartiglio.cliente.split('\n')[0].replace(/[\\/:*?"<>|]/g, ' ').trim().replace(/[. ]+$/, '');
    const suggested = this.fileName === 'Senza nome' && client ? client : this.fileName;
    try {
      if (!as && this.fileHandle) {
        await this.writeHandle(this.fileHandle, data);
      } else if (w.showSaveFilePicker) {
        const h = await w.showSaveFilePicker({ suggestedName: `${suggested}.kalista`, types: [{ description: 'Disegno Kalista', accept: { 'application/json': ['.kalista'] } }] });
        await this.writeHandle(h, data);
        this.fileHandle = h;
        this.fileName = (h.name as string).replace(/\.(kalista|planim)$/i, '');
      } else {
        const name = as || this.fileName === 'Senza nome' ? await askText('Salva', 'Nome del file', suggested) : this.fileName;
        if (!name) return;
        this.fileName = name.replace(/\.(kalista|planim)$/i, '');
        this.download(`${this.fileName}.kalista`, data, 'application/json');
      }
      this.doc.dirty = false;
      this.updateStatus();
      this.msg(`Salvato ${this.fileName}.kalista`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.msg(`Salvataggio non riuscito: ${(err as Error).message}`);
    }
  }

  private async writeHandle(h: FileHandle, data: string) {
    const ws = await h.createWritable();
    await ws.write(data);
    await ws.close();
  }

  private download(name: string, data: string, type: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  private async exportDxfFile() {
    const txt = exportDxf(this.doc);
    const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileHandle> };
    try {
      if (w.showSaveFilePicker) {
        const h = await w.showSaveFilePicker({ suggestedName: `${this.fileName}.dxf`, types: [{ description: 'DXF', accept: { 'image/vnd.dxf': ['.dxf'] } }] });
        await this.writeHandle(h, txt);
      } else this.download(`${this.fileName}.dxf`, txt, 'image/vnd.dxf');
      const data = this.doc.toData();
      this.msg(`Esportato DXF (R12): ${data.ents.length} entità.`);
      const lost = flatEnts(data.ents, data.blocks ?? {}).filter(e => e.t === 'image').length;
      if (lost) this.msg(`Attenzione: ${lost} immagini non sono nel DXF, che non le prevede.`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.msg(`Esportazione non riuscita: ${(err as Error).message}`);
    }
  }

  private finishPrintWindow(world: Vec) {
    const b = boxOf(this.printWinStart!, world);
    if (b.x1 - b.x0 < 1e-9 || b.y1 - b.y0 < 1e-9) { this.msg('Finestra senza area: specificare l\'angolo opposto.'); return; }
    this.printWin = b;
    this.printWinStart = null;
    this.pickingPrintWindow = false;
    this.schedule();
    this.openPrint(true);
  }

  private openPrint(winNew = false) {
    // oggetti selezionati: si possono stampare da soli
    const ctx = this.doc.ctx();
    let sel: { box: Box; ids: Set<number> } | null = null;
    for (const id of this.selection) {
      const e = this.doc.byId(id);
      if (!e) continue;
      const b = entBox(e, ctx);
      if (!sel) sel = { box: b, ids: new Set([id]) }; else { sel.box = boxUnion(sel.box, b); sel.ids.add(id); }
    }
    printDialog(this.doc, { ext: this.doc.extents(), view: this.view.visibleBox(), win: this.printWin, winNew, sel }, () => {
      this.pickingPrintWindow = true;
      this.printWinStart = null;
      this.msg('STAMPA: specificare il primo angolo della finestra da stampare (Esc per annullare).');
    });
  }
}
