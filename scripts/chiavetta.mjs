// Prepara la versione da chiavetta: una cartella con Kalista.html che si apre con un doppio clic,
// senza installare niente e senza rete.
// Uso: npm run chiavetta   (risultato in chiavetta/Kalista)
//
// Una pagina aperta da disco (file://) non può caricare altri moduli né scaricare file: per questo
// tutto il programma finisce dentro Kalista.html, e il lettore DWG (WebAssembly) in uno script a
// parte, kalista-dwg.js, che la pagina carica solo quando serve.
import { build } from 'vite';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const tmp = join(root, 'chiavetta', '.tmp');
const out = join(root, 'chiavetta', 'Kalista');

await build({
  root,
  logLevel: 'error',
  define: { __PORTABLE__: 'true' },
  build: { outDir: tmp, emptyOutDir: true, rollupOptions: { output: { codeSplitting: false } } },
});

const assets = readdirSync(join(tmp, 'assets'));
const only = ext => {
  const found = assets.filter(f => f.endsWith(ext));
  if (found.length !== 1) throw new Error(`Atteso un solo file ${ext}, trovati ${found.length}: ${found.join(', ')}`);
  return join(tmp, 'assets', found[0]);
};
// dentro una pagina HTML il codice non deve contenere la chiusura del proprio tag
const js = readFileSync(only('.js'), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = readFileSync(only('.css'), 'utf8').replace(/<\/style/gi, '<\\/style');

let html = readFileSync(join(tmp, 'index.html'), 'utf8');
const swap = (re, text) => {
  if (!re.test(html)) throw new Error(`index.html compilato: non trovo ${re}`);
  html = html.replace(re, () => text);
};
swap(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, '');
swap(/<link rel="stylesheet"[^>]*>/, `<style>${css}</style>`);
swap(/<\/body>/, `<script type="module">${js}</script>\n</body>`);
if (/(src|href)="\.\/assets\//.test(html)) throw new Error('Kalista.html fa ancora riferimento a file esterni.');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'Kalista.html'), html);
writeFileSync(join(out, 'kalista-dwg.js'), `window.__KALISTA_DWG="${readFileSync(only('.wasm')).toString('base64')}";\n`);
writeFileSync(join(out, 'LEGGIMI.txt'), [
  `KALISTA ${version} - disegno di planimetrie`,
  `Versione ${version} del ${today}. La stessa scritta compare in alto a sinistra nel programma,`,
  'accanto al nome: se è diversa da questa, quella copia non è aggiornata.',
  '',
  'Per aprirlo: doppio clic su Kalista.html.',
  'Si apre nel browser (Edge, Chrome o Firefox). Non serve installare niente e non serve Internet.',
  '',
  'La cartella si può usare dalla chiavetta oppure copiare sul computer.',
  'I due file devono restare insieme: kalista-dwg.js serve per aprire i disegni DWG.',
  '',
  'Salvare il lavoro: Ctrl+S crea un file .kalista. Salvarlo sulla chiavetta o in una cartella',
  'propria: il salvataggio automatico resta solo nel browser di quel computer.',
  '',
  'Comandi: scrivere ? e premere Invio, oppure premere F1.',
  '',
].join('\r\n'));
rmSync(tmp, { recursive: true, force: true });

const mb = f => `${(readFileSync(join(out, f)).length / 1048576).toFixed(1)} MB`;
console.log(`Kalista ${version} del ${today}`);
console.log(`Pronto in ${out}\n  Kalista.html     ${mb('Kalista.html')}\n  kalista-dwg.js   ${mb('kalista-dwg.js')}`);
