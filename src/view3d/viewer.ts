// Finestra della vista 3D: si gira attorno al modello, o ci si mette dentro un locale ad altezza
// d'occhio; immagine PNG e modello 3D (glTF .glb, OBJ) da salvare.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Doc } from '../model/document';
import { buildModel } from './model';
import { buildScene } from './scene';
import { centroid } from '../model/geom';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
  for (const c of kids) e.append(c);
  return e;
}

/** Salva un file: con il selettore del browser se c'è, se no come scaricamento. false = rinuncia. */
async function saveBlob(blob: Blob, name: string, desc: string, mime: string, ext: string): Promise<boolean> {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> };
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [ext] } }] });
      const wr = await h.createWritable();
      await wr.write(blob);
      await wr.close();
      return true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return false;
      // selettore non disponibile in questo contesto: si scarica
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

let openViewer: { close(): void } | null = null;

/** Apre la vista 3D del disegno. msg = riga per la storia della riga di comando. */
export function open3D(doc: Doc, fileName: string, msg: (s: string) => void, only?: Set<number>) {
  openViewer?.close();
  const model = buildModel(doc, only);
  if (!model.prisms.length && !model.floors.length) {
    msg('Vista 3D: nel disegno non ci sono muri, locali o oggetti con un\'altezza da mostrare.');
    return;
  }
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    msg('Vista 3D non disponibile: questo browser non permette il disegno 3D (WebGL).');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const { scene, center, size } = buildScene(model);
  const camera = new THREE.PerspectiveCamera(50, 1, size / 2000, size * 60);
  // vista d'insieme: da sud-ovest, dall'alto, abbastanza lontano da vedere dentro i locali
  const home = () => {
    camera.fov = 45;
    camera.updateProjectionMatrix();
    camera.position.set(center.x - size * 0.6, size * 1.9, center.z + size * 1.0);
    controls.target.copy(center);
    controls.update();
  };

  // ---- finestra
  const room = el('select', { title: 'Mettersi dentro un locale, ad altezza d\'occhio' });
  room.append(el('option', { value: '' }, 'Vista d\'insieme'));
  model.floors.forEach((f, i) => room.append(el('option', { value: String(i) }, `Dentro: ${f.name || `locale ${i + 1}`}`)));
  const bPng = el('button', { title: 'Salva quello che si vede come immagine PNG' }, 'Immagine');
  const bGlb = el('button', { title: 'Modello 3D con i colori e le piastrelle, per altri programmi (glTF binario)' }, 'Modello .glb');
  const bObj = el('button', { title: 'Modello 3D senza piastrelle, per i programmi che leggono solo OBJ' }, 'Modello .obj');
  const bClose = el('button', { class: 'primary', title: 'Chiudi (Esc)' }, 'Chiudi');
  const hint = el('span', { class: 'v3d-hint' });
  const bar = el('div', { class: 'v3d-bar' }, el('strong', {}, 'Vista 3D'), room, hint, el('span', { class: 'v3d-gap' }), bPng, bGlb, bObj, bClose);
  const wrap = el('div', { class: 'v3d-canvas' }, renderer.domElement);
  const root = el('div', { class: 'v3d', role: 'dialog', 'aria-label': 'Vista 3D' }, bar, wrap);
  document.body.append(root);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  home();

  // ---- dentro un locale: si guarda attorno trascinando, si cammina con frecce o W A S D
  let inside = false, yaw = 0, pitch = 0;
  const eye = 1.6 * model.perM;
  const look = () => {
    const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(camera.position.clone().add(d));
  };
  const setHint = () => {
    hint.textContent = inside ? 'Trascinare: guardarsi attorno · Frecce o W A S D: camminare · Esc: chiudi'
      : 'Trascinare: girare attorno · Rotella: avvicinarsi · Tasto destro: spostare · Esc: chiudi';
  };
  room.onchange = () => {
    const f = model.floors[Number(room.value)];
    inside = !!room.value && !!f;
    controls.enabled = !inside;
    if (inside && f) {
      const c = centroid(f.pts);
      // dentro una stanza serve un'inquadratura più larga; ci si mette verso il lato sud, guardando
      // verso nord, per avere davanti quasi tutta la stanza
      camera.fov = 75;
      camera.updateProjectionMatrix();
      let y0 = Infinity, y1 = -Infinity;
      for (const p of f.pts) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const y = Math.min(c.y, y0 + Math.max((y1 - y0) * 0.12, Math.min(0.4 * model.perM, (y1 - y0) / 2)));
      camera.position.set(c.x, eye, -y);
      yaw = 0; pitch = -0.08;
      look();
    } else home();
    setHint();
    room.blur();
  };
  setHint();
  let drag: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', e => { if (inside) { drag = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); } });
  renderer.domElement.addEventListener('pointermove', e => {
    if (!inside || !drag) return;
    yaw += (e.clientX - drag.x) * 0.005;
    pitch = Math.max(-1.3, Math.min(1.3, pitch - (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
    look();
  });
  renderer.domElement.addEventListener('pointerup', () => { drag = null; });
  const keys = new Set<string>();

  // ---- tasti: vanno alla vista 3D, non alla riga di comando che sta sotto
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLSelectElement && e.key !== 'Escape') return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.type === 'keydown') keys.add(e.key.toLowerCase()); else keys.delete(e.key.toLowerCase());
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKey, true);

  // ---- disegno continuo
  const fit = () => {
    const r = wrap.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(wrap);
  fit();
  let raf = 0, last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (inside && keys.size) {
      // circa un metro e mezzo al secondo
      const sp = 1.5 * model.perM * dt;
      const f = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      if (keys.has('arrowup') || keys.has('w')) camera.position.addScaledVector(f, sp);
      if (keys.has('arrowdown') || keys.has('s')) camera.position.addScaledVector(f, -sp);
      if (keys.has('arrowleft') || keys.has('a')) camera.position.addScaledVector(r, -sp);
      if (keys.has('arrowright') || keys.has('d')) camera.position.addScaledVector(r, sp);
    }
    if (!inside) controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // ---- immagine e modelli
  const base = (fileName || 'disegno').replace(/[\\/:*?"<>|]+/g, '_');
  bPng.onclick = async () => {
    renderer.render(scene, camera);
    const blob = await new Promise<Blob | null>(res => renderer.domElement.toBlob(res, 'image/png'));
    if (blob && await saveBlob(blob, `${base} 3D.png`, 'Immagine PNG', 'image/png', '.png')) msg(`Vista 3D salvata come immagine (${renderer.domElement.width}×${renderer.domElement.height}).`);
  };
  bGlb.onclick = async () => {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const exportable = scene.clone();
    exportable.children = exportable.children.filter(o => o instanceof THREE.Mesh);
    const data = await new GLTFExporter().parseAsync(exportable, { binary: true });
    const blob = new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' });
    if (await saveBlob(blob, `${base}.glb`, 'Modello 3D glTF', 'model/gltf-binary', '.glb')) msg('Modello 3D salvato in formato glTF (.glb), con colori e piastrelle.');
  };
  bObj.onclick = async () => {
    const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
    const text = new OBJExporter().parse(scene);
    if (await saveBlob(new Blob([text], { type: 'text/plain' }), `${base}.obj`, 'Modello 3D OBJ', 'text/plain', '.obj')) msg('Modello 3D salvato in formato OBJ (forme, senza colori né piastrelle).');
  };

  const close = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKey, true);
    controls.dispose();
    scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }
      }
    });
    renderer.dispose();
    root.remove();
    openViewer = null;
  };
  bClose.onclick = close;
  openViewer = { close };
  (window as unknown as { __v3d?: unknown }).__v3d = { scene, camera, renderer, close, model };
  msg(`Vista 3D${only ? ' degli oggetti selezionati' : ''}: ${model.prisms.filter(p => p.kind === 'wall').length} pezzi di muro, ${model.floors.length} locali, ${model.prisms.filter(p => p.kind === 'solid').length} oggetti.`);
}
