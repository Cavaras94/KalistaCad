// Collaudo della versione da chiavetta: apre Kalista.html da disco (file://), come farà un doppio clic.
// Uso: npm run chiavetta && node test/chiavetta.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const page0 = join(dirname(fileURLToPath(import.meta.url)), '..', 'chiavetta', 'Kalista', 'Kalista.html');
if (!existsSync(page0)) { console.error('Manca chiavetta/Kalista/Kalista.html: eseguire prima npm run chiavetta'); process.exit(2); }
const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const { version } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const OUT = join(tmpdir(), 'kalista-chiavetta');
mkdirSync(OUT, { recursive: true });
const junkDwg = join(OUT, 'rovinato.dwg');
writeFileSync(junkDwg, 'AC1032' + 'x'.repeat(4000));

for (const exe of browsers.filter(p => existsSync(p))) {
  const who = exe.includes('msedge') ? 'Edge' : 'Chrome';
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(page0).href);
  await page.waitForSelector('#prompt');
  check(`${who}: si apre da disco`, (await page.textContent('#prompt')) === 'Comando:' && (await page.title()).endsWith('Kalista'), await page.title());
  const brand = await page.textContent('.brand');
  check(`${who}: mostra la versione ${version}`, brand.includes(`v${version}`) && (await page.textContent('#history')).includes(`Kalista ${version} del `), brand);
  const kb = page.keyboard;
  await kb.type('MURO'); await kb.press('Enter');
  check(`${who}: MURO apre la finestra con le impostazioni e i retini disegnati`, (await page.locator('.modal .tile canvas').count()) > 10, String(await page.locator('.modal .tile').count()));
  await kb.press('Enter'); // OK con i valori proposti
  for (const s of ['0,0', '500,0', '500,400', 'C']) { await kb.type(s); await kb.press('Enter'); }
  await kb.type('LISTA'); await kb.press('Enter');
  await kb.press('Control+a');
  const side = await page.textContent('#props');
  check(`${who}: si disegna (3 muri selezionati)`, /3 /.test(side), side.slice(0, 60));
  await kb.press('Escape');
  await kb.press('Escape');
  await kb.type('3D'); await kb.press('Enter');
  await page.waitForSelector('.v3d canvas', { timeout: 15000 }).catch(() => {});
  check(`${who}: la vista 3D si apre anche da disco`, !!(await page.$('.v3d canvas')) && (await page.textContent('#history')).includes('Vista 3D'), (await page.textContent('#history')).slice(-120));
  await kb.press('Escape');
  const ch = page.waitForEvent('filechooser');
  await kb.type('IMPORTA'); await kb.press('Enter');
  await (await ch).setFiles(junkDwg);
  await page.waitForFunction(() => /rovinato\.dwg: /.test(document.getElementById('history').textContent), null, { timeout: 60000 });
  const h = await page.textContent('#history');
  const dwg = h.slice(h.lastIndexOf('rovinato.dwg: '));
  check(`${who}: il lettore DWG si carica senza rete`, /codice LibreDWG \d+/.test(dwg), dwg);
  check(`${who}: nessun errore in console`, errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: join(OUT, `${who}.png`) });
  await browser.close();
}
console.log(`\nScreenshot in ${OUT}`);
process.exit(failures ? 1 : 0);
