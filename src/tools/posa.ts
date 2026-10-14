// PIASTRELLE: pavimento e rivestimento di un locale (posa, formato, fuga, colore, altezza), con il computo.
import type { Ent, RoomE, Tiles, TileLay, Prim, Cladding } from '../model/entities';
import { TILE_LAY_NAMES, floorJoints, fmtNum } from '../model/entities';
import { UNIT_MM } from '../model/document';
import { findRegion } from '../model/region';
import { roomComputo } from '../model/computo';
import { Vec, v, pointInPolygon, polygonArea } from '../model/geom';
import { Tool, type FormField } from './base';
import { RoomTool } from './plan';

/** Valori di partenza e ultimi usati, in centimetri (formato e altezza) e millimetri (fuga). */
const last = {
  floor: { on: true, lay: 'grid' as TileLay, l: 60, w: 60, j: 2, color: '#d8d0c4', box: 0 },
  clad: { on: false, lay: 'grid' as TileLay, l: 60, w: 30, j: 2, color: '#eef1f3', box: 0, hgt: 200 },
};

const SAMPLE = [v(0, 0), v(160, 0), v(160, 120), v(0, 120)];
/** Riquadri con il disegno di ogni posa, per sceglierla in una finestra. */
export function layTiles(): { value: string; label: string; prims: Prim[] }[] {
  return (Object.keys(TILE_LAY_NAMES) as TileLay[]).map(lay => ({
    value: lay, label: TILE_LAY_NAMES[lay],
    prims: [{ k: 'pl', pts: SAMPLE, closed: true } as Prim, ...floorJoints(SAMPLE, { l: 40, w: 20, j: 0, lay, color: '' }).map(p => (p.k === 'pl' ? { ...p, deco: false } : p))],
  }));
}

/** Descrizione breve di una posa: "60×30 spina di pesce, fuga 2 mm". */
export function describeTiles(t: Tiles, unitMm: number): string {
  const cm = (x: number) => fmtNum((x * unitMm) / 10, 1).replace(/,0$/, '');
  const mm = fmtNum(t.j * unitMm, 1).replace(/,0$/, '');
  return `${cm(t.l)}×${cm(t.w)} ${TILE_LAY_NAMES[t.lay].toLowerCase()}, fuga ${mm} mm`;
}

export class TilesTool extends Tool {
  readonly name = 'PIASTRELLE';

  start() {
    const sel = this.h.doc.ents.filter(e => this.h.selection.has(e.id) && e.t === 'room');
    if (sel.length === 1) { this.edit(sel[0] as RoomE); return; }
    this.ask('Fare clic dentro il locale (se il locale non c\'è ancora, viene creato)');
  }

  point(p: Vec) {
    const doc = this.h.doc;
    // il locale più piccolo che contiene il punto (un ripostiglio dentro un locale più grande)
    const rooms = doc.ents.filter((e): e is RoomE => e.t === 'room' && doc.isEditable(e) && pointInPolygon(p, e.pts))
      .sort((a, b) => Math.abs(polygonArea(a.pts)) - Math.abs(polygonArea(b.pts)));
    if (rooms.length) { this.edit(rooms[0]); return; }
    const vis = doc.ents.filter(e => doc.layer(e.layer).visible);
    const loop = findRegion(vis, doc.ctx(), p, doc.settings.wallTh * 30, doc.extents());
    if (!loop) { this.h.msg('Non trovo un contorno chiuso attorno al punto: prima LOCALE, oppure chiudere i muri.'); return; }
    this.edit({ id: -1, t: 'room', pts: loop, name: RoomTool.lastName || 'Locale', layer: 'LOCALI' });
  }

  private edit(room: RoomE) {
    const doc = this.h.doc;
    const um = UNIT_MM[doc.settings.units];
    const cm = (x: number) => Math.round(((x * um) / 10) * 100) / 100, mm = (x: number) => Math.round(x * um * 100) / 100;
    const fromCm = (x: number) => (x * 10) / um, fromMm = (x: number) => x / um;
    const f = room.floor ? { on: true, lay: room.floor.lay, l: cm(room.floor.l), w: cm(room.floor.w), j: mm(room.floor.j), color: room.floor.color, box: room.floor.box ?? 0 } : { ...last.floor };
    const c = room.clad ? { on: true, lay: room.clad.lay, l: cm(room.clad.l), w: cm(room.clad.w), j: mm(room.clad.j), color: room.clad.color, box: room.clad.box ?? 0, hgt: cm(room.clad.hgt) } : { ...last.clad, on: false };
    const part = (p: 'f' | 'c', lab: string, d: typeof f, on: boolean): FormField[] => [
      { k: 'check', key: `${p}on`, label: lab, value: on },
      { k: 'tiles', key: `${p}lay`, label: 'Posa', value: d.lay, tiles: layTiles(), when: [`${p}on`, 'true'] },
      { k: 'num', key: `${p}l`, label: 'Lato lungo', unit: 'cm', value: d.l, when: [`${p}on`, 'true'] },
      { k: 'num', key: `${p}w`, label: 'Lato corto', unit: 'cm', value: d.w, when: [`${p}on`, 'true'] },
      { k: 'num', key: `${p}j`, label: 'Fuga', unit: 'mm', value: d.j, minIncl: true, max: 50, when: [`${p}on`, 'true'] },
      { k: 'color', key: `${p}color`, label: 'Colore della piastrella', value: d.color, when: [`${p}on`, 'true'] },
      { k: 'num', key: `${p}box`, label: 'm² in una scatola (0 = non si sa)', value: d.box, minIncl: true, when: [`${p}on`, 'true'] },
    ];
    const fields: FormField[] = [
      { k: 'head', key: 'h1', label: `Pavimento di ${room.name || 'questo locale'}` },
      ...part('f', 'Pavimento con piastrelle', f, f.on),
      { k: 'head', key: 'h2', label: 'Rivestimento delle pareti' },
      ...part('c', 'Pareti rivestite', c, c.on),
      { k: 'num', key: 'chgt', label: 'Altezza del rivestimento', unit: 'cm', value: c.hgt, when: ['con', 'true'] },
    ];
    this.ask('Piastrelle: impostazioni nella finestra (Invio = OK, Esc = annulla)', [], undefined, 'none');
    void this.h.form({ title: 'Piastrelle', fields, note: 'Pavimento dentro il locale e rivestimento dei suoi lati (i fili interni dei muri), tolti porte e finestre. La posa parte dall\'angolo in basso a sinistra.' }).then(val => {
      if (!this.h.isCurrent(this)) return;
      if (!val) { this.h.msg('*Annullato*'); this.h.done(); return; }
      const tiles = (p: 'f' | 'c'): Tiles => {
        const t: Tiles = { l: fromCm(val[`${p}l`] as number), w: fromCm(val[`${p}w`] as number), j: fromMm(val[`${p}j`] as number), lay: val[`${p}lay`] as TileLay, color: val[`${p}color`] as string };
        if ((val[`${p}box`] as number) > 0) t.box = val[`${p}box`] as number;
        return t;
      };
      const out: RoomE = { ...room };
      if (val.fon) out.floor = tiles('f'); else delete out.floor;
      if (val.con) out.clad = { ...tiles('c'), hgt: fromCm(val.chgt as number) } as Cladding; else delete out.clad;
      // ricorda quello che si è scelto, per il prossimo locale
      const keep = (p: 'f' | 'c') => ({ on: !!val[`${p}on`], lay: val[`${p}lay`] as TileLay, l: val[`${p}l`] as number, w: val[`${p}w`] as number, j: val[`${p}j`] as number, color: val[`${p}color`] as string, box: val[`${p}box`] as number });
      last.floor = keep('f');
      last.clad = { ...keep('c'), hgt: val.chgt as number };
      let saved: Ent | undefined;
      doc.edit('Piastrelle', () => {
        doc.ensureLayer('LOCALI');
        if (room.id < 0) { const { id: _id, ...rest } = out; saved = doc.add(rest); } else { doc.replace([out]); saved = out; }
      });
      const r = (doc.ents.find(e => e.id === saved?.id) ?? out) as RoomE;
      const q = roomComputo(doc, r);
      const bits: string[] = [];
      const say = (lab: string, x: NonNullable<typeof q.floor> | NonNullable<typeof q.clad>) => bits.push(`${lab} ${fmtNum(x.m2, 2)} m², ${x.pcs} pezzi${x.boxes ? `, ${x.boxes} scatole` : ''} (sfrido ${x.sfrido}%)`);
      if (q.floor) say('pavimento', q.floor);
      if (q.clad) say('rivestimento', q.clad);
      this.h.msg(`${r.name || 'Locale'}: ${bits.length ? bits.join('; ') : 'niente piastrelle'}. Per tutti i locali: COMPUTO.`);
      this.h.setSelection([]);
      this.h.done();
    });
  }
}
