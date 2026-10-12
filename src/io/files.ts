// Lettura dei file DXF e DWG.
import DxfParser from 'dxf-parser';
import type { Units } from '../model/document';
import { buildImport, fromDxfParser, fromDwgDatabase, ImportResult } from './importer';

function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function merge(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const out = new Map(a);
  for (const [k, n] of b) out.set(k, (out.get(k) ?? 0) + n);
  return out;
}

/** Tipi di entità che dxf-parser sa leggere; gli altri li scarta senza dirlo. */
const DXF_READ = new Set(['3DFACE', 'ARC', 'ATTDEF', 'CIRCLE', 'DIMENSION', 'ELLIPSE', 'INSERT', 'LINE', 'LWPOLYLINE', 'MTEXT', 'POINT', 'POLYLINE', 'SOLID', 'SPLINE', 'TEXT', 'VERTEX', 'SEQEND', 'BLOCK', 'ENDBLK', 'ENDSEC', 'VIEWPORT']);

/** Conta nel testo del DXF le entità dei tipi non letti, per poterle elencare fra i "non importati". */
export function unreadDxfTypes(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  let section = '', expectName = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim(), val = lines[i + 1].trim();
    if (expectName) { if (code === '2') section = val; expectName = false; continue; }
    if (code !== '0') continue;
    if (val === 'SECTION') { expectName = true; continue; }
    if (val === 'ENDSEC') { section = ''; continue; }
    if ((section === 'ENTITIES' || section === 'BLOCKS') && !DXF_READ.has(val)) out.set(val, (out.get(val) ?? 0) + 1);
  }
  return out;
}

export function importDxf(buf: ArrayBuffer, docUnits: Units): ImportResult {
  const text = decodeText(buf);
  if (/^AC10\d\d/.test(text.slice(0, 6)) || text.startsWith('AutoCAD Binary DXF')) {
    throw new Error('DXF binario non supportato: salvarlo come DXF ASCII.');
  }
  const parsed = new DxfParser().parseSync(text);
  if (!parsed) throw new Error('File DXF non leggibile.');
  const { drawing, skipped } = fromDxfParser(parsed);
  const r = buildImport(drawing, docUnits);
  return { ...r, skipped: merge(merge(skipped, r.skipped), unreadDxfTypes(text)) };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let libPromise: Promise<any> | null = null;

async function libredwg(): Promise<any> {
  if (!libPromise) {
    libPromise = (async () => {
      const mod = await import('@mlightcad/libredwg-web');
      if (!__PORTABLE__) return mod.LibreDwg.create();
      const { default: createModule } = await import('libredwg-wasm-module');
      return mod.LibreDwg.createByWasmInstance(await createModule({ wasmBinary: await portableWasm() }));
    })();
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

/**
 * Versione da chiavetta: la pagina è aperta da disco e non può scaricare il .wasm, che arriva
 * invece da uno script accanto a Kalista.html (vedi scripts/chiavetta.mjs).
 */
function portableWasm(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const missing = () => reject(new Error('per leggere i DWG serve il file kalista-dwg.js accanto a Kalista.html.'));
    const s = document.createElement('script');
    s.src = 'kalista-dwg.js';
    s.onerror = missing;
    s.onload = () => {
      const g = window as unknown as { __KALISTA_DWG?: string };
      const b64 = g.__KALISTA_DWG;
      delete g.__KALISTA_DWG;
      s.remove();
      if (!b64) { missing(); return; }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(bytes);
    };
    document.head.append(s);
  });
}

/** Errori LibreDWG da 128 in su: il file non è stato letto. Sotto sono avvisi. */
const DWG_CRITICAL = 128;

/** Legge un DWG con un'istanza LibreDWG già pronta. */
export function readDwgWith(lib: any, buf: ArrayBuffer, docUnits: Units): ImportResult {
  const head = new TextDecoder('ascii').decode(new Uint8Array(buf, 0, Math.min(6, buf.byteLength)));
  if (!head.startsWith('AC10')) throw new Error('Il file non sembra un DWG.');
  const w = lib.wasmInstance;
  const name = 'planimetrie-in.dwg';
  let result: { error: number; data: any };
  w.FS.writeFile(name, new Uint8Array(buf));
  try {
    result = w.dwg_read_file(name);
  } finally {
    try { w.FS.unlink(name); } catch { /* già rimosso */ }
  }
  if (result.error >= DWG_CRITICAL || !result.data) {
    if (result.data) try { w.dwg_abandon?.(result.data); } catch { /* memoria già liberata */ }
    const ver = DWG_VERSIONS[head] ? ` (versione ${DWG_VERSIONS[head]})` : ` (${head})`;
    throw new Error(`DWG non leggibile${ver}, codice LibreDWG ${result.error}.`);
  }
  let db: any;
  try {
    db = lib.convert(result.data);
  } finally {
    lib.dwg_free(result.data);
  }
  const { drawing, skipped } = fromDwgDatabase(db);
  const r = buildImport(drawing, docUnits);
  const warnings = result.error ? [`Il DWG è stato letto con avvisi (codice LibreDWG ${result.error}): controllare il disegno.`, ...r.warnings] : r.warnings;
  return { ...r, warnings, skipped: merge(skipped, r.skipped) };
}

export async function importDwg(buf: ArrayBuffer, docUnits: Units): Promise<ImportResult> {
  return readDwgWith(await libredwg(), buf, docUnits);
}

export const DWG_VERSIONS: Record<string, string> = {
  AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018',
};
