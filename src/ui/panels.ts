// Pannelli laterali: proprietà della selezione e layer.
import type { Ent, HatchPattern, HAlign } from '../model/entities';
import { TYPE_NAMES, HATCH_NAMES, roomArea, dimValue, fmtNum } from '../model/entities';
import type { Doc, Layer, LineType } from '../model/document';
import { LT_NAMES, UNIT_MM } from '../model/document';
import { dist, angleOf, polygonArea } from '../model/geom';
import { askText, confirmBox } from './dialogs';

const LW_LIST = [0.05, 0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else el.setAttribute(k, v);
  }
  for (const c of kids) el.append(c);
  return el;
}

/** Numero con al più tre decimali, senza zeri finali dopo la virgola (40 resta 40; 0,250 diventa 0,25). */
export const fmt = (x: number): string => {
  const r = Math.round(x * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : fmtNum(r, 3).replace(/0+$/, '');
};
const parse = (s: string) => {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

interface Field {
  label: string;
  kind: 'num' | 'text' | 'ro' | 'select' | 'bool' | 'button';
  get?: (e: Ent) => string | number | boolean;
  set?: (e: Ent, v: string) => Ent | null;
  options?: [string, string][];
  single?: boolean;
}

function fieldsFor(type: Ent['t'], doc: Doc): Field[] {
  const u = doc.settings.units;
  const toM2 = (UNIT_MM[u] / 1000) ** 2;
  const numSet = (key: string, min = 0) => (e: Ent, v: string) => {
    const n = parse(v);
    return n === null || n <= min ? null : ({ ...e, [key]: n } as Ent);
  };
  switch (type) {
    case 'line': return [
      { label: 'Lunghezza', kind: 'ro', single: true, get: e => e.t === 'line' ? fmt(dist(e.a, e.b)) : '' },
      { label: 'Angolo', kind: 'ro', single: true, get: e => e.t === 'line' ? `${fmt(((angleOf(e.a, e.b) * 180) / Math.PI + 360) % 360)}°` : '' },
    ];
    case 'wall': return [
      { label: 'Spessore', kind: 'num', get: e => (e.t === 'wall' ? e.th : 0), set: numSet('th') },
      { label: 'Lunghezza', kind: 'ro', single: true, get: e => e.t === 'wall' ? fmt(dist(e.a, e.b)) : '' },
    ];
    case 'door': return [
      { label: 'Larghezza', kind: 'num', get: e => (e.t === 'door' ? e.w : 0), set: numSet('w') },
      { label: 'Inverti verso', kind: 'button', set: e => (e.t === 'door' ? { ...e, sw: (-e.sw) as 1 | -1 } : null) },
      { label: 'Inverti cerniera', kind: 'button', set: e => (e.t === 'door' ? { ...e, hg: (-e.hg) as 1 | -1 } : null) },
    ];
    case 'window': return [{ label: 'Larghezza', kind: 'num', get: e => (e.t === 'window' ? e.w : 0), set: numSet('w') }];
    case 'circle': case 'arc': return [{ label: 'Raggio', kind: 'num', get: e => (e.t === 'circle' || e.t === 'arc' ? e.r : 0), set: numSet('r') }];
    case 'text': return [
      { label: 'Testo', kind: 'text', get: e => (e.t === 'text' ? e.s : ''), set: (e, v) => (e.t === 'text' && v ? { ...e, s: v.replace(/\\n/g, '\n') } : null) },
      { label: 'Altezza', kind: 'num', get: e => (e.t === 'text' ? e.h : 0), set: numSet('h') },
      { label: 'Rotazione °', kind: 'num', get: e => (e.t === 'text' ? Math.round(((e.rot * 180) / Math.PI) * 1000) / 1000 : 0), set: (e, v) => { const n = parse(v); return n === null || e.t !== 'text' ? null : { ...e, rot: (n * Math.PI) / 180 }; } },
      { label: 'Allineamento', kind: 'select', options: [['l', 'Sinistra'], ['c', 'Centro'], ['r', 'Destra']], get: e => (e.t === 'text' ? e.ha : 'l'), set: (e, v) => (e.t === 'text' ? { ...e, ha: v as HAlign } : null) },
    ];
    case 'dim': return [
      { label: 'Altezza testo', kind: 'num', get: e => (e.t === 'dim' ? e.h ?? doc.settings.dimH : 0), set: numSet('h') },
      { label: 'Misura', kind: 'ro', single: true, get: e => { if (e.t !== 'dim') return ''; const x = dimValue(e); return x === null ? '' : fmt(x) + (e.k === 'ang' ? '°' : ''); } },
      {
        label: 'Testo (vuoto = misura)', kind: 'text', get: e => (e.t === 'dim' ? e.s ?? '' : ''),
        set: (e, v) => { if (e.t !== 'dim') return null; const c = { ...e }; if (v.trim()) c.s = v; else delete c.s; return c; },
      },
    ];
    case 'room': return [
      { label: 'Nome', kind: 'text', get: e => (e.t === 'room' ? e.name : ''), set: (e, v) => (e.t === 'room' ? { ...e, name: v } : null) },
      { label: 'Superficie m²', kind: 'ro', single: true, get: e => (e.t === 'room' ? fmtNum(roomArea(e) * toM2, 2) : '') },
    ];
    case 'point': return [];
    case 'image': return [
      { label: 'Larghezza', kind: 'num', get: e => (e.t === 'image' ? e.w : 0), set: (e, v) => { const n = parse(v); return n === null || n <= 0 || e.t !== 'image' ? null : { ...e, h: (e.h * n) / e.w, w: n }; } },
      { label: 'Altezza', kind: 'ro', single: true, get: e => (e.t === 'image' ? e.h : 0) },
      { label: 'Rotazione °', kind: 'num', get: e => (e.t === 'image' ? Math.round(((e.rot * 180) / Math.PI) * 1000) / 1000 : 0), set: (e, v) => { const n = parse(v); return n === null || e.t !== 'image' ? null : { ...e, rot: (n * Math.PI) / 180 }; } },
    ];
    case 'leader': return [
      { label: 'Testo', kind: 'text', get: e => (e.t === 'leader' ? e.s : ''), set: (e, v) => (e.t === 'leader' ? { ...e, s: v } : null) },
      { label: 'Altezza testo', kind: 'num', get: e => (e.t === 'leader' ? e.h ?? doc.settings.dimH : 0), set: numSet('h') },
    ];
    case 'ellipse': return [
      { label: 'Semiasse', kind: 'ro', single: true, get: e => (e.t === 'ellipse' ? fmt(Math.hypot(e.a.x, e.a.y)) : '') },
      { label: 'Altro semiasse', kind: 'ro', single: true, get: e => (e.t === 'ellipse' ? fmt(Math.hypot(e.a.x, e.a.y) * e.k) : '') },
    ];
    case 'spline': return [
      { label: 'Chiusa', kind: 'bool', get: e => (e.t === 'spline' ? e.closed : false), set: (e, v) => (e.t === 'spline' ? { ...e, closed: v === 'true' } : null) },
      { label: 'Punti', kind: 'ro', single: true, get: e => (e.t === 'spline' ? e.pts.length : '') },
    ];
    case 'insert': return [
      { label: 'Blocco', kind: 'ro', get: e => (e.t === 'insert' ? e.name : '') },
      { label: 'Scala', kind: 'num', get: e => (e.t === 'insert' ? e.s : 0), set: numSet('s') },
      { label: 'Rotazione °', kind: 'num', get: e => (e.t === 'insert' ? Math.round(((e.rot * 180) / Math.PI) * 1000) / 1000 : 0), set: (e, v) => { const n = parse(v); return n === null || e.t !== 'insert' ? null : { ...e, rot: (n * Math.PI) / 180 }; } },
    ];
    case 'hatch': return [
      { label: 'Pattern', kind: 'select', options: Object.entries(HATCH_NAMES) as [string, string][], get: e => (e.t === 'hatch' ? e.pat : ''), set: (e, v) => (e.t === 'hatch' ? { ...e, pat: v as HatchPattern } : null) },
      { label: 'Passo', kind: 'num', get: e => (e.t === 'hatch' ? e.sp : 0), set: numSet('sp') },
      { label: 'Angolo °', kind: 'num', get: e => (e.t === 'hatch' ? Math.round(((e.ang * 180) / Math.PI) * 1000) / 1000 : 0), set: (e, v) => { const n = parse(v); return n === null || e.t !== 'hatch' ? null : { ...e, ang: (n * Math.PI) / 180 }; } },
    ];
    case 'poly': return [
      { label: 'Chiusa', kind: 'bool', get: e => (e.t === 'poly' ? e.closed : false), set: (e, v) => (e.t === 'poly' ? { ...e, closed: v === 'true' } : null) },
      { label: 'Vertici', kind: 'ro', single: true, get: e => (e.t === 'poly' ? e.pts.length : '') },
      { label: 'Area', kind: 'ro', single: true, get: e => (e.t === 'poly' && e.closed ? `${fmtNum(Math.abs(polygonArea(e.pts)) * toM2, 2)} m²` : '—') },
    ];
  }
}

export class Panels {
  constructor(private doc: Doc, private getSel: () => Set<number>, private propsEl: HTMLElement, private layersEl: HTMLElement, private onCurrent: () => void) {}

  refresh() {
    this.renderProps();
    this.renderLayers();
  }

  // ---------------------------------------------------------------- proprietà

  private layerSelect(value: string | null, onChange: (v: string) => void): HTMLSelectElement {
    const s = h('select');
    if (value === null) s.append(h('option', { value: '' }, '— vari —'));
    for (const l of this.doc.layers) s.append(h('option', { value: l.name }, l.name));
    s.value = value ?? '';
    s.onchange = () => { if (s.value) onChange(s.value); };
    return s;
  }

  renderProps() {
    const el = this.propsEl;
    el.innerHTML = '';
    const doc = this.doc;
    const sel = doc.ents.filter(e => this.getSel().has(e.id));
    if (!sel.length) {
      el.append(h('div', { class: 'muted' }, 'Nessuna selezione'));
      const row = h('label', { class: 'prop' }, h('span', {}, 'Layer corrente'));
      row.append(this.layerSelect(doc.current, v => { doc.current = v; this.onCurrent(); this.refresh(); }));
      el.append(row);
      return;
    }
    const counts = new Map<string, number>();
    for (const e of sel) counts.set(TYPE_NAMES[e.t], (counts.get(TYPE_NAMES[e.t]) ?? 0) + 1);
    el.append(h('div', { class: 'sel-summary' }, `${sel.length} selezionat${sel.length === 1 ? 'a' : 'e'}: ` + [...counts].map(([k, n]) => `${n} ${k}`).join(', ')));

    const layers = new Set(sel.map(e => e.layer));
    const lrow = h('label', { class: 'prop' }, h('span', {}, 'Layer'));
    lrow.append(this.layerSelect(layers.size === 1 ? sel[0].layer : null, v => doc.edit('Cambia layer', () => doc.replace(sel.map(e => ({ ...e, layer: v }) as Ent)))));
    el.append(lrow);

    const colors = new Set(sel.map(e => e.color ?? ''));
    const crow = h('div', { class: 'prop' }, h('span', {}, 'Colore'));
    const byLayer = colors.size === 1 && !sel[0].color;
    const cin = h('input', { type: 'color', value: colors.size === 1 && sel[0].color ? sel[0].color : doc.layer(sel[0].layer).color });
    cin.onchange = () => doc.edit('Colore', () => doc.replace(sel.map(e => ({ ...e, color: cin.value }) as Ent)));
    const bl = h('button', { class: 'small' + (byLayer ? ' on' : ''), title: 'Usa il colore del layer' }, 'DaLayer');
    bl.onclick = () => doc.edit('Colore DaLayer', () => doc.replace(sel.map(e => { const c = { ...e } as Ent; delete c.color; return c; })));
    crow.append(h('span', { class: 'inline' }, cin, bl));
    el.append(crow);

    // tipo di linea e spessore propri dell'entità; "DaLayer" li toglie
    const own = (label: string, key: 'lt' | 'lw', choices: [string, string][]) => {
      const row = h('label', { class: 'prop' }, h('span', {}, label));
      const vals = new Set(sel.map(e => String(e[key] ?? '')));
      const s = h('select');
      if (vals.size > 1) s.append(h('option', { value: '*' }, '— vari —'));
      s.append(h('option', { value: '' }, 'DaLayer'));
      for (const [k, lab] of choices) s.append(h('option', { value: k }, lab));
      s.value = vals.size === 1 ? [...vals][0] : '*';
      s.onchange = () => {
        if (s.value === '*') return;
        const val = s.value;
        doc.edit(label, () => doc.replace(sel.filter(e => doc.isEditable(e)).map(e => {
          const c = { ...e } as Ent;
          if (!val) delete c[key];
          else if (key === 'lt') c.lt = val as LineType;
          else c.lw = parseFloat(val);
          return c;
        })));
      };
      row.append(s);
      el.append(row);
    };
    own('Tipo linea', 'lt', Object.entries(LT_NAMES));
    own('Spessore', 'lw', LW_LIST.map(w => [String(w), w.toFixed(2)]));

    const types = new Set(sel.map(e => e.t));
    if (types.size !== 1) return;
    for (const f of fieldsFor(sel[0].t, doc)) {
      if (f.single && sel.length > 1) continue;
      const row = h('label', { class: 'prop' }, h('span', {}, f.label));
      const vals = new Set(sel.map(e => String(f.get?.(e) ?? '')));
      const same = vals.size === 1;
      const val = same ? [...vals][0] : '';
      const apply = (v: string) => {
        const out = sel.filter(e => doc.isEditable(e)).map(e => f.set!(e, v)).filter((x): x is Ent => !!x);
        if (out.length) doc.edit(`Proprietà: ${f.label}`, () => doc.replace(out));
        else this.renderProps(); // valore non valido o layer bloccato: il campo torna a mostrare quello vero
      };
      if (f.kind === 'ro') row.append(h('span', { class: 'ro' }, same ? (typeof f.get?.(sel[0]) === 'number' ? fmt(Number(val)) : val) : '— vari —'));
      else if (f.kind === 'button') {
        const b = h('button', { class: 'small' }, f.label);
        b.onclick = e => { e.preventDefault(); apply(''); };
        row.firstChild!.textContent = '';
        row.append(b);
      } else if (f.kind === 'select') {
        const s = h('select');
        if (!same) s.append(h('option', { value: '' }, '— vari —'));
        for (const [k, lab] of f.options!) s.append(h('option', { value: k }, lab));
        s.value = val;
        s.onchange = () => s.value && apply(s.value);
        row.append(s);
      } else if (f.kind === 'bool') {
        const c = h('input', { type: 'checkbox' });
        c.checked = val === 'true';
        c.onchange = () => apply(String(c.checked));
        row.append(c);
      } else {
        const i = h('input', { type: 'text', value: same ? (f.kind === 'num' ? fmt(Number(val)) : val.replace(/\n/g, '\\n')) : '', placeholder: same ? '' : '— vari —' });
        i.onchange = () => apply(i.value);
        i.onkeydown = ev => { if (ev.key === 'Enter') { (ev.target as HTMLInputElement).blur(); } ev.stopPropagation(); };
        row.append(i);
      }
      el.append(row);
    }
  }

  // ---------------------------------------------------------------- layer

  renderLayers() {
    const el = this.layersEl;
    const doc = this.doc;
    el.innerHTML = '';
    const counts = new Map<string, number>();
    for (const e of doc.ents) counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);
    // anche ciò che sta dentro i blocchi usa i layer: altrimenti "Elimina vuoti" li toglierebbe
    for (const b of Object.values(doc.blocks)) for (const e of b.ents) counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);
    const table = h('div', { class: 'layer-list' });
    for (const l of doc.layers) table.append(this.layerRow(l, counts.get(l.name) ?? 0));
    const tools = h('div', { class: 'layer-tools' });
    const add = h('button', { class: 'small', title: 'Nuovo layer' }, '+ Nuovo');
    add.onclick = async () => {
      const name = (await askText('Nuovo layer', 'Nome del layer', `Layer${doc.layers.length}`))?.trim();
      if (!name) return;
      if (doc.layers.some(x => x.name.toLowerCase() === name.toLowerCase())) { alert('Esiste già un layer con questo nome.'); return; }
      doc.edit('Nuovo layer', () => { doc.ensureLayer(name, { color: '#ffffff' }); doc.current = name; });
      this.onCurrent();
    };
    const purge = h('button', { class: 'small', title: 'Elimina i layer senza entità' }, 'Elimina vuoti');
    purge.onclick = () => {
      const empty = doc.layers.filter(l => l.name !== '0' && l.name !== doc.current && !counts.get(l.name));
      if (!empty.length) return;
      doc.edit('Elimina layer vuoti', () => { doc.layers = doc.layers.filter(l => !empty.includes(l)); });
    };
    tools.append(add, purge);
    el.append(tools, table);
  }

  private layerRow(l: Layer, n: number): HTMLElement {
    const doc = this.doc;
    const row = h('div', { class: 'layer-row' + (l.name === doc.current ? ' current' : ''), title: `${n} entità` });
    const upd = (label: string, fn: () => void) => doc.edit(label, fn);
    const eye = h('button', { class: 'icon-btn' + (l.visible ? '' : ' off'), title: l.visible ? 'Nascondi' : 'Mostra' }, l.visible ? '●' : '○');
    eye.onclick = e => { e.stopPropagation(); upd('Visibilità layer', () => { l.visible = !l.visible; }); };
    const lock = h('button', { class: 'icon-btn' + (l.locked ? ' on' : ''), title: l.locked ? 'Sblocca' : 'Blocca' }, l.locked ? '🔒' : '🔓');
    lock.onclick = e => { e.stopPropagation(); upd('Blocco layer', () => { l.locked = !l.locked; }); };
    const color = h('input', { type: 'color', value: l.color, title: 'Colore' });
    color.onclick = e => e.stopPropagation();
    color.onchange = () => upd('Colore layer', () => { l.color = color.value; });
    const name = h('span', { class: 'layer-name' }, l.name);
    name.ondblclick = async e => {
      e.stopPropagation();
      if (l.name === '0') return;
      const nn = (await askText('Rinomina layer', 'Nuovo nome', l.name))?.trim();
      if (!nn || nn === l.name || doc.layers.some(x => x.name === nn)) return;
      const old = l.name;
      upd('Rinomina layer', () => {
        l.name = nn;
        const ren = (e2: Ent): Ent => (e2.layer === old ? ({ ...e2, layer: nn } as Ent) : e2);
        doc.ents = doc.ents.map(ren);
        doc.blocks = Object.fromEntries(Object.entries(doc.blocks).map(([k, b]) => [k, { ents: b.ents.map(ren) }]));
        if (doc.editing) doc.editing = { ...doc.editing, ents: doc.editing.ents.map(ren) };
        if (doc.current === old) doc.current = nn;
      });
    };
    const lw = h('select', { title: 'Spessore di stampa (mm)' });
    for (const w of LW_LIST) lw.append(h('option', { value: String(w) }, w.toFixed(2)));
    if (!LW_LIST.includes(l.lw)) lw.append(h('option', { value: String(l.lw) }, l.lw.toFixed(2)));
    lw.value = String(l.lw);
    lw.onclick = e => e.stopPropagation();
    lw.onchange = () => upd('Spessore layer', () => { l.lw = parseFloat(lw.value); });
    const lt = h('select', { title: 'Tipo di linea' });
    for (const [k, lab] of Object.entries(LT_NAMES)) lt.append(h('option', { value: k }, lab));
    lt.value = l.lt;
    lt.onclick = e => e.stopPropagation();
    lt.onchange = () => upd('Tipo linea layer', () => { l.lt = lt.value as LineType; });
    row.onclick = () => { doc.current = l.name; this.onCurrent(); this.renderLayers(); this.renderProps(); };
    const del = h('button', { class: 'icon-btn', title: l.name === '0' ? 'Il layer 0 non si può eliminare' : 'Elimina il layer' }, '✕');
    del.disabled = l.name === '0' || !!doc.editing;
    if (doc.editing) del.title = 'Durante la modifica di un blocco i layer non si eliminano';
    del.onclick = async e => {
      e.stopPropagation();
      const used = doc.layerUse(l.name);
      if (used && !(await confirmBox('Elimina layer', `Il layer ${l.name} contiene ${used} entità: passeranno sul layer 0. Eliminarlo?`, 'Elimina'))) return;
      upd('Elimina layer', () => doc.deleteLayer(l.name));
      this.onCurrent();
    };
    row.append(eye, lock, color, name, lw, lt, del);
    return row;
  }
}
