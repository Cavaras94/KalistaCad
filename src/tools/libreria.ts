// LIBRERIA: sanitari e arredi pronti, da mettere nel disegno come blocchi (con il loro 3D).
import type { Ent, NewEnt } from '../model/entities';
import { prims, transform } from '../model/entities';
import { UNIT_MM } from '../model/document';
import { Vec, v, compose, translate, rotateAbout, scaleAbout } from '../model/geom';
import { Tool, O, fmtLen } from './base';
import { LIBRARY, type LibItem } from '../library/arredi';

/** Disegno di un oggetto della libreria, per sceglierlo in una finestra. */
export function libraryTiles() {
  return LIBRARY.map(it => ({ value: it.key, label: it.name, prims: it.ents.flatMap((e, i) => prims({ ...e, id: i + 1 } as Ent)) }));
}

export class LibraryTool extends Tool {
  readonly name = 'LIBRERIA';
  static lastKey = LIBRARY[0].key;
  static rot = 0;
  private item: LibItem | null = null;
  /** contenuto del blocco già nelle unità del disegno */
  private ents: Ent[] = [];
  private placed = 0;

  start() {
    this.ask('Sanitari e arredi: scegliere nella finestra (Invio = OK, Esc = annulla)', [], undefined, 'none');
    void this.h.form({
      title: 'Sanitari e arredi',
      note: 'Si mettono come blocchi, sul layer ARREDI, e nella vista 3D hanno la loro altezza. Il punto da indicare è il centro del lato che va contro il muro: con lo snap Medio sul filo del muro si appoggiano nel mezzo.',
      fields: [
        { k: 'tiles', key: 'item', label: 'Oggetto', value: LibraryTool.lastKey, tiles: libraryTiles() },
        { k: 'choice', key: 'rot', label: 'Rotazione', value: String(LibraryTool.rot), options: [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']] },
      ],
    }).then(val => {
      if (!this.h.isCurrent(this)) return;
      if (!val) { this.h.msg('*Annullato*'); this.h.done(); return; }
      this.item = LIBRARY.find(it => it.key === val.item) ?? LIBRARY[0];
      LibraryTool.lastKey = this.item.key;
      LibraryTool.rot = Number(val.rot) || 0;
      // dai centimetri della libreria alle unità del disegno
      const f = 10 / UNIT_MM[this.h.doc.settings.units];
      this.ents = this.item.ents.map((e, i) => transform({ ...e, id: i + 1 } as Ent, scaleAbout(v(0, 0), f)));
      this.askPoint();
    });
  }

  private askPoint() {
    this.ask(`Specificare il punto per "${this.item!.name}" (centro del lato contro il muro, rotazione ${fmtLen(LibraryTool.rot)}°; Invio per finire) o`, [O('R', 'Ruota di 90°')]);
  }

  option(k: string) {
    if (k !== 'R' || !this.item) return;
    LibraryTool.rot = (LibraryTool.rot + 90) % 360;
    this.askPoint();
  }

  point(p: Vec) {
    if (!this.item) return;
    const doc = this.h.doc, name = this.item.name, ents = this.ents;
    doc.edit('Arredo', () => {
      doc.ensureLayer('ARREDI');
      // la definizione entra nel disegno la prima volta che lo si usa; se c'è già un blocco con quel nome, si usa quello
      if (!doc.blocks[name]) doc.blocks = { ...doc.blocks, [name]: { ents } };
      doc.add({ t: 'insert', name, p, s: 1, rot: (LibraryTool.rot * Math.PI) / 180, layer: 'ARREDI' });
    });
    this.placed++;
    this.askPoint();
  }

  enter() {
    if (this.placed) this.h.msg(`${this.placed} ${this.placed === 1 ? 'oggetto messo' : 'oggetti messi'}: sono blocchi, si spostano, ruotano e copiano come gli altri.`);
    this.h.done();
  }

  ghosts(p: Vec): NewEnt[] {
    if (!this.item || this.mode !== 'point') return [];
    const m = compose(translate(p.x, p.y), rotateAbout(v(0, 0), (LibraryTool.rot * Math.PI) / 180));
    return this.ents.map(e => { const { id: _id, ...r } = transform(e, m); return { ...r, layer: 'ARREDI' } as NewEnt; });
  }
}
