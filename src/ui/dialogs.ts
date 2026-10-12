// Finestre di dialogo.
import type { Doc, Settings, Units } from '../model/document';
import { UNIT_LABEL } from '../model/document';
import type { SnapKind } from '../model/entities';
import type { SnapSettings } from '../view/snap';
import { SNAP_LABEL } from '../view/snap';
import { COMMANDS } from './commands';
import { VERSION_LONG } from './logo';
import type { Box } from '../model/geom';
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
  const num = (label: string, key: keyof Settings, hint = '') => {
    const i = el('input', { type: 'text', value: String(s[key]).replace('.', ',') });
    i.onchange = () => {
      const n = parseFloat(i.value.replace(',', '.'));
      if (Number.isFinite(n) && n >= 0) (s as unknown as Record<string, number>)[key] = n;
    };
    body.append(el('label', { class: 'field' }, el('span', {}, label), i, hint ? el('small', {}, hint) : ''));
  };
  const units = el('select');
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
  num('Decimali quote', 'dimDec');
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
        snap.modes = new Set(kinds.filter(k => boxes.get(k)!.checked));
        snap.polarInc = parseFloat(polar.value);
        // valori che romperebbero il disegno: decimali fuori misura, spessori e altezze a zero
        s.dimDec = Math.min(8, Math.max(0, Math.round(s.dimDec)));
        for (const k of ['textH', 'dimH', 'wallTh', 'doorW', 'windowW', 'hatchSp', 'grid', 'ltScale'] as const) if (!(s[k] > 0)) s[k] = doc.settings[k];
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
  ];
  const t = el('table');
  for (const [k, d] of tips) t.append(el('tr', {}, el('td', { class: 'mono' }, k), el('td', {}, d)));
  body.append(t);
  modal('Comandi e scorciatoie', body, [{ label: 'Chiudi', primary: true }], true);
}

// ---------------------------------------------------------------- stampa

const PRINT_KEY = 'planimetrie.stampa';

interface SavedPrint { paper: Paper; landscape: boolean; scale: number; mono: boolean; lineweights: boolean; wallFill: WallFill; title: boolean; fields: TitleFields; logo?: string }

function loadPrint(): SavedPrint {
  const def: SavedPrint = {
    paper: 'A3', landscape: true, scale: 100, mono: true, lineweights: true, wallFill: 'grigio', title: true,
    fields: { progetto: '', titolo: 'Pianta', committente: '', indirizzo: '', disegnatore: '', data: new Date().toLocaleDateString('it-IT'), tavola: '1' },
  };
  try {
    const s = JSON.parse(localStorage.getItem(PRINT_KEY) ?? 'null');
    if (s) return { ...def, ...s, fields: { ...def.fields, ...s.fields, data: def.fields.data } }; // la data riparte sempre da oggi
  } catch { /* preferenze non disponibili */ }
  return def;
}

export interface PrintArea { kind: 'ext' | 'view' | 'win'; box: Box }

export function printDialog(doc: Doc, areas: { ext: Box | null; view: Box; win: Box | null }, pickWindow: () => void) {
  const o = loadPrint();
  let areaKind: 'ext' | 'view' | 'win' = areas.win ? 'win' : areas.ext ? 'ext' : 'view';
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
  sel('Area da stampare', areaOpts, areaKind, v => { areaKind = v as typeof areaKind; });
  const winBtn = el('button', { class: 'small' }, 'Scegli finestra sul disegno…');
  winBtn.onclick = () => { m.close(); pickWindow(); };
  form.append(winBtn);
  sel('Colori', [['1', 'Monocromatico (nero)'], ['0', 'Colori dei layer']], o.mono ? '1' : '0', v => { o.mono = v === '1'; });
  sel('Spessori di linea', [['1', 'Dai layer'], ['0', 'Tutte sottili']], o.lineweights ? '1' : '0', v => { o.lineweights = v === '1'; });
  sel('Muri', [['grigio', 'Campitura grigia'], ['nero', 'Campitura nera'], ['vuoto', 'Solo contorno']], o.wallFill, v => { o.wallFill = v as WallFill; });
  sel('Cartiglio', [['1', 'Sì'], ['0', 'No']], o.title ? '1' : '0', v => { o.title = v === '1'; });

  const fl: [keyof TitleFields, string][] = [['progetto', 'Progetto'], ['titolo', 'Oggetto'], ['committente', 'Committente'], ['indirizzo', 'Indirizzo'], ['disegnatore', 'Disegnatore'], ['data', 'Data'], ['tavola', 'Tavola']];
  const tf = el('div', { class: 'title-fields' });
  for (const [k, label] of fl) {
    const i = el('input', { type: 'text', value: o.fields[k] });
    i.oninput = () => { o.fields[k] = i.value; schedule(); };
    tf.append(el('label', { class: 'field' }, el('span', {}, label), i));
  }
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
    area: areaKind === 'win' && areas.win ? areas.win : areaKind === 'ext' && areas.ext ? areas.ext : areas.view,
  });
  function update() {
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
        a.download = `${o.fields.titolo || 'tavola'}.svg`;
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
