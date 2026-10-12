// Blocchi: gruppi di entità con un nome, definiti una volta e inseriti quante volte serve.
import type { Ent, NewEnt, Blocks } from '../model/entities';
import { transform } from '../model/entities';
import { Vec, translate } from '../model/geom';
import { Tool, SelTool, O, parseNum, parseAngle, fmtLen } from './base';

/** Nome del blocco come è scritto nel disegno, cercato senza badare a maiuscole e minuscole. */
export function findBlockName(blocks: Blocks, s: string): string | undefined {
  const k = s.trim().toLowerCase();
  return Object.keys(blocks).find(n => n.toLowerCase() === k);
}

/** Vero se fra le entità c'è, anche annidato, un inserimento del blocco name. */
export function usesBlock(ents: readonly Ent[], name: string, blocks: Blocks, depth = 0): boolean {
  return ents.some(e => e.t === 'insert' && (e.name === name || (depth < 8 && usesBlock(blocks[e.name]?.ents ?? [], name, blocks, depth + 1))));
}

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
      this.ask(`Il blocco "${existing}" esiste già: ridefinirlo? Cambieranno tutti i suoi inserimenti`, [O('S', 'Sì'), O('N', 'No')], 'N', 'none');
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
    this.ask('Nome del blocco da inserire', names.map(n => O(n, n)), def, 'text');
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
