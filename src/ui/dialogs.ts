// Finestre di dialogo.
import type { Doc, Settings, Units } from '../model/document';
import { UNIT_LABEL, UNIT_MM } from '../model/document';
import type { SnapKind } from '../model/entities';
import type { SnapSettings } from '../view/snap';
import { SNAP_LABEL } from '../view/snap';
import { COMMANDS } from './commands';
import { VERSION_LONG } from './logo';
import type { Box } from '../model/geom';
import { boxValid } from '../model/geom';
import type { Prim, RoomE } from '../model/entities';
import { roomComputo } from '../model/computo';
import { describeTiles } from '../tools/posa';
import { primsBox, fmtNum as fmtDec } from '../model/entities';
import type { FormSpec, FormValues, FormField } from '../tools/base';
import { paint } from '../view/render';
import { View } from '../view/view';

/** Numero come lo si scrive: virgola per i decimali, senza zeri inutili. */
const fmtNum = (x: number) => (Number.isInteger(x) ? String(x) : fmtDec(x, 4).replace(/0+$/, '').replace(/,$/, ''));
import { buildSheet, PAPERS, STD_SCALES, Paper, PrintOpts, TitleFields, WallFill } from '../print/sheet';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  for (const c of kids) e.append(c);
  return e;
}

interface Btn { label: string; primary?: boolean; onClick?: () => boolean | void | Promise<boolean | void> }

export function modal(title: string, body: HTMLElement, buttons: Btn[], wide = false): { close: () => void } {
  const root = document.getElementById('dialog-root')!;
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title });
  const head = el('div', { class: 'modal-head' }, el('h3', {}, title));
  const x = el('button', { class: 'icon-btn', title: 'Chiudi' }, '✕');
  head.append(x);
  const foot = el('div', { class: 'modal-foot' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
      const primary = buttons.find(b => b.primary);
      if (primary) { e.preventDefault(); e.stopPropagation(); run(primary); }
    } else e.stopPropagation();
  };
  const run = async (b: Btn) => { const r = await b.onClick?.(); if (r !== false) close(); };
  for (const b of buttons) {
    const btn = el('button', { class: b.primary ? 'primary' : '' }, b.label);
    btn.onclick = () => run(b);
    foot.append(btn);
  }
  x.onclick = close;
  back.onclick = e => { if (e.target === back) close(); };
  box.append(head, el('div', { class: 'modal-body' }, body), foot);
  back.append(box);
  root.append(back);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => (box.querySelector('input, select, textarea') as HTMLElement | null)?.focus(), 0);
  return { close };
}

export function askText(title: string, label: string, value = ''): Promise<string | null> {
  return new Promise(resolve => {
    const input = el('input', { type: 'text', value });
    let done = false;
    const body = el('label', { class: 'field' }, el('span', {}, label), input);
    const m = modal(title, body, [
      { label: 'Annulla', onClick: () => { done = true; resolve(null); } },
      { label: 'OK', primary: true, onClick: () => { done = true; resolve(input.value); } },
    ]);
    const obs = new MutationObserver(() => { if (!document.body.contains(input)) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.getElementById('dialog-root')!, { childList: true });
    setTimeout(() => input.select(), 0);
    void m;
  });
}

/** Casella a più righe che cresce con quello che si scrive (wide = anche in larghezza). */
export function growArea(value: string, rows = 1, wide = false): HTMLTextAreaElement {
  const ta = el('textarea', { rows: String(rows), spellcheck: 'false' });
  ta.value = value;
  const fit = () => {
    if (!ta.isConnected) return;
    if (wide) {
      // larga quanto la riga più lunga (il limite sta nel foglio di stile)
      ta.style.width = '';
      ta.style.width = `${Math.max(ta.offsetWidth, ta.scrollWidth + 8)}px`;
    }
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };
  ta.addEventListener('input', fit);
  setTimeout(fit, 0);
  return ta;
}

export interface WriteOpts {
  title: string;
  value?: string;
  /** punto dello schermo sotto cui mettere il riquadro (al centro se manca) */
  at?: { x: number; y: number };
  /** chiamata a ogni tasto, per l'anteprima nel disegno */
  onInput?: (s: string) => void;
}

/**
 * Riquadro per scrivere un testo su più righe: Invio va a capo, Ctrl+Invio o un clic fuori
 * confermano, Esc annulla. Restituisce null se si annulla.
 */
export function writeBox(o: WriteOpts): Promise<string | null> {
  return new Promise(resolve => {
    const back = el('div', { class: 'write-back' });
    const ta = growArea(o.value ?? '', 2, true);
    ta.cols = 28;
    ta.setAttribute('wrap', 'off');
    const ok = el('button', { class: 'primary' }, 'OK');
    const no = el('button', {}, 'Annulla');
    const box = el('div', { class: 'write-box', role: 'dialog', 'aria-label': o.title },
      el('div', { class: 'write-title' }, o.title), ta,
      el('div', { class: 'write-foot' }, el('small', {}, 'Invio = a capo · Ctrl+Invio = conferma · Esc = annulla'), no, ok));
    let done = false;
    const finish = (val: string | null) => {
      if (done) return;
      done = true;
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(ta.value); }
      else if (e.key === 'Tab') {
        const ring: HTMLElement[] = [ta, no, ok];
        const i = ring.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        ring[(i + (e.shiftKey ? ring.length - 1 : 1) + ring.length) % ring.length].focus();
      }
    };
    // il riquadro resta dentro la finestra anche quando cresce
    const place = () => {
      const r = box.getBoundingClientRect();
      const x = o.at ? o.at.x : (window.innerWidth - r.width) / 2;
      const y = o.at ? o.at.y : (window.innerHeight - r.height) / 2;
      box.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
      box.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
    };
    ta.addEventListener('input', () => { o.onInput?.(ta.value); setTimeout(place, 0); });
    ok.onclick = () => finish(ta.value);
    no.onclick = () => finish(null);
    // Un clic fuori conferma: solo col tasto sinistro, premuto e rilasciato fuori, e non nel primo
    // istante (il secondo colpo di un doppio clic che ha appena aperto il riquadro non deve chiuderlo).
    const opened = Date.now();
    let downOut = false;
    back.onmousedown = e => { downOut = e.target === back && e.button === 0 && Date.now() - opened > 400; };
    back.onclick = e => { if (downOut && e.target === back) finish(ta.value); downOut = false; };
    // il clic destro non deve arrivare al disegno, dove vale Invio
    back.oncontextmenu = e => e.preventDefault();
    // (Tab, in onKey, gira fra casella, Annulla e OK senza uscire dal riquadro)
    back.append(box);
    document.getElementById('dialog-root')!.append(back);
    document.addEventListener('keydown', onKey, true);
    place();
    setTimeout(() => { place(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  });
}

export function confirmBox(title: string, text: string, ok = 'Continua'): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    modal(title, el('p', {}, text), [
      { label: 'Annulla', onClick: () => { done = true; resolve(false); } },
      { label: ok, primary: true, onClick: () => { done = true; resolve(true); } },
    ]);
    const root = document.getElementById('dialog-root')!;
    const obs = new MutationObserver(() => { if (!root.querySelector('.modal')) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(root, { childList: true });
  });
}

/** Caselle da spuntare; restituisce lo stato di ciascuna, o null se la finestra viene chiusa senza OK. */
export function chooseDialog(title: string, items: { key: string; label: string; on: boolean }[]): Promise<Record<string, boolean> | null> {
  return new Promise(resolve => {
    let done = false;
    const body = el('div', { class: 'checks column' });
    const boxes = items.map(it => {
      const c = el('input', { type: 'checkbox' });
      c.checked = it.on;
      body.append(el('label', {}, c, ` ${it.label}`));
      return [it.key, c] as const;
    });
    modal(title, body, [
      { label: 'Annulla', onClick: () => { done = true; resolve(null); } },
      { label: 'OK', primary: true, onClick: () => { done = true; resolve(Object.fromEntries(boxes.map(([k, c]) => [k, c.checked]))); } },
    ]);
    const root = document.getElementById('dialog-root')!;
    const obs = new MutationObserver(() => { if (!root.querySelector('.modal')) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(root, { childList: true });
  });
}

// ---------------------------------------------------------------- impostazioni dei comandi

const DIALOGS_KEY = 'planimetrie.dialogs';

/** Vero se i comandi aprono le finestre con le loro impostazioni: preferenza del browser, accesa di partenza. */
export function dialogsOn(): boolean {
  try { return localStorage.getItem(DIALOGS_KEY) !== '0'; } catch { return true; }
}

export function setDialogsOn(on: boolean) {
  try { localStorage.setItem(DIALOGS_KEY, on ? '1' : '0'); } catch { /* archiviazione non disponibile */ }
}

/** Piccolo disegno di una voce (un retino, un blocco) adattato al riquadro. */
function tileCanvas(ps: Prim[], w = 76, h = 56): HTMLCanvasElement {
  const c = el('canvas', { width: String(w * 2), height: String(h * 2) });
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  const g = c.getContext('2d');
  const b = primsBox(ps);
  if (!g || !boxValid(b)) return c;
  g.scale(2, 2);
  const view = new View();
  view.w = w; view.h = h;
  view.fit(b, 0.08);
  paint(g, view, ps, { color: '#dfe4ec', lw: 1, dash: [], wallAlpha: 0.45, tint: false });
  return c;
}

/**
 * Finestra con le impostazioni di un comando: numeri, scelte a pulsanti, riquadri con il disegno.
 * Restituisce i valori, o null se la si chiude senza OK. Invio vale OK; un doppio clic su un
 * riquadro lo sceglie e conferma.
 */
export function formDialog(spec: FormSpec): Promise<FormValues | null> {
  return new Promise(resolve => {
    let done = false;
    const body = el('div', { class: 'cmd-form' });
    if (spec.note) body.append(el('p', { class: 'muted' }, spec.note));
    const read: (() => [string, number | string | boolean] | null)[] = [];
    let submit: () => void = () => {};
    // voci che si vedono solo con una certa scelta: nascoste, non contano e tengono il valore proposto
    const chosen: Record<string, string> = {};
    const shown: { f: FormField; node: Element }[] = [];
    const visible = (f: FormField) => !f.when || chosen[f.when[0]] === f.when[1];
    const sync = () => { for (const { f, node } of shown) (node as HTMLElement).style.display = visible(f) ? '' : 'none'; };
    for (const f of spec.fields) if (f.k === 'choice') chosen[f.key] = f.value; else if (f.k === 'check') chosen[f.key] = String(f.value);
    for (const f of spec.fields) {
      const before = body.childElementCount;
      if (f.k === 'num') {
        const i = el('input', { type: 'text', value: fmtNum(f.value), name: f.key, inputmode: 'decimal' });
        const err = el('small', { class: 'err' });
        body.append(el('label', { class: 'field' }, el('span', {}, f.label + (f.unit ? ` (${f.unit})` : '')), i, f.hint ? el('small', {}, f.hint) : '', err));
        read.push(() => {
          const n = parseFloat(i.value.trim().replace(',', '.'));
          const min = f.min ?? 0;
          const bad = !Number.isFinite(n) || (!f.free && (f.minIncl ? n < min : n <= min)) || (f.max !== undefined && n > f.max) || (!!f.int && !Number.isInteger(n));
          const range = f.free ? '' : ` (${f.minIncl ? 'almeno' : 'più di'} ${fmtNum(min)}${f.max !== undefined ? `, al massimo ${fmtNum(f.max)}` : ''})`;
          err.textContent = bad ? `${f.int ? 'Serve un numero intero' : 'Numero non valido'}${range}` : '';
          i.classList.toggle('bad', bad);
          return bad ? null : [f.key, n];
        });
      } else if (f.k === 'choice') {
        let val = f.value;
        const row = el('div', { class: 'seg', role: 'radiogroup' });
        for (const [v, label] of f.options) {
          const b = el('button', { type: 'button', class: v === val ? 'on' : '', 'data-value': v }, label);
          b.onclick = () => { val = chosen[f.key] = v; row.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); b.blur(); sync(); }; // Invio resta OK
          row.append(b);
        }
        body.append(el('div', { class: 'field' }, el('span', {}, f.label), row));
        read.push(() => [f.key, val]);
      } else if (f.k === 'tiles') {
        let val = f.value;
        const grid = el('div', { class: 'tiles', role: 'radiogroup' });
        for (const t of f.tiles) {
          const d = el('div', { class: 'tile' + (t.value === val ? ' on' : ''), role: 'radio', title: t.label, 'data-value': t.value }, tileCanvas(t.prims), el('span', {}, t.label));
          d.onclick = () => { val = t.value; grid.querySelectorAll('.tile').forEach(x => x.classList.toggle('on', x === d)); };
          d.ondblclick = () => { val = t.value; submit(); };
          grid.append(d);
        }
        body.append(el('div', { class: 'field' }, el('span', {}, f.label), grid));
        read.push(() => [f.key, val]);
        setTimeout(() => grid.querySelector('.tile.on')?.scrollIntoView({ block: 'nearest' }), 0);
      } else if (f.k === 'check') {
        const c = el('input', { type: 'checkbox', name: f.key });
        c.checked = f.value;
        c.onchange = () => { chosen[f.key] = String(c.checked); sync(); };
        body.append(el('label', { class: 'check' }, c, ` ${f.label}`));
        read.push(() => [f.key, c.checked]);
      } else if (f.k === 'color') {
        const c = el('input', { type: 'color', name: f.key, value: f.value });
        body.append(el('label', { class: 'field' }, el('span', {}, f.label), c));
        read.push(() => [f.key, c.value]);
      } else {
        body.append(el('div', { class: 'form-head' }, f.label));
      }
      if (f.when) {
        shown.push({ f, node: body.children[before] });
        if (f.k !== 'head') {
          const r = read.pop()!;
          read.push(() => (visible(f) ? r() : [f.key, f.value]));
        }
      }
    }
    sync();
    const collect = (): FormValues | null => {
      const out: FormValues = {};
      let ok = true;
      for (const r of read) { const kv = r(); if (kv) out[kv[0]] = kv[1]; else ok = false; }
      return ok ? out : null;
    };
    const buttons: Btn[] = [];
    if (spec.extra) buttons.push({ label: spec.extra, onClick: () => { done = true; resolve({ _extra: true }); } });
    buttons.push({ label: 'Annulla', onClick: () => { done = true; resolve(null); } });
    buttons.push({ label: 'OK', primary: true, onClick: () => { const v = collect(); if (!v) return false; done = true; resolve(v); } });
    const m = modal(spec.title, body, buttons, spec.fields.some(f => f.k === 'tiles'));
    submit = () => { const v = collect(); if (v) { done = true; resolve(v); m.close(); } };
    const root = document.getElementById('dialog-root')!;
    const obs = new MutationObserver(() => { if (!document.body.contains(body)) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(root, { childList: true });
    // il primo numero è già selezionato: si scrive sopra il valore proposto
    setTimeout(() => (body.querySelector('input[type=text]') as HTMLInputElement | null)?.select(), 0);
  });
}

/** Domanda sì/no; il pulsante evidenziato (Invio) è la risposta def. null se la si chiude senza rispondere. */
export function yesNoDialog(title: string, text: string, def: boolean): Promise<boolean | null> {
  return new Promise(resolve => {
    let done = false;
    const body = el('p', {}, text);
    modal(title, body, [
      { label: 'No', primary: !def, onClick: () => { done = true; resolve(false); } },
      { label: 'Sì', primary: def, onClick: () => { done = true; resolve(true); } },
    ]);
    const obs = new MutationObserver(() => { if (!document.body.contains(body)) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.getElementById('dialog-root')!, { childList: true });
  });
}

/** Computo dei materiali di tutti i locali con le piastrelle: m², pezzi e scatole, con lo sfrido. */
export function computoDialog(doc: Doc) {
  const rooms = doc.ents.filter((e): e is RoomE => e.t === 'room' && (!!e.floor || !!e.clad));
  const um = UNIT_MM[doc.settings.units];
  const body = el('div', { class: 'computo' });
  if (!rooms.length) {
    body.append(el('p', {}, 'Nessun locale ha le piastrelle. Per metterle: comando PIASTRELLE, poi un clic dentro il locale.'));
    modal('Computo dei materiali', body, [{ label: 'Chiudi', primary: true }]);
    return;
  }
  const sf = el('input', { type: 'text', placeholder: 'come consigliato', inputmode: 'decimal', name: 'sfrido' });
  body.append(el('label', { class: 'field inline-field' }, el('span', {}, 'Sfrido in più (%)'), sf,
    el('small', {}, 'Vuoto = quello consigliato per la posa: 10% dritta e sfalsata, 15% spina di pesce e diagonale.')));
  const table = el('table', { class: 'computo-table' });
  body.append(table);
  const m2 = (x: number) => fmtDec(x, 2);
  let tsv = '';
  const draw = () => {
    const n = parseFloat(sf.value.replace(',', '.'));
    const sfrido = Number.isFinite(n) && n >= 0 ? n : undefined;
    table.innerHTML = '';
    const head = ['Locale', 'Cosa', 'Piastrella', 'm²', 'Sfrido', 'Pezzi', 'Scatole'];
    table.append(el('tr', {}, ...head.map(x => el('th', {}, x))));
    const lines = [head];
    const tot = new Map<string, { m2: number; pcs: number; boxes: number; noBox: boolean }>();
    for (const r of rooms) {
      const q = roomComputo(doc, r, sfrido);
      for (const [what, x] of [['Pavimento', q.floor], ['Rivestimento', q.clad]] as const) {
        if (!x) continue;
        const desc = describeTiles(x.t, um) + (what === 'Rivestimento' ? `, alto ${fmtDec((q.clad!.t.hgt * um) / 10, 0)} cm` : '');
        const row = [r.name || 'Locale', what, desc, m2(x.m2), `${x.sfrido}%`, String(x.pcs), x.boxes === undefined ? '—' : String(x.boxes)];
        lines.push(row);
        table.append(el('tr', {}, ...row.map((c, i) => el('td', i >= 3 ? { class: 'num' } : {}, c))));
        // totali per formato e colore uguali: è quello che si ordina
        const key = `${describeTiles(x.t, um)} ${x.t.color}`;
        const t = tot.get(key) ?? { m2: 0, pcs: 0, boxes: 0, noBox: false };
        t.m2 += x.m2; t.pcs += x.pcs; if (x.boxes === undefined) t.noBox = true; else t.boxes += x.boxes;
        tot.set(key, t);
      }
    }
    if (tot.size > 1 || rooms.length > 1) {
      table.append(el('tr', { class: 'sep' }, el('th', { colspan: '7' }, 'Totale per piastrella')));
      for (const [k, t] of tot) {
        const row = ['', 'Totale', k.replace(/ #[0-9a-f]{6}$/i, ''), m2(t.m2), '', String(t.pcs), t.noBox ? '—' : String(t.boxes)];
        lines.push(row);
        table.append(el('tr', { class: 'tot' }, ...row.map((c, i) => el('td', i >= 3 ? { class: 'num' } : {}, c))));
      }
    }
    tsv = lines.map(l => l.join(String.fromCharCode(9))).join(String.fromCharCode(10));
  };
  sf.oninput = draw;
  draw();
  modal('Computo dei materiali', body, [
    { label: 'Copia la tabella', onClick: async () => { try { await navigator.clipboard.writeText(tsv); } catch { /* appunti non disponibili */ } return false; } },
    { label: 'Chiudi', primary: true },
  ], true);
}

/** Legge un file di immagine e lo riduce a una dimensione ragionevole per stare dentro il disegno. */
export function readImageFile(file: File, maxSide = 1600): Promise<{ src: string; w: number; h: number } | null> {
  return new Promise(resolve => {
    const rd = new FileReader();
    rd.onerror = () => resolve(null);
    rd.onload = () => {
      const im = new Image();
      im.onerror = () => resolve(null);
      im.onload = () => {
        const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
        const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
        const png = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/svg+xml';
        if (k === 1 && !png && String(rd.result).length < 1_500_000) { resolve({ src: String(rd.result), w, h }); return; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        if (!g) { resolve(null); return; }
        if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
        g.drawImage(im, 0, 0, w, h);
        // Un PNG pesante (una foto, una scansione) passa a JPEG su fondo bianco: l'immagine sta dentro
        // il disegno, e con più di qualche megabyte il salvataggio automatico non ce la farebbe.
        let src = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
        if (png && src.length > 1_000_000) {
          const d = document.createElement('canvas');
          d.width = w; d.height = h;
          const gd = d.getContext('2d')!;
          gd.fillStyle = '#fff'; gd.fillRect(0, 0, w, h);
          gd.drawImage(c, 0, 0);
          src = d.toDataURL('image/jpeg', 0.85);
        }
        resolve({ src, w, h });
      };
      im.src = String(rd.result);
    };
    rd.readAsDataURL(file);
  });
}

/** Apre la scelta di un file di immagine. null se si rinuncia. */
export function pickImageFile(maxSide = 1600): Promise<{ src: string; w: number; h: number } | null> {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png,image/gif,image/webp,image/bmp,image/svg+xml';
    inp.className = 'image-input';
    inp.hidden = true;
    let settled = false;
    const finish = (r: { src: string; w: number; h: number } | null) => { if (!settled) { settled = true; inp.remove(); resolve(r); } };
    inp.onchange = () => { const f = inp.files?.[0]; if (f) void readImageFile(f, maxSide).then(finish); else finish(null); };
    inp.addEventListener('cancel', () => finish(null));
    document.body.append(inp);
    inp.click();
  });
}

// ---------------------------------------------------------------- impostazioni

/**
 * Chiede in che unità sono le misure di un file importato, mostrando quanto misurerebbe il disegno
 * in ciascun caso. null = importazione annullata.
 */
export function importUnitsDialog(name: string, declared: Units | null, size: { w: number; h: number }, suggested: Units): Promise<Units | null> {
  return new Promise(resolve => {
    let done = false;
    const fmt = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toPrecision(2)).replace('.', ',');
    const body = el('div', { class: 'units-choice' });
    body.append(el('p', {}, declared
      ? `Il file dichiara le misure in ${UNIT_LABEL[declared]}, ma spesso questa indicazione è sbagliata. Scegliere l'unità con cui il disegno ha le dimensioni giuste.`
      : 'Il file non dichiara le unità. Scegliere quella con cui il disegno ha le dimensioni giuste.'));
    const radios = new Map<Units, HTMLInputElement>();
    for (const u of ['mm', 'cm', 'm'] as Units[]) {
      const k = { mm: 0.001, cm: 0.01, m: 1 }[u];
      const r = el('input', { type: 'radio', name: 'import-units', value: u });
      r.checked = u === suggested;
      radios.set(u, r);
      body.append(el('label', { class: 'radio-row' }, r, el('span', {}, el('b', {}, UNIT_LABEL[u]), ` — il disegno misura ${fmt(size.w * k)} × ${fmt(size.h * k)} m${u === declared ? ' (dichiarata nel file)' : ''}`)));
    }
    modal(`Unità di ${name}`, body, [
      { label: 'Annulla', onClick: () => { done = true; resolve(null); } },
      { label: 'Importa', primary: true, onClick: () => { done = true; resolve([...radios].find(([, r]) => r.checked)?.[0] ?? suggested); } },
    ]);
    const root = document.getElementById('dialog-root')!;
    const obs = new MutationObserver(() => { if (!root.querySelector('.modal')) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(root, { childList: true });
  });
}

export function settingsDialog(doc: Doc, snap: SnapSettings, onSave: (s: Settings, convert: boolean) => void) {
  const s = { ...doc.settings };
  const body = el('div', { class: 'form-grid' });
  // come si lavora: è la prima cosa, perché cambia come si comportano tutti i comandi
  const mode = el('select', { name: 'cmd-mode' });
  mode.append(el('option', { value: 'dialogs' }, 'Con le finestre: ogni comando apre le sue impostazioni'), el('option', { value: 'cmdline' }, 'Solo riga di comando, come in AutoCAD'));
  mode.value = dialogsOn() ? 'dialogs' : 'cmdline';
  body.append(el('label', { class: 'field span2' }, el('span', {}, 'Modo di lavorare'), mode,
    el('small', {}, 'Con le finestre, MURO, TRATTEGGIO, INSERISCI, PORTA, TESTO, OFFSET, SERIE… chiedono spessori, retini, misure in una finestra, e le domande sì/no hanno i pulsanti. Con la riga di comando i valori si scrivono sotto, con le opzioni fra parentesi. Vale per questo browser, per tutti i disegni.')));
  const num = (label: string, key: keyof Settings, hint = '') => {
    const i = el('input', { type: 'text', value: String(s[key]).replace('.', ',') });
    i.onchange = () => {
      const n = parseFloat(i.value.replace(',', '.'));
      if (Number.isFinite(n) && n >= 0) (s as unknown as Record<string, number>)[key] = n;
    };
    body.append(el('label', { class: 'field' }, el('span', {}, label), i, hint ? el('small', {}, hint) : ''));
  };
  const units = el('select', { name: 'units' });
  for (const u of ['mm', 'cm', 'm'] as Units[]) units.append(el('option', { value: u }, UNIT_LABEL[u]));
  units.value = s.units;
  body.append(el('label', { class: 'field' }, el('span', {}, 'Unità del disegno'), units, el('small', {}, 'L\'unità in cui si digitano e si leggono le misure.')));
  const how = el('select');
  how.append(el('option', { value: 'convert' }, 'Converti: le misure reali restano uguali'), el('option', { value: 'keep' }, 'Lascia i numeri come sono'));
  const howField = el('label', { class: 'field span2' }, el('span', {}, 'Al cambio di unità'), how,
    el('small', {}, 'Converti: un muro di 500 cm diventa di 5 m, e si adeguano anche spessori, testi, griglia e i valori qui sotto. Lascia i numeri: 500 cm diventano 500 m; serve solo se il disegno era stato fatto con l\'unità sbagliata.'));
  howField.style.display = 'none';
  units.onchange = () => { s.units = units.value as Units; howField.style.display = s.units === doc.settings.units ? 'none' : ''; };
  body.append(howField);
  num('Passo griglia', 'grid');
  num('Passo snap (F9)', 'snap');
  num('Altezza testo', 'textH');
  num('Altezza testo quote', 'dimH');
  num('Decimali quote (al massimo)', 'dimDec');
  const zeros = el('select', { name: 'dim-zeros' });
  zeros.append(el('option', { value: 'false' }, 'Solo se servono: 300 · 152,5'), el('option', { value: 'true' }, 'Sempre tutti: 300,0 · 152,5'));
  zeros.value = String(!!s.dimZeros);
  zeros.onchange = () => { s.dimZeros = zeros.value === 'true'; };
  body.append(el('label', { class: 'field' }, el('span', {}, 'Decimali delle quote'), zeros));
  const arrows = el('select');
  arrows.append(el('option', { value: 'false' }, 'Tratti obliqui'), el('option', { value: 'true' }, 'Frecce'));
  arrows.value = String(!!s.dimArrow);
  arrows.onchange = () => { s.dimArrow = arrows.value === 'true'; };
  body.append(el('label', { class: 'field' }, el('span', {}, 'Stile delle quote'), arrows));
  num('Spessore muro', 'wallTh');
  num('Larghezza porta', 'doorW');
  num('Larghezza finestra', 'windowW');
  num('Passo tratteggio', 'hatchSp');
  num('Scala tipi di linea', 'ltScale');
  num('Altezza muri (3D)', 'wallH');
  num('Altezza porte (3D)', 'doorH');
  num('Davanzale finestre (3D)', 'winSill');
  num('Altezza finestre (3D)', 'winH');

  const polar = el('select');
  for (const a of [5, 10, 15, 22.5, 30, 45, 90]) polar.append(el('option', { value: String(a) }, `${String(a).replace('.', ',')}°`));
  polar.value = String(snap.polarInc);
  body.append(el('label', { class: 'field' }, el('span', {}, 'Incremento polare (F10)'), polar));

  const modes = el('div', { class: 'checks' });
  const kinds: SnapKind[] = ['end', 'mid', 'cen', 'quad', 'int', 'perp', 'ins', 'near'];
  const boxes = new Map<SnapKind, HTMLInputElement>();
  for (const k of kinds) {
    const c = el('input', { type: 'checkbox' });
    c.checked = snap.modes.has(k);
    boxes.set(k, c);
    modes.append(el('label', {}, c, ` ${SNAP_LABEL[k]}`));
  }
  body.append(el('div', { class: 'field span2' }, el('span', {}, 'Snap ad oggetto (F3)'), modes));

  modal('Impostazioni', body, [
    { label: 'Annulla' },
    {
      label: 'Salva', primary: true, onClick: () => {
        setDialogsOn(mode.value === 'dialogs');
        snap.modes = new Set(kinds.filter(k => boxes.get(k)!.checked));
        snap.polarInc = parseFloat(polar.value);
        // valori che romperebbero il disegno: decimali fuori misura, spessori e altezze a zero
        s.dimDec = Math.min(8, Math.max(0, Math.round(s.dimDec)));
        for (const k of ['textH', 'dimH', 'wallTh', 'doorW', 'windowW', 'hatchSp', 'grid', 'ltScale', 'wallH', 'doorH', 'winH'] as const) if (!(s[k] > 0)) s[k] = doc.settings[k];
        onSave(s, how.value === 'convert');
      },
    },
  ], true);
}

// ---------------------------------------------------------------- aiuto

export function helpDialog() {
  const body = el('div', { class: 'help' });
  body.append(el('p', { class: 'muted' }, `${VERSION_LONG}.`));
  const groups = new Map<string, typeof COMMANDS>();
  for (const c of COMMANDS) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group)!.push(c);
  }
  for (const [g, list] of groups) {
    const t = el('table');
    t.append(el('tr', {}, el('th', {}, g), el('th', {}, 'Comando e alias'), el('th', {}, 'Tasti')));
    for (const c of list) t.append(el('tr', {}, el('td', {}, c.label), el('td', { class: 'mono' }, [c.name, ...c.aliases].join(', ')), el('td', {}, c.keys ?? '')));
    body.append(t);
  }
  body.append(el('h4', {}, 'Coordinate e tasti'));
  const tips = [
    ['x,y', 'punto assoluto'], ['@dx,dy', 'relativo all\'ultimo punto'], ['@d<a', 'polare relativo (distanza < angolo in gradi)'],
    ['250', 'distanza diretta lungo la direzione del cursore'], ['Invio / Spazio / clic destro', 'conferma, chiude il comando o ripete l\'ultimo'],
    ['Esc', 'annulla il comando e la selezione'], ['F3', 'snap ad oggetto'], ['F7', 'griglia'], ['F8', 'orto'], ['F9', 'snap alla griglia'], ['F10', 'puntamento polare'],
    ['Rotella', 'zoom; premuta e trascinata = pan; doppio clic = zoom estensioni'],
    ['Selezione', 'da sinistra a destra = finestra (solo ciò che è dentro); da destra a sinistra = intersezione; Maiusc+clic toglie'],
    ['Grip', 'clic su un quadratino blu della selezione per stirarlo'],
    ['Testi', 'si scrivono in un riquadro: Invio va a capo, Ctrl+Invio conferma; doppio clic su un testo per modificarlo'],
    ['File base', 'NUOVODA apre un disegno come copia senza nome: salvando si crea un file nuovo e il file base resta com\'è'],
  ];
  const t = el('table');
  for (const [k, d] of tips) t.append(el('tr', {}, el('td', { class: 'mono' }, k), el('td', {}, d)));
  body.append(t);
  modal('Comandi e scorciatoie', body, [{ label: 'Chiudi', primary: true }], true);
}

// ---------------------------------------------------------------- stampa

const PRINT_KEY = 'planimetrie.stampa';

// Le scritte del cartiglio non stanno qui: sono del disegno (doc.cartiglio) e si salvano con lui.
interface SavedPrint { paper: Paper; landscape: boolean; scale: number; mono: boolean; lineweights: boolean; wallFill: WallFill; title: boolean; logo?: string }

function loadPrint(): SavedPrint {
  const def: SavedPrint = { paper: 'A3', landscape: true, scale: 100, mono: true, lineweights: true, wallFill: 'grigio', title: true };
  try {
    const s = JSON.parse(localStorage.getItem(PRINT_KEY) ?? 'null');
    if (s) { delete s.fields; return { ...def, ...s }; } // "fields": le scritte che le versioni fino alla 0.3 tenevano qui
  } catch { /* preferenze non disponibili */ }
  return def;
}

export interface PrintArea { kind: 'ext' | 'view' | 'win'; box: Box }

export interface PrintAreas {
  ext: Box | null;
  view: Box;
  win: Box | null;
  /** la finestra è stata appena scelta sul disegno */
  winNew?: boolean;
  /** oggetti selezionati al momento della stampa */
  sel?: { box: Box; ids: Set<number> } | null;
}

export function printDialog(doc: Doc, areas: PrintAreas, pickWindow: () => void) {
  const o = loadPrint();
  let areaKind: 'ext' | 'view' | 'win' | 'sel' = areas.win ? 'win' : areas.ext ? 'ext' : 'view';
  // una finestra appena scelta si stampa grande quanto il foglio permette; la scala si può poi cambiare
  if (areas.winNew) o.scale = 0;
  const body = el('div', { class: 'print-layout' });
  const form = el('div', { class: 'print-form' });
  const preview = el('div', { class: 'print-preview' });
  const info = el('div', { class: 'print-info' });

  const sel = (label: string, opts: [string, string][], val: string, on: (v: string) => void) => {
    const s = el('select');
    for (const [k, l] of opts) s.append(el('option', { value: k }, l));
    s.value = val;
    s.onchange = () => { on(s.value); update(); };
    form.append(el('label', { class: 'field' }, el('span', {}, label), s));
    return s;
  };
  sel('Foglio', (Object.keys(PAPERS) as Paper[]).map(p => [p, `${p} (${PAPERS[p][0]}×${PAPERS[p][1]} mm)`]), o.paper, v => { o.paper = v as Paper; });
  sel('Orientamento', [['1', 'Orizzontale'], ['0', 'Verticale']], o.landscape ? '1' : '0', v => { o.landscape = v === '1'; });
  sel('Scala', [['0', 'Adatta al foglio (scala standard)'], ...STD_SCALES.map(s => [String(s), `1:${s}`] as [string, string])], String(o.scale), v => { o.scale = parseInt(v, 10); });
  const areaOpts: [string, string][] = [['view', 'Vista corrente']];
  if (areas.ext) areaOpts.unshift(['ext', 'Tutto il disegno (estensioni)']);
  if (areas.win) areaOpts.push(['win', 'Finestra scelta']);
  if (areas.sel) areaOpts.push(['sel', `Solo gli oggetti selezionati (${areas.sel.ids.size})`]);
  sel('Area da stampare', areaOpts, areaKind, v => { areaKind = v as typeof areaKind; });
  const winBtn = el('button', { class: 'small' }, areas.win ? 'Cambia finestra sul disegno…' : 'Scegli finestra sul disegno…');
  winBtn.onclick = () => { m.close(); pickWindow(); };
  form.append(winBtn);
  sel('Colori', [['1', 'Monocromatico (nero)'], ['0', 'Colori dei layer']], o.mono ? '1' : '0', v => { o.mono = v === '1'; });
  sel('Spessori di linea', [['1', 'Dai layer'], ['0', 'Tutte sottili']], o.lineweights ? '1' : '0', v => { o.lineweights = v === '1'; });
  sel('Muri', [['grigio', 'Campitura grigia'], ['nero', 'Campitura nera'], ['vuoto', 'Solo contorno']], o.wallFill, v => { o.wallFill = v as WallFill; });
  sel('Cartiglio', [['1', 'Sì'], ['0', 'No']], o.title ? '1' : '0', v => { o.title = v === '1'; });

  const fields: TitleFields = { ...doc.cartiglio };
  let pending = false;
  const fl: [keyof TitleFields, string][] = [['cliente', 'Nome cliente'], ['posa', 'Posa gres'], ['note', 'Note']];
  const tf = el('div', { class: 'title-fields' });
  for (const [k, label] of fl) {
    // caselle a più righe: Invio va a capo e la casella cresce con il testo
    const i = growArea(fields[k], k === 'note' ? 3 : 1);
    // il disegno si aggiorna insieme all'anteprima, non a ogni tasto
    i.oninput = () => { fields[k] = i.value; pending = true; schedule(); };
    tf.append(el('label', { class: 'field' }, el('span', {}, label), i));
  }
  tf.append(el('small', {}, 'Invio va a capo. Queste scritte si salvano insieme al disegno.'));
  form.append(tf);
  // logo nel cartiglio
  const logoBtn = el('button', { class: 'small' }, o.logo ? 'Cambia logo…' : 'Aggiungi logo (JPG, PNG)…');
  const logoOff = el('button', { class: 'small' }, 'Togli logo');
  logoOff.style.display = o.logo ? '' : 'none';
  logoBtn.onclick = async () => {
    const im = await pickImageFile(400);
    if (!im) return;
    o.logo = im.src;
    logoBtn.textContent = 'Cambia logo…';
    logoOff.style.display = '';
    update();
  };
  logoOff.onclick = () => { delete o.logo; logoBtn.textContent = 'Aggiungi logo (JPG, PNG)…'; logoOff.style.display = 'none'; update(); };
  form.append(el('div', { class: 'field' }, el('span', {}, 'Logo nel cartiglio'), el('span', { class: 'inline' }, logoBtn, logoOff)));
  body.append(form, el('div', { class: 'print-right' }, preview, info));

  let current = '';
  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = window.setTimeout(update, 200); };
  const opts = (): PrintOpts => ({
    ...o,
    fields,
    area: areaKind === 'win' && areas.win ? areas.win : areaKind === 'sel' && areas.sel ? areas.sel.box : areaKind === 'ext' && areas.ext ? areas.ext : areas.view,
    clip: areaKind === 'win',
    only: areaKind === 'sel' ? areas.sel?.ids : undefined,
  });
  function update() {
    if (pending) { pending = false; doc.setCartiglio(fields); }
    const sh = buildSheet(doc, opts());
    current = sh.svg;
    preview.innerHTML = sh.svg;
    const svg = preview.querySelector('svg')!;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    info.textContent = sh.fits
      ? `Scala 1:${sh.scale} — il disegno entra nel foglio ${o.paper}.`
      : `Attenzione: alla scala 1:${sh.scale} il disegno esce dal foglio e verrà tagliato.`;
    info.className = 'print-info' + (sh.fits ? '' : ' warn');
    try { localStorage.setItem(PRINT_KEY, JSON.stringify(o)); } catch {
      // spazio finito (il logo pesa): almeno i campi del cartiglio restano ricordati
      try { localStorage.setItem(PRINT_KEY, JSON.stringify({ ...o, logo: undefined })); } catch { /* preferenze non salvate */ }
    }
    lastSize = [sh.w, sh.h];
  }
  let lastSize: [number, number] = [0, 0];

  const m = modal('Stampa', body, [
    {
      label: 'Scarica SVG', onClick: () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([current], { type: 'image/svg+xml' }));
        a.download = `${fields.cliente.split('\n')[0].replace(/[\\/:*?"<>|]/g, ' ').trim() || 'tavola'}.svg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return false;
      },
    },
    { label: 'Chiudi' },
    { label: 'Stampa / Salva PDF', primary: true, onClick: () => { printSvg(current, lastSize[0], lastSize[1]); } },
  ], true);
  update();
}

export function printSvg(svg: string, w: number, h: number) {
  const root = document.getElementById('print-root')!;
  root.innerHTML = svg;
  let st = document.getElementById('page-style') as HTMLStyleElement | null;
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.append(st); }
  st.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
  const clean = () => { root.innerHTML = ''; window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean);
  setTimeout(() => window.print(), 50);
}
