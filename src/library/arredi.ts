// Libreria di sanitari e arredi: simboli in pianta con i loro solidi per la vista 3D.
// Tutte le misure in centimetri. Il punto base è il centro del lato che va contro il muro (y = 0):
// l'oggetto sta verso y negativi. Così con lo snap Medio sul filo del muro si appoggia al centro.
import type { NewEnt } from '../model/entities';
import { v } from '../model/geom';

type Z = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number, z?: Z): NewEnt =>
  ({ t: 'poly', pts: [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)], closed: true, layer: '0', ...(z ? { z } : {}) });
const circle = (x: number, y: number, r: number, z?: Z): NewEnt => ({ t: 'circle', c: v(x, y), r, layer: '0', ...(z ? { z } : {}) });
/** ellisse con il semiasse rx lungo x e ry lungo y */
const oval = (x: number, y: number, rx: number, ry: number, z?: Z): NewEnt =>
  (rx >= ry ? { t: 'ellipse', c: v(x, y), a: v(rx, 0), k: ry / rx, layer: '0', ...(z ? { z } : {}) } : { t: 'ellipse', c: v(x, y), a: v(0, ry), k: rx / ry, layer: '0', ...(z ? { z } : {}) });
const line = (x0: number, y0: number, x1: number, y1: number): NewEnt => ({ t: 'line', a: v(x0, y0), b: v(x1, y1), layer: '0' });
/** gambe di un tavolo o di una sedia: quattro quadratini agli angoli */
const legs = (x0: number, y0: number, x1: number, y1: number, s: number, h: number): NewEnt[] =>
  [[x0, y0], [x1 - s, y0], [x1 - s, y1 - s], [x0, y1 - s]].map(([x, y]) => rect(x, y, x + s, y + s, [0, h]));

export interface LibItem { key: string; name: string; group: 'Bagno' | 'Cucina' | 'Casa'; ents: NewEnt[] }

export const LIBRARY: LibItem[] = [
  // ---- bagno
  { key: 'lavabo', name: 'Lavabo 60×45', group: 'Bagno', ents: [rect(-30, -45, 30, 0, [70, 85]), oval(0, -24, 21, 14), circle(0, -5, 2)] },
  { key: 'lavabo-mobile', name: 'Mobile lavabo 80×50', group: 'Bagno', ents: [rect(-40, -50, 40, 0, [0, 85]), oval(0, -26, 26, 15), circle(0, -6, 2)] },
  { key: 'vaso', name: 'Vaso sospeso 36×54', group: 'Bagno', ents: [rect(-18, -12, 18, 0, [25, 42]), oval(0, -32, 18, 22, [25, 42]), oval(0, -33, 11, 15)] },
  { key: 'bidet', name: 'Bidet sospeso 36×54', group: 'Bagno', ents: [rect(-18, -12, 18, 0, [25, 40]), oval(0, -32, 18, 22, [25, 40]), oval(0, -33, 11, 15), circle(0, -8, 2)] },
  { key: 'doccia80', name: 'Piatto doccia 80×80', group: 'Bagno', ents: [rect(-40, -80, 40, 0, [0, 4]), rect(-36, -76, 36, -4), circle(0, -40, 4), line(-36, -76, 36, -4), line(-36, -4, 36, -76)] },
  { key: 'doccia120', name: 'Piatto doccia 120×80', group: 'Bagno', ents: [rect(-60, -80, 60, 0, [0, 4]), rect(-56, -76, 56, -4), circle(0, -40, 4), line(-56, -76, 56, -4), line(-56, -4, 56, -76)] },
  { key: 'vasca', name: 'Vasca 170×70', group: 'Bagno', ents: [rect(-85, -70, 85, 0, [0, 55]), oval(4, -35, 72, 27), circle(-62, -35, 3)] },
  { key: 'termoarredo', name: 'Termoarredo 50×10', group: 'Bagno', ents: [rect(-25, -10, 25, 0, [20, 140]), line(-25, -5, 25, -5)] },
  { key: 'lavatrice', name: 'Lavatrice 60×60', group: 'Bagno', ents: [rect(-30, -60, 30, 0, [0, 85]), circle(0, -32, 20)] },
  // ---- cucina
  { key: 'base', name: 'Base cucina 60×60', group: 'Cucina', ents: [rect(-30, -60, 30, 0, [0, 90]), line(-30, -57, 30, -57)] },
  { key: 'lavello', name: 'Lavello cucina 120×60', group: 'Cucina', ents: [rect(-60, -60, 60, 0, [0, 90]), rect(-52, -50, -6, -10), rect(6, -50, 52, -10), circle(0, -6, 2)] },
  { key: 'cottura', name: 'Piano cottura 60×60', group: 'Cucina', ents: [rect(-30, -60, 30, 0, [0, 90]), circle(-14, -16, 8), circle(14, -16, 10), circle(-14, -44, 10), circle(14, -44, 8)] },
  { key: 'frigo', name: 'Frigorifero 60×65', group: 'Cucina', ents: [rect(-30, -65, 30, 0, [0, 185]), line(-30, -60, 30, -60), line(-25, -65, 25, -5)] },
  { key: 'pensile', name: 'Pensile 60×35', group: 'Cucina', ents: [rect(-30, -35, 30, 0, [145, 215]), line(-30, -35, 30, 0), line(-30, 0, 30, -35)] },
  // ---- casa
  { key: 'letto2', name: 'Letto matrimoniale 160×200', group: 'Casa', ents: [rect(-80, -205, 80, -5, [0, 50]), rect(-80, -5, 80, 0, [0, 100]), rect(-70, -45, -5, -15), rect(5, -45, 70, -15), line(-80, -75, 80, -75)] },
  { key: 'letto1', name: 'Letto singolo 90×200', group: 'Casa', ents: [rect(-45, -205, 45, -5, [0, 50]), rect(-45, -5, 45, 0, [0, 100]), rect(-35, -45, 35, -15), line(-45, -75, 45, -75)] },
  { key: 'armadio', name: 'Armadio 120×60', group: 'Casa', ents: [rect(-60, -60, 60, 0, [0, 240]), line(0, -60, 0, 0), line(-60, -60, 0, 0), line(0, -60, 60, 0)] },
  { key: 'tavolo', name: 'Tavolo 120×80', group: 'Casa', ents: [rect(-60, -80, 60, 0, [72, 76]), ...legs(-58, -78, 58, -2, 5, 72)] },
  { key: 'sedia', name: 'Sedia 45×45', group: 'Casa', ents: [rect(-22, -45, 22, -4, [42, 46]), rect(-22, -4, 22, 0, [0, 90]), ...legs(-21, -44, 21, -4, 3, 42)] },
  { key: 'divano', name: 'Divano 200×90', group: 'Casa', ents: [rect(-90, -90, 90, -20, [0, 42]), rect(-100, -20, 100, 0, [0, 85]), rect(-100, -90, -90, -20, [0, 62]), rect(90, -90, 100, -20, [0, 62]), line(0, -90, 0, -20)] },
  { key: 'scrivania', name: 'Scrivania 120×60', group: 'Casa', ents: [rect(-60, -60, 60, 0, [72, 75]), ...legs(-59, -59, 59, -1, 4, 72)] },
];
