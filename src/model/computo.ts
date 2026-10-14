// Computo dei materiali di un locale: pavimento e rivestimento, in m², pezzi e scatole.
import type { RoomE, DoorE, WindowE, Tiles, Cladding } from './entities';
import type { Doc } from './document';
import { roomSides, claddingArea, quantity, roomFloorArea, SFRIDO, type Quantity, type Heights } from './tiles';

export interface RoomComputo {
  name: string;
  floor?: Quantity & { t: Tiles; sfrido: number };
  clad?: Quantity & { t: Cladding; sfrido: number };
}

/** Altezze per le pareti: quelle delle impostazioni del disegno. */
export function heightsOf(doc: Doc): Heights {
  const s = doc.settings;
  return { wallH: s.wallH, doorH: s.doorH, winSill: s.winSill, winH: s.winH };
}

/**
 * Computo di un locale. sfrido = percentuale in più da comprare; assente = quella consigliata per la
 * posa (più alta per spina di pesce e diagonale).
 */
export function roomComputo(doc: Doc, r: RoomE, sfrido?: number): RoomComputo {
  const ctx = doc.ctx();
  const out: RoomComputo = { name: r.name };
  if (r.floor) {
    const sf = sfrido ?? SFRIDO[r.floor.lay];
    out.floor = { ...quantity(roomFloorArea(r), r.floor, ctx.areaDiv, sf), t: r.floor, sfrido: sf };
  }
  if (r.clad) {
    const openings = doc.ents.filter((e): e is DoorE | WindowE => e.t === 'door' || e.t === 'window');
    const th = (o: DoorE | WindowE) => ctx.walls?.openTh.get(o.id) ?? o.th;
    const area = claddingArea(roomSides(r, openings, th, heightsOf(doc)), r.clad.hgt);
    const sf = sfrido ?? SFRIDO[r.clad.lay];
    out.clad = { ...quantity(area, r.clad, ctx.areaDiv, sf), t: r.clad, sfrido: sf };
  }
  return out;
}
