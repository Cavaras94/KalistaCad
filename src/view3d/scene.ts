// Dal modello (model.ts) alla scena di three.js. In three l'asse in alto è y: un punto della pianta
// (x, y) alla quota z diventa (x, z, -y).
import * as THREE from 'three';
import type { Model, Prism, Floor, CladFace } from './model';
import type { Tiles } from '../model/entities';
import { tileGrid, gridRects, roomBox } from '../model/tiles';
import type { Vec } from '../model/geom';

const MAX_TEX = 4096;

/** Disegno delle piastrelle su una tela: fughe del colore di fondo, piastrelle del loro colore. */
function tileTexture(t: Tiles, w: number, h: number, perM: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !(w > 0 && h > 0)) return null;
  // circa 3 punti per centimetro, ma mai più di 4096 per lato
  const k = Math.min((3 * 100) / perM, MAX_TEX / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * k)), ch = Math.max(2, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = jointColor(t.color);
  g.fillRect(0, 0, cw, ch);
  const quads = gridRects(tileGrid(t), { x0: 0, y0: 0, x1: w, y1: h }, { x: 0, y: 0 }, 200000, t.j / 2);
  g.fillStyle = t.color;
  if (quads) {
    for (const q of quads) {
      g.beginPath();
      q.forEach((p, i) => { const x = p.x * k, y = ch - p.y * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
      g.fill();
    }
  } else g.fillRect(0, 0, cw, ch);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Fuga: un grigio un po' più scuro (o più chiaro, su piastrelle scure) della piastrella. */
function jointColor(hex: string): string {
  const c = new THREE.Color(hex);
  const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  return l > 0.35 ? '#' + c.clone().multiplyScalar(0.72).getHexString() : '#' + c.clone().lerp(new THREE.Color('#ffffff'), 0.35).getHexString();
}

function shapeOf(pts: Vec[]): THREE.Shape {
  return new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, p.y)));
}

function prismMesh(p: Prism, mats: { wall: THREE.Material[]; glass: THREE.Material }): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shapeOf(p.pts), { depth: p.z1 - p.z0, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, p.z0, 0);
  let mat: THREE.Material | THREE.Material[];
  if (p.kind === 'glass') mat = mats.glass;
  else if (p.kind === 'wall') mat = mats.wall;
  else {
    // senza un colore proprio: bianco come la ceramica (i colori dei layer sono pensati per lo schermo scuro)
    const c = new THREE.Color(p.color ?? '#efeee9');
    mat = [new THREE.MeshStandardMaterial({ color: c.clone().lerp(new THREE.Color('#ffffff'), 0.25), roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })];
  }
  const m = new THREE.Mesh(geo, mat);
  m.name = p.kind === 'solid' ? 'Oggetto' : p.kind === 'glass' ? 'Vetro' : 'Muro';
  return m;
}

function floorMesh(f: Floor, perM: number, lift: number): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(shapeOf(f.pts));
  const b = roomBox(f.pts);
  const bw = Math.max(b.x1 - b.x0, 1e-9), bh = Math.max(b.y1 - b.y0, 1e-9);
  // coordinate della tela: la posa parte dall'angolo in basso a sinistra del locale, come in pianta
  const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - b.x0) / bw, (pos.getY(i) - b.y0) / bh);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, lift, 0);
  const tex = f.tiles ? tileTexture(f.tiles, bw, bh, perM) : null;
  const mat = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : '#d7d2c8', map: tex ?? undefined, roughness: 0.55 });
  const m = new THREE.Mesh(geo, mat);
  m.name = f.name ? `Pavimento ${f.name}` : 'Pavimento';
  return m;
}

/**
 * Rettangoli della parete rivestita, vani esclusi: la parete si divide in strisce verticali ai bordi
 * dei vani, e da ogni striscia si tolgono i tratti in altezza occupati da un vano.
 */
export function cladRects(c: Pick<CladFace, 'L' | 'hgt' | 'holes'>): [number, number, number, number][] {
  const ts = new Set([0, c.L]);
  for (const h of c.holes) { ts.add(Math.max(0, Math.min(c.L, h.t0))); ts.add(Math.max(0, Math.min(c.L, h.t1))); }
  const cuts = [...ts].sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i], t1 = cuts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    const gaps = c.holes.filter(h => h.t0 < tm && h.t1 > tm).map(h => [Math.max(0, h.z0), Math.min(c.hgt, h.z1)] as [number, number]).filter(g => g[1] > g[0]).sort((a, b) => a[0] - b[0]);
    let z = 0;
    for (const [g0, g1] of gaps) { if (g0 > z + 1e-9) out.push([t0, z, t1, g0]); z = Math.max(z, g1); }
    if (c.hgt > z + 1e-9) out.push([t0, z, t1, c.hgt]);
  }
  return out;
}

function cladMesh(c: CladFace, perM: number, lift: number): THREE.Mesh {
  const u = { x: (c.b.x - c.a.x) / c.L, y: (c.b.y - c.a.y) / c.L };
  const P = (t: number, z: number) => [c.a.x + u.x * t + c.inward.x * lift, z, -(c.a.y + u.y * t + c.inward.y * lift)];
  const pos: number[] = [], uv: number[] = [];
  for (const [t0, z0, t1, z1] of cladRects(c)) {
    for (const [t, z] of [[t0, z0], [t1, z0], [t1, z1], [t0, z0], [t1, z1], [t0, z1]]) { pos.push(...P(t, z)); uv.push(t / c.L, z / c.hgt); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const tex = tileTexture(c.tiles, c.L, c.hgt, perM);
  const mat = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : c.tiles.color, map: tex ?? undefined, roughness: 0.4, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'Rivestimento';
  return m;
}

export interface Built { scene: THREE.Scene; center: THREE.Vector3; size: number }

export function buildScene(m: Model): Built {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe5ec');
  const mats = {
    wall: [new THREE.MeshStandardMaterial({ color: '#8f959e', roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.85 })],
    glass: new THREE.MeshStandardMaterial({ color: '#a9d4f5', transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, depthWrite: false }),
  };
  const mm = m.perM / 1000; // un millimetro, nelle unità del disegno
  for (const p of m.prisms) scene.add(prismMesh(p, mats));
  for (const f of m.floors) scene.add(floorMesh(f, m.perM, mm));
  for (const c of m.clads) scene.add(cladMesh(c, m.perM, mm * 2));

  const { x0, y0, x1, y1, z1 } = m.box;
  const size = Math.max(x1 - x0, y1 - y0, z1, 1e-6);
  // un piano sotto tutto, perché la casa non galleggi nel vuoto
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size * 4), new THREE.MeshStandardMaterial({ color: '#c3cad3', roughness: 1 }));
  ground.rotateX(-Math.PI / 2);
  ground.position.set((x0 + x1) / 2, -mm, -(y0 + y1) / 2);
  ground.name = 'Terreno';
  scene.add(ground);

  // luce diffusa da tutte le parti, perché anche dentro le stanze si veda bene, più un sole di lato
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8b2a8', 1.8), new THREE.AmbientLight('#ffffff', 0.9));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(x0 - size * 0.6, size * 1.4, -(y0 - size * 0.9));
  sun.target.position.set((x0 + x1) / 2, 0, -(y0 + y1) / 2);
  scene.add(sun, sun.target);
  return { scene, center: new THREE.Vector3((x0 + x1) / 2, 0, -(y0 + y1) / 2), size };
}
