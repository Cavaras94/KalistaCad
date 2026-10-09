import { Vec, Box, v } from '../model/geom';

/** Finestra sul disegno: asse y verso l'alto nel mondo, verso il basso sullo schermo. */
export class View {
  cx = 0;
  cy = 0;
  /** pixel per unità di disegno */
  s = 1;
  w = 1;
  h = 1;

  toScreen(p: Vec): Vec {
    return v((p.x - this.cx) * this.s + this.w / 2, this.h / 2 - (p.y - this.cy) * this.s);
  }

  toWorld(x: number, y: number): Vec {
    return v((x - this.w / 2) / this.s + this.cx, (this.h / 2 - y) / this.s + this.cy);
  }

  zoomAt(sx: number, sy: number, f: number) {
    const before = this.toWorld(sx, sy);
    this.s = Math.min(1e7, Math.max(1e-7, this.s * f));
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  panBy(dx: number, dy: number) {
    this.cx -= dx / this.s;
    this.cy += dy / this.s;
  }

  fit(b: Box, margin = 0.06) {
    const bw = Math.max(b.x1 - b.x0, 1e-6), bh = Math.max(b.y1 - b.y0, 1e-6);
    this.s = Math.min(this.w / bw, this.h / bh) * (1 - 2 * margin);
    this.cx = (b.x0 + b.x1) / 2;
    this.cy = (b.y0 + b.y1) / 2;
  }

  visibleBox(): Box {
    const a = this.toWorld(0, this.h), b = this.toWorld(this.w, 0);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }
}
