// Blocchi: gruppi di entità con un nome, definiti una volta e inseriti quante volte serve.
import type { Ent, NewEnt, Blocks } from '../model/entities';
import { transform, blockUses, prims } from '../model/entities';
import { Vec, v, translate } from '../model/geom';
import { Tool, SelTool, O, parseNum, parseAngle, fmtLen } from './base';

/** Nome del blocco come è scritto nel disegno, cercato senza badare a maiuscole e minuscole. */
export function findBlockName(blocks: Blocks, s: string): string | undefined {
  const k = s.trim().toLowerCase();
  return Object.keys(blocks).find(n => n.toLowerCase() === k);
}

export const usesBlock = blockUses;

// ---------------------------------------------------------------- BLOCCO

/**
 * Crea un blocco dalla selezione e la sostituisce con un suo inserimento. Dando il nome di un
 * blocco che esiste già lo si ridefinisce: è il modo di modificare un blocco (ESPLODI un
 * inserimento, correggere, BLOCCO con lo stesso nome) e cambiano tutti i suoi inserimenti.
 */
export class BlockTool extends SelTool {
  readonly name = 'BLOCCO';
  private blockName = '';
  private confirming = false;

  afterSelect() { this.askName(); }

  private askName() {
    this.confirming = false;
    this.ask('Nome del blocco', [], undefined, 'text');
  }

  private askBase() {
    this.confirming = false;
    this.ask('Specificare il punto base del blocco');
  }

  text(raw: string): boolean {
    if (this.mode !== 'text') return false;
    const s = raw.trim();
    if (!s) { this.h.msg('Blocco non creato.'); this.finish(); return true; }
    const blocks = this.h.doc.blocks;
    const existing = findBlockName(blocks, s);
    this.blockName = existing ?? s;
    if (usesBlock(this.sel, this.blockName, blocks)) {
      this.h.msg(`La selezione contiene il blocco "${this.blockName}": un blocco non può contenere se stesso.`);
      this.askName();
      return true;
    }
    if (existing) {
      this.confirming = true;
      this.askYesNo(`Il blocco "${existing}" esiste già: ridefinirlo? Cambieranno tutti i suoi inserimenti`, 'N');
    } else this.askBase();
    return true;
  }

  option(k: string) {
    if (!this.confirming) return;
    if (k === 'S') this.askBase(); else this.askName();
  }

  enter() {
    if (this.confirming) this.askName(); else this.finish();
  }

  point(p: Vec) {
    const doc = this.h.doc;
    const name = this.blockName;
    const m = translate(-p.x, -p.y);
    const ents = this.sel.map(e => { const { g: _g, ...rest } = transform(e, m); return rest as Ent; });
    doc.edit('Blocco', () => {
      doc.blocks = { ...doc.blocks, [name]: { ents } };
      doc.remove(this.selIds);
      this.h.setSelection([doc.add({ t: 'insert', name, p, s: 1, rot: 0, layer: doc.current }).id]);
    });
    this.h.msg(`Blocco "${name}" creato con ${ents.length} entità. Per metterne altre copie: INSERISCI.`);
    this.h.done();
  }

  private finish() { this.h.setSelection([]); this.h.done(); }
}

// ---------------------------------------------------------------- MODBLOCCO / CHIUDIBLOCCO

/** Apre un blocco per modificarlo sul posto: il disegno mostra solo il suo contenuto fino a CHIUDIBLOCCO. */
export class BlockEditTool extends Tool {
  readonly name = 'MODBLOCCO';

  start() {
    const doc = this.h.doc;
    if (doc.editing) { this.h.msg(`Si sta già modificando il blocco "${doc.editing.name}": prima CHIUDIBLOCCO.`); this.h.done(); return; }
    const names = Object.keys(doc.blocks).sort();
    if (!names.length) { this.h.msg('Nessun blocco in questo disegno.'); this.h.done(); return; }
    const sel = doc.ents.filter(e => this.h.selection.has(e.id));
    if (sel.length === 1 && sel[0].t === 'insert' && doc.blocks[sel[0].name]) { this.open(sel[0].name); return; }
    this.ask('Nome del blocco da modificare (o selezionarne un inserimento prima del comando)', names.map(n => O(n, n)), names.length === 1 ? names[0] : undefined, 'text');
  }

  text(raw: string): boolean {
    if (this.mode !== 'text') return false;
    const s = raw.trim() || this.def || '';
    if (!s) { this.h.done(); return true; }
    const name = findBlockName(this.h.doc.blocks, s);
    if (!name) { this.h.msg(`Blocco "${s}" non trovato.`); return true; }
    this.open(name);
    return true;
  }

  option(k: string) { if (this.mode === 'text') this.text(k); }

  private open(name: string) {
    this.h.setSelection([]);
    this.h.doc.beginBlockEdit(name);
    this.h.done();
    this.h.zoomExtents();
    this.h.msg(`Modifica del blocco "${name}": il disegno mostra solo il suo contenuto, con il punto base in 0,0. Per finire: CHIUDIBLOCCO.`);
  }
}

export class BlockCloseTool extends Tool {
  readonly name = 'CHIUDIBLOCCO';

  start() {
    if (!this.h.doc.editing) { this.h.msg('Nessun blocco in modifica.'); this.h.done(); return; }
    this.askYesNo(`Salvare le modifiche al blocco "${this.h.doc.editing.name}"?`, 'S');
  }

  option(k: string) { this.close(k === 'S'); }
  enter() { this.close(true); }

  private close(save: boolean) {
    const name = this.h.doc.editing?.name;
    this.h.setSelection([]);
    const dropped = this.h.doc.endBlockEdit(save);
    this.h.done();
    this.h.zoomExtents();
    this.h.msg(save ? `Blocco "${name}" aggiornato: cambiano tutti i suoi inserimenti.` : `Modifiche al blocco "${name}" scartate.`);
    if (save && dropped) this.h.msg(`Tolti ${dropped} inserimenti del blocco dentro se stesso: un blocco non può contenersi.`);
  }
}

// ---------------------------------------------------------------- RINOMINABLOCCO / ELIMINABLOCCHI

export class BlockRenameTool extends Tool {
  readonly name = 'RINOMINABLOCCO';
  private old = '';

  start() {
    const names = Object.keys(this.h.doc.blocks).sort();
    if (!names.length) { this.h.msg('Nessun blocco in questo disegno.'); this.h.done(); return; }
    this.ask('Nome del blocco da rinominare', names.map(n => O(n, n)), undefined, 'text');
  }

  text(raw: string): boolean {
    if (this.mode !== 'text') return false;
    const s = raw.trim();
    if (!s) { this.h.done(); return true; }
    const blocks = this.h.doc.blocks;
    if (!this.old) {
      const name = findBlockName(blocks, s);
      if (!name) { this.h.msg(`Blocco "${s}" non trovato.`); return true; }
      this.old = name;
      this.ask(`Nuovo nome per "${name}"`, [], undefined, 'text');
      return true;
    }
    const clash = findBlockName(blocks, s);
    if (clash && clash !== this.old) { this.h.msg(`Esiste già un blocco "${clash}".`); return true; }
    const old = this.old;
    this.h.doc.edit('Rinomina blocco', () => this.h.doc.renameBlock(old, s));
    if (this.h.doc.editing?.name === old) this.h.doc.editing.name = s;
    this.h.msg(`Blocco "${old}" rinominato in "${s}".`);
    this.h.done();
    return true;
  }

  option(k: string) { if (this.mode === 'text' && !this.old) this.text(k); }
}

/** Toglie dal disegno le definizioni dei blocchi che nessun inserimento usa. */
export function purgeBlocks(h: { doc: Tool['h']['doc']; msg(s: string): void }) {
  const doc = h.doc;
  const unused = doc.unusedBlocks();
  if (!unused.length) { h.msg('Nessun blocco inutilizzato.'); return; }
  doc.edit('Elimina blocchi inutilizzati', () => {
    doc.blocks = Object.fromEntries(Object.entries(doc.blocks).filter(([k]) => !unused.includes(k)));
  });
  h.msg(`Eliminati ${unused.length} blocchi non usati: ${unused.join(', ')}.`);
}

// ---------------------------------------------------------------- INSERISCI

export class InsertTool extends Tool {
  readonly name = 'INSERISCI';
  static last = '';
  private blockName = '';
  private s = 1;
  private rot = 0;
  private asking: 's' | 'r' | null = null;

  private names(): string[] { return Object.keys(this.h.doc.blocks).sort(); }

  start() {
    const names = this.names();
    if (!names.length) {
      this.h.msg('Nessun blocco in questo disegno. Per crearne uno: selezionare le entità e usare BLOCCO.');
      this.h.done();
      return;
    }
    const def = names.includes(InsertTool.last) ? InsertTool.last : names.length === 1 ? names[0] : undefined;
    const ctx = this.h.doc.ctx();
    this.withForm({
      title: 'Inserisci blocco',
      fields: [
        {
          k: 'tiles', key: 'name', label: 'Blocco', value: def ?? names[0],
          tiles: names.map(n => ({ value: n, label: n, prims: prims({ id: 0, layer: '0', t: 'insert', name: n, p: v(0, 0), s: 1, rot: 0 }, ctx) })),
        },
        { k: 'num', key: 's', label: 'Scala', value: this.s },
        { k: 'num', key: 'rot', label: 'Rotazione', unit: '°', value: Math.round(((this.rot * 180) / Math.PI) * 1000) / 1000, free: true },
      ],
    }, r => {
      if (!r) { this.ask('Nome del blocco da inserire', names.map(n => O(n, n)), def, 'text'); return; }
      this.blockName = InsertTool.last = r.name as string;
      this.s = r.s as number;
      this.rot = ((r.rot as number) * Math.PI) / 180;
      this.askPoint();
    });
  }

  private askPoint() {
    this.asking = null;
    const deg = fmtLen((this.rot * 180) / Math.PI);
    this.ask(`Specificare punto di inserimento di "${this.blockName}" (scala ${fmtLen(this.s)}, rotazione ${deg}°) o`, [O('S', 'Scala'), O('R', 'Ruota')]);
  }

  text(raw: string): boolean {
    if (this.mode === 'text') {
      const s = raw.trim() || this.def || '';
      if (!s) { this.h.done(); return true; }
      const name = findBlockName(this.h.doc.blocks, s);
      if (!name) { this.h.msg(`Blocco "${s}" non trovato. Disponibili: ${this.names().join(', ')}.`); return true; }
      this.blockName = name;
      InsertTool.last = name;
      this.askPoint();
      return true;
    }
    if (this.asking === 's') {
      const n = parseNum(raw);
      if (n === null || n <= 0) return false;
      this.s = n;
    } else if (this.asking === 'r') {
      const a = parseAngle(raw);
      if (a === null) return false;
      this.rot = a;
    } else return false;
    this.askPoint();
    return true;
  }

  option(k: string) {
    if (this.mode === 'text') { this.text(k); return; } // clic sul nome di un blocco nell'elenco
    if (k === 'S') { this.asking = 's'; this.ask('Specificare la scala del blocco', [], fmtLen(this.s), 'none'); }
    else if (k === 'R') { this.asking = 'r'; this.ask('Specificare la rotazione in gradi', [], fmtLen((this.rot * 180) / Math.PI), 'none'); }
  }

  enter() {
    if (this.asking) this.askPoint(); else this.h.done();
  }

  private make(p: Vec): NewEnt {
    return { t: 'insert', name: this.blockName, p, s: this.s, rot: this.rot, layer: this.h.doc.current };
  }

  point(p: Vec) {
    if (!this.blockName) return;
    this.h.doc.edit('Inserisci blocco', () => { this.h.doc.add(this.make(p)); });
    this.h.done();
  }

  ghosts(p: Vec): NewEnt[] {
    return this.blockName && this.mode === 'point' ? [this.make(p)] : [];
  }
}
