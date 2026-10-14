// Collaudo nel browser: digita i comandi come un utente e controlla il disegno risultante.
// Uso: npm run e2e   (serve Chrome o Edge installato)
import { createServer, build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUT = process.env.E2E_OUT || join(tmpdir(), 'planimetrie-e2e');
mkdirSync(OUT, { recursive: true });
const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];
const exe = browsers.find(p => existsSync(p));
if (!exe) { console.error('Nessun Chrome/Edge trovato'); process.exit(2); }

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

await page.goto(url);
await page.waitForFunction(() => window.app);
// il collaudo dà i valori nella riga di comando, come in AutoCAD: le finestre dei comandi si provano a parte, più avanti
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('planimetrie.dialogs', '0'); });
await page.reload();
await page.waitForFunction(() => window.app);

const kb = page.keyboard;
async function cmd(s) {
  if (s) await kb.type(s, { delay: 5 });
  await kb.press('Enter');
  await page.waitForTimeout(30);
}
async function toScreen(x, y) {
  return page.evaluate(([x, y]) => {
    const p = window.app.view.toScreen({ x, y });
    const r = document.getElementById('overlay').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [x, y]);
}
// Un clic fuori dall'area di disegno non arriva al programma: meglio fermarsi che fallire più avanti.
async function inView(x, y) {
  const s = await toScreen(x, y);
  const r = await page.evaluate(() => { const b = document.getElementById('overlay').getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
  if (s.x < r.l || s.x > r.r || s.y < r.t || s.y > r.b) throw new Error(`punto ${x},${y} fuori dalla vista`);
  return s;
}
async function clickWorld(x, y, opts = {}) {
  const s = await inView(x, y);
  await page.mouse.move(s.x, s.y);
  await page.waitForTimeout(20);
  await page.mouse.click(s.x, s.y, opts);
  await page.waitForTimeout(30);
}
const ents = () => page.evaluate(() => window.app.doc.ents.map(e => JSON.parse(JSON.stringify(e))));
const count = async t => (await ents()).filter(e => e.t === t).length;
const prompt = () => page.evaluate(() => document.getElementById('prompt').textContent);

check('pagina caricata senza errori', errors.length === 0, errors.join(' | '));
check('riga di comando a riposo', (await prompt()) === 'Comando:');

// i muri nascono con le misure interne; il resto del collaudo li disegna sull'asse, come sono scritte le sue coordinate
await cmd('MURO');
check('MURO: di partenza le misure sono quelle interne', (await prompt()).includes('misure interne'), await prompt());
await cmd('G'); await cmd('C');
check('MURO: Giustificazione Centro mette le misure sull\'asse', (await prompt()).includes('misure sull\'asse'), await prompt());
await kb.press('Escape');

// ---- muri chiusi
await cmd('MURO');
check('MURO avviato', (await prompt()).startsWith('MURO'), await prompt());
for (const p of ['0,0', '500,0', '500,400', '0,400']) await cmd(p);
await cmd('C');
check('4 muri', (await count('wall')) === 4, `${await count('wall')}`);
const caps = await page.evaluate(() => { const c = window.app.doc.ctx(); return [...c.walls.walls.values()].filter(i => i.capS || i.capE).length; });
check('angoli giuntati (nessuna testata)', caps === 0, `${caps}`);
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);

// ---- porta a 100 dallo spigolo, che apre verso l'interno
await cmd('PORTA');
await clickWorld(250, 0);
check('PORTA: muro scelto', (await prompt()).includes('verso'), await prompt());
await cmd('100');
await clickWorld(300, 150);
await kb.press('Escape');
const door = (await ents()).find(e => e.t === 'door');
check('porta inserita', !!door);
if (door) {
  // 100 dallo spigolo interno della stanza: l'asse del muro arriva mezzo spessore (15) più in là
  check('porta a 100 dallo spigolo interno destro', Math.abs(door.p.x - (500 - 15 - 100 - 40)) < 1e-6 && Math.abs(door.p.y) < 1e-6, JSON.stringify(door.p));
  check('porta apre verso l\'interno', door.sw === 1, `sw=${door.sw}`);
}

// ---- finestra
await cmd('FINESTRA');
await clickWorld(500, 200);
await cmd('');
await kb.press('Escape');
check('finestra inserita', (await count('window')) === 1);
const cuts = await page.evaluate(() => [...window.app.doc.ctx().walls.walls.values()].reduce((n, i) => n + i.cuts.length, 0));
check('porta e finestra aprono i muri', cuts === 2, `${cuts}`);

// ---- locale con clic interno
await cmd('LOCALE');
await clickWorld(250, 200);
check('LOCALE chiede il nome', (await prompt()).includes('Nome'), await prompt());
await cmd('Soggiorno');
await kb.press('Escape');
const room = (await ents()).find(e => e.t === 'room');
check('locale creato', !!room);
if (room) {
  const area = await page.evaluate(id => { const e = window.app.doc.byId(id); let s = 0; for (let i = 0; i < e.pts.length; i++) { const a = e.pts[i], b = e.pts[(i + 1) % e.pts.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s / 2); }, room.id);
  check('superficie interna 470×370', Math.abs(area - 470 * 370) < 1, `${area}`);
  check('nome Soggiorno', room.name === 'Soggiorno', room.name);
}

// ---- quota lineare
await cmd('QL');
await cmd('0,0');
await cmd('500,0');
await cmd('250,-100');
const dim = (await ents()).find(e => e.t === 'dim');
check('quota orizzontale', !!dim && dim.ang === 0, JSON.stringify(dim));

// ---- quota continua
await cmd('DCO');
await cmd('500,400');
await kb.press('Escape');
check('quota continua', (await count('dim')) === 2);

// ---- linee, taglia, offset, annulla/ripristina
await cmd('L'); await cmd('600,0'); await cmd('900,0'); await cmd('');
await cmd('L'); await cmd('750,-100'); await cmd('750,100'); await cmd('');
check('due linee', (await count('line')) === 2);
await page.evaluate(() => window.app.zoomExtents());
await cmd('TR');
await cmd('');
await clickWorld(850, 0);
await cmd('');
const lines = (await ents()).filter(e => e.t === 'line');
const hor = lines.find(l => Math.abs(l.a.y) < 1e-9 && Math.abs(l.b.y) < 1e-9);
check('TAGLIA accorcia la linea a 750', !!hor && Math.abs(Math.max(hor.a.x, hor.b.x) - 750) < 1e-6, JSON.stringify(hor));
await cmd('O'); await cmd('50');
await clickWorld(680, 0);
await clickWorld(680, 30);
await cmd('');
const off = (await ents()).filter(e => e.t === 'line' && Math.abs(e.a.y - 50) < 1e-6);
check('OFFSET a 50', off.length === 1);
await kb.press('Control+z');
check('Ctrl+Z annulla l\'offset', (await ents()).filter(e => e.t === 'line' && Math.abs(e.a.y - 50) < 1e-6).length === 0);
await kb.press('Control+y');
check('Ctrl+Y lo ripristina', (await ents()).filter(e => e.t === 'line' && Math.abs(e.a.y - 50) < 1e-6).length === 1);

// ---- Invio a riposo ripete l'ultimo comando
await cmd('');
check('Invio ripete OFFSET', (await prompt()).startsWith('OFFSET'), await prompt());
await kb.press('Escape');

// ---- selezione a finestra e cancella, poi annulla
const nBefore = (await ents()).length;
const a = await toScreen(580, 120), b = await toScreen(920, -120);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
const selN = await page.evaluate(() => window.app.selection.size);
check('selezione a finestra', selN === 3, `${selN}`);
await kb.press('Delete');
check('Canc cancella', (await ents()).length === nBefore - 3);
await kb.press('Control+z');
check('annulla la cancellazione', (await ents()).length === nBefore);

// ---- grip: allunga la linea verticale
await kb.press('Escape');
await clickWorld(750, 60);
const vline = (await ents()).find(e => e.t === 'line' && Math.abs(e.a.x - 750) < 1e-9 && Math.abs(e.b.x - 750) < 1e-9);
const top = vline.a.y > vline.b.y ? vline.a : vline.b;
await clickWorld(top.x, top.y);
check('grip attivo', (await prompt()).includes('STIRA'), await prompt());
await cmd('750,300');
const vl2 = (await ents()).find(e => e.id === vline.id);
check('grip stirato a y=300', Math.max(vl2.a.y, vl2.b.y) === 300, JSON.stringify(vl2));
await kb.press('Escape');

// ---- testo con spazi
await cmd('T'); await cmd('100,600'); await cmd(''); await cmd('');
await page.waitForSelector('.write-box textarea');
await kb.type('Cucina abitabile');
await kb.press('Control+Enter');
await page.waitForTimeout(40);
const txt = (await ents()).find(e => e.t === 'text');
check('testo con spazi', txt?.s === 'Cucina abitabile', txt?.s);

// ---- tratteggio con clic interno nel locale
await cmd('H');
await clickWorld(100, 100);
await cmd('');
check('tratteggio creato', (await count('hatch')) === 1);

// ---- coordinate relative e polari
await cmd('L'); await cmd('1000,0'); await cmd('@100,0'); await cmd('@100<90'); await cmd('');
const rel = (await ents()).filter(e => e.t === 'line').slice(-2);
check('@dx,dy e @d<a', rel.length === 2 && rel[0].b.x === 1100 && Math.abs(rel[1].b.x - 1100) < 1e-9 && Math.abs(rel[1].b.y - 100) < 1e-9, JSON.stringify(rel.map(r => r.b)));

await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(100);
await page.mouse.move(700, 400);
await page.screenshot({ path: join(OUT, 'disegno.png') });

// ---- stampa
await kb.press('Control+p');
await page.waitForSelector('.print-preview svg');
const info = await page.textContent('.print-info');
check('anteprima di stampa', /Scala 1:\d+/.test(info), info);
await page.screenshot({ path: join(OUT, 'stampa.png') });
await page.evaluate(() => { window.print = () => {}; });
await page.click('.modal-foot button.primary');
await page.waitForTimeout(200);
await page.emulateMedia({ media: 'print' });
const pdfPath = join(OUT, 'tavola.pdf');
await page.screenshot({ path: join(OUT, 'stampa-come-pdf.png'), fullPage: true });
const printed = await page.evaluate(() => document.querySelectorAll('#print-root svg path').length);
check('area di stampa con il disegno', printed > 20, `${printed} tracciati`);
await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
check("dopo la stampa l'area di stampa si svuota", await page.evaluate(() => document.getElementById('print-root').innerHTML === ''));
await page.emulateMedia({ media: 'screen' });
const pdfText = (await import('node:fs')).readFileSync(pdfPath, 'latin1');
const mb = pdfText.match(/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/);
const pts = mb ? [parseFloat(mb[1]), parseFloat(mb[2])] : [0, 0];
check('PDF in formato A3 orizzontale (420×297 mm)', Math.abs(pts[0] - 1190.55) < 2 && Math.abs(pts[1] - 841.89) < 2, `${pts.map(p => (p / 72 * 25.4).toFixed(1)).join('×')} mm`);
const pages = (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length;
check('PDF di una sola pagina', pages === 1, `${pages}`);

// ---- DXF: esporta e reimporta come nuovo file
const dxf = await page.evaluate(async () => (await import('/src/io/dxf-export.ts')).exportDxf(window.app.doc));
const dxfPath = join(OUT, 'prova.dxf');
writeFileSync(dxfPath, dxf);
const nAll = (await ents()).length;
const chooser = page.waitForEvent('filechooser');
await cmd('IMPORTA');
await (await chooser).setFiles(dxfPath);
// finestra "in che unità è il file": il DXF scritto da Kalista dichiara i centimetri, basta confermare
await page.waitForSelector('.modal');
check('import: chiede le unità del file e propone quelle giuste', await page.evaluate(() => document.querySelector('.modal input[name="import-units"]:checked')?.value) === 'cm', await page.textContent('.modal'));
await page.keyboard.press('Enter');
await page.waitForFunction(n => window.app.doc.ents.length > n, nAll, { timeout: 10000 });
const hist = await page.textContent('#history');
check('DXF reimportato', /entità importate da prova\.dxf/.test(hist), hist.split('\n').slice(-3).join(' / '));

// ---- comandi di modifica, lontano dal resto del disegno
const byId = async id => (await ents()).find(e => e.id === id);
const lastEnt = async () => (await ents()).at(-1);
await page.evaluate(() => window.app.zoomWindow({ x: 2900, y: -600 }, { x: 4600, y: 1400 }));
await page.waitForTimeout(50);

await cmd('REC'); await cmd('3000,0'); await cmd('@200,100');
const rect = await lastEnt();
check('RETTANGOLO', rect.t === 'poly' && rect.closed && rect.pts[2].x === 3200 && rect.pts[2].y === 100);

await cmd('M');
await clickWorld(3100, 0);
await cmd('');
await cmd('3000,0'); await cmd('@0,500');
check('SPOSTA con @dx,dy', (await byId(rect.id)).pts[0].y === 500);

await cmd('CO');
await clickWorld(3100, 500);
await cmd('');
await cmd('3000,500'); await cmd('@300,0'); await cmd('@600,0'); await cmd('');
check('COPIA multipla', (await ents()).filter(e => e.t === 'poly' && e.closed && Math.abs(e.pts[0].y - 500) < 1e-9).length === 3);

await clickWorld(3100, 500);
await cmd('RO'); await cmd('3000,500'); await cmd('90');
const rot = await byId(rect.id);
check('RUOTA 90° con selezione preventiva', Math.abs(rot.pts[2].x - 2900) < 1e-9 && Math.abs(rot.pts[2].y - 700) < 1e-9, JSON.stringify(rot.pts[2]));

const copy1 = (await ents()).find(e => e.t === 'poly' && e.closed && Math.abs(e.pts[0].x - 3300) < 1e-9);
await cmd('MI');
await clickWorld(3400, 500);
await cmd('');
await cmd('3600,0'); await cmd('3600,100'); await cmd('N');
check('SPECCHIO senza cancellare', (await ents()).some(e => e.t === 'poly' && e.pts.some(p => Math.abs(p.x - 3900) < 1e-9) && e.pts.some(p => Math.abs(p.x - 3700) < 1e-9)) && !!(await byId(copy1.id)));

await cmd('SC');
await clickWorld(3400, 500);
await cmd('');
await cmd('3300,500'); await cmd('2');
const sc = await byId(copy1.id);
check('SCALA ×2', Math.abs(Math.max(...sc.pts.map(p => p.x)) - 3700) < 1e-9, JSON.stringify(sc.pts));

await cmd('L'); await cmd('3000,-300'); await cmd('3300,-300'); await cmd('');
await cmd('L'); await cmd('3400,-400'); await cmd('3400,-200'); await cmd('');
const [l1, l2] = (await ents()).slice(-2);
await cmd('F');
await clickWorld(3100, -300);
await clickWorld(3400, -250);
const f1 = await byId(l1.id), f2 = await byId(l2.id);
check('RACCORDA raggio 0', Math.max(f1.a.x, f1.b.x) === 3400 && Math.min(f2.a.y, f2.b.y) === -300, `${JSON.stringify(f1)} ${JSON.stringify(f2)}`);

await cmd('L'); await cmd('3000,-500'); await cmd('3200,-500'); await cmd('');
const shortL = await lastEnt();
// il RACCORDA qui sopra ha accorciato la verticale a y -300…-200: serve un bordo che arrivi a y -500
await cmd('L'); await cmd('3400,-600'); await cmd('3400,-450'); await cmd('');
await cmd('EX'); await cmd('');
await clickWorld(3190, -500);
await cmd('');
check('ESTENDI fino alla linea verticale', Math.max((await byId(shortL.id)).a.x, (await byId(shortL.id)).b.x) === 3400);

await cmd('L'); await cmd('4000,0'); await cmd('4100,0'); await cmd('4100,100'); await cmd('4000,0'); await cmd('');
const nLinesBefore = (await ents()).filter(e => e.t === 'line').length;
await cmd('J');
const ja = await toScreen(3990, 110), jb = await toScreen(4110, -10);
await page.mouse.move(ja.x, ja.y); await page.mouse.down(); await page.mouse.move(jb.x, jb.y, { steps: 4 }); await page.mouse.up();
await cmd('');
const joined = await lastEnt();
check('UNISCI tre linee in polilinea chiusa', joined.t === 'poly' && joined.closed && joined.pts.length === 3 && (await ents()).filter(e => e.t === 'line').length === nLinesBefore - 3);

await clickWorld(4050, 0);
await cmd('X');
check('ESPLODI la polilinea', (await ents()).filter(e => e.t === 'line').length === nLinesBefore);

await cmd('L'); await cmd('4300,0'); await cmd('4500,0'); await cmd('');
const st = await lastEnt();
await cmd('S');
const sa = await toScreen(4550, 50), sb = await toScreen(4450, -50);
await page.mouse.move(sa.x, sa.y); await page.mouse.down(); await page.mouse.move(sb.x, sb.y, { steps: 4 }); await page.mouse.up();
await cmd('');
await cmd('4500,0'); await cmd('@100,0');
const st2 = await byId(st.id);
check('STIRA muove solo l\'estremo dentro la finestra', Math.min(st2.a.x, st2.b.x) === 4300 && Math.max(st2.a.x, st2.b.x) === 4600, JSON.stringify(st2));

await cmd('C'); await cmd('3100,1000'); await cmd('50');
check('CERCHIO centro-raggio', (await lastEnt()).t === 'circle' && (await lastEnt()).r === 50);
await cmd('C'); await cmd('3P'); await cmd('3300,1000'); await cmd('3400,1100'); await cmd('3500,1000');
check('CERCHIO per 3 punti', Math.abs((await lastEnt()).r - 100) < 1e-9);
await cmd('A'); await cmd('3700,1000'); await cmd('3800,1100'); await cmd('3900,1000');
const arc = await lastEnt();
check('ARCO per 3 punti', arc.t === 'arc' && Math.abs(arc.r - 100) < 1e-9);
await cmd('PL'); await cmd('4000,1000'); await cmd('4100,1000'); await cmd('A'); await cmd('4100,1200'); await cmd('');
const pl = await lastEnt();
check('POLILINEA con arco tangente (semicerchio)', pl.t === 'poly' && Math.abs(pl.bulges[1] - 1) < 1e-9, JSON.stringify(pl.bulges));

await cmd('DAL'); await cmd('3000,1300'); await cmd('3300,1400'); await cmd('3100,1500');
const dal = await lastEnt();
check('QUOTA ALLINEATA', dal.t === 'dim' && dal.ang === undefined);

await cmd('L'); await cmd('3000,1700'); await cmd('3200,1700');
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);
const rc = await inView(3500, 1650);
await page.mouse.click(rc.x, rc.y, { button: 'right' });
check('clic destro chiude il comando come Invio', (await prompt()) === 'Comando:');

const nBeforePaste = (await ents()).length;
await clickWorld(3100, 1700);
await kb.press('Control+c');
await kb.press('Control+v');
await cmd('3000,1800');
const pasted = await lastEnt();
check('Ctrl+C / Ctrl+V', (await ents()).length === nBeforePaste + 1 && pasted.a.y === 1800);

// ---- smusso e serie
await cmd('L'); await cmd('5000,0'); await cmd('5200,0'); await cmd('');
const ch1 = await lastEnt();
await cmd('L'); await cmd('5200,0'); await cmd('5200,150'); await cmd('');
const ch2 = await lastEnt();
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);
const nBeforeCha = (await ents()).length;
await cmd('SMUSSO'); await cmd('D'); await cmd('30'); await cmd('50');
check('SMUSSO chiede le linee dopo le distanze', (await prompt()).includes('distanze 30 e 50'), await prompt());
await clickWorld(5100, 0);
await clickWorld(5200, 100);
const cha1 = await byId(ch1.id), cha2 = await byId(ch2.id), chaL = await lastEnt();
check('SMUSSO 30 × 50', cha1.b.x === 5170 && cha2.a.y === 50 && (await ents()).length === nBeforeCha + 1 && chaL.t === 'line' && chaL.a.x === 5170 && chaL.b.y === 50,
  `${JSON.stringify(cha1)} ${JSON.stringify(cha2)} ${JSON.stringify(chaL)}`);

await cmd('C'); await cmd('5000,500'); await cmd('20');
const seed = await lastEnt();
const nBeforeArr = (await ents()).length;
await clickWorld(5020, 500);
await cmd('SERIE'); await cmd('R'); await cmd('2'); await cmd('3'); await cmd('100'); await cmd('150');
const circles = (await ents()).filter(e => e.t === 'circle' && e.r === 20 && e.c.x >= 5000);
check('SERIE rettangolare 2 × 3', (await ents()).length === nBeforeArr + 5 && circles.some(e => e.c.x === 5300 && e.c.y === 600) && (await prompt()) === 'Comando:',
  `${(await ents()).length - nBeforeArr} copie, ${await prompt()}`);

await cmd('L'); await cmd('5600,500'); await cmd('5700,500'); await cmd('');
const spoke = await lastEnt();
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);
const nBeforePol = (await ents()).length;
await clickWorld(5650, 500);
await cmd('AR'); await cmd('P'); await cmd('5600,500'); await cmd('4'); await cmd(''); await cmd('');
const spokes = (await ents()).slice(-3);
check('SERIE polare di 4 sul giro completo', (await ents()).length === nBeforePol + 3 && spokes.some(e => Math.abs(e.b.x - 5600) < 1e-6 && Math.abs(e.b.y - 600) < 1e-6) && spokes.some(e => Math.abs(e.b.x - 5500) < 1e-6 && Math.abs(e.b.y - 500) < 1e-6),
  JSON.stringify(spokes));
await kb.press('Control+z');
check('SERIE si annulla in un colpo solo', (await ents()).length === nBeforePol && !!(await byId(spoke.id)) && !!(await byId(seed.id)));

// ---- quote raggio, diametro, angolare
await cmd('C'); await cmd('5000,1200'); await cmd('100');
await cmd('L'); await cmd('5400,1100'); await cmd('5700,1100'); await cmd('');
await cmd('L'); await cmd('5400,1100'); await cmd('5400,1400'); await cmd('');
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);
await cmd('DRA');
await clickWorld(5100, 1200);
await cmd('5150,1350');
const dra = await lastEnt();
check('QUOTA RAGGIO', dra.t === 'dim' && dra.k === 'rad' && Math.abs(Math.hypot(dra.b.x - 5000, dra.b.y - 1200) - 100) < 1e-6 && (await prompt()) === 'Comando:', JSON.stringify(dra));
await cmd('DDI');
await clickWorld(5000, 1300);
await cmd('4850,1050');
check('QUOTA DIAMETRO', (await lastEnt()).k === 'dia');
await cmd('DAN');
await clickWorld(5600, 1100);
await clickWorld(5400, 1300);
await cmd('5500,1200');
const dan = await lastEnt();
check('QUOTA ANGOLARE fra due linee', dan.t === 'dim' && dan.k === 'ang' && dan.a.x === 5400 && dan.a.y === 1100 && dan.b.x === 5700 && dan.c.y === 1400, JSON.stringify(dan));
await page.evaluate(() => { const b = { x0: 4700, y0: 950, x1: 5800, y1: 1500 }; window.app.zoomWindow({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }); });
await page.waitForTimeout(100);
await page.screenshot({ path: join(OUT, 'quote-nuove.png') });
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);

// ---- ellisse, spline, offset di polilinea con arco
await cmd('EL'); await cmd('6000,0'); await cmd('6200,0'); await cmd('50');
const el = await lastEnt();
check('ELLISSE per asse e semiasse', el.t === 'ellipse' && el.c.x === 6100 && el.c.y === 0 && Math.hypot(el.a.x, el.a.y) === 100 && Math.abs(el.k - 0.5) < 1e-9 && (await prompt()) === 'Comando:', JSON.stringify(el));
await cmd('EL'); await cmd('C'); await cmd('6100,150'); await cmd('6180,150'); await cmd('6100,190');
const el2 = await lastEnt();
check('ELLISSE dal centro', el2.t === 'ellipse' && el2.c.y === 150 && el2.a.x === 80 && el2.k === 0.5, JSON.stringify(el2));
await cmd('SPL'); await cmd('6000,300'); await cmd('6100,400'); await cmd('6200,300'); await cmd('6300,400'); await cmd('6350,350'); await cmd('A'); await cmd('');
const spl = await lastEnt();
check('SPLINE per punti, con Annulla dell\'ultimo', spl.t === 'spline' && spl.pts.length === 4 && !spl.closed && (await prompt()) === 'Comando:', JSON.stringify(spl));
await cmd('SPL'); await cmd('6500,300'); await cmd('6600,400'); await cmd('6700,300'); await cmd('C');
check('SPLINE chiusa', (await lastEnt()).closed === true && (await lastEnt()).pts.length === 3);

await cmd('PL'); await cmd('6000,600'); await cmd('6200,600'); await cmd('A'); await cmd('6200,700'); await cmd('');
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);
await cmd('O'); await cmd('10');
await clickWorld(6100, 600);
await cmd('6100,550');
await cmd('');
const offArc = await lastEnt();
check('OFFSET di polilinea con arco', offArc.t === 'poly' && offArc.pts.length === 3 && Math.abs(offArc.pts[0].y - 590) < 1e-6 && Math.abs(offArc.pts[2].y - 710) < 1e-6 && Math.abs(offArc.bulges[1] - 1) < 1e-6,
  JSON.stringify(offArc));

// ---- blocchi
const blocks = () => page.evaluate(() => JSON.parse(JSON.stringify(window.app.doc.blocks)));
await cmd('I');
check('INSERISCI senza blocchi lo dice', (await page.textContent('#history')).includes('Nessun blocco in questo disegno') && (await prompt()) === 'Comando:');
await cmd('REC'); await cmd('6600,0'); await cmd('@50,40');
await cmd('C'); await cmd('6625,60'); await cmd('15');
// da vicino: con lo zoom lontano il clic sul cerchio cadrebbe su un grip del rettangolo già selezionato
await page.evaluate(() => window.app.zoomWindow({ x: 6550, y: -50 }, { x: 6950, y: 200 }));
await page.waitForTimeout(50);
const nBeforeBlock = (await ents()).length;
await clickWorld(6600, 20);
await clickWorld(6614.4, 70.6);
await cmd('BLOCCO'); await cmd('sedia'); await cmd('6600,0');
const ins1 = await lastEnt();
check('BLOCCO: la selezione diventa un inserimento', ins1.t === 'insert' && ins1.name === 'sedia' && ins1.p.x === 6600 && (await ents()).length === nBeforeBlock - 1 && (await blocks()).sedia.ents.length === 2 && (await prompt()) === 'Comando:',
  JSON.stringify(ins1));
await cmd('I'); await cmd(''); await cmd('R'); await cmd('90'); await cmd('S'); await cmd('2'); await cmd('6800,0');
const ins2 = await lastEnt();
check('INSERISCI con scala e rotazione', ins2.t === 'insert' && ins2.id !== ins1.id && ins2.s === 2 && Math.abs(ins2.rot - Math.PI / 2) < 1e-9 && ins2.p.x === 6800, JSON.stringify(ins2));

// modifica del blocco (sempre da vicino, per non cliccare sui grip): esplodere un inserimento, correggere, ridefinire con lo stesso nome
await clickWorld(6600, 20);
await cmd('X');
check('ESPLODI un blocco ridà le sue entità', !(await byId(ins1.id)) && (await ents()).length === nBeforeBlock + 1);
await cmd('L'); await cmd('6600,0'); await cmd('6650,40'); await cmd('');
await clickWorld(6600, 30);
await clickWorld(6614.4, 70.6);
await clickWorld(6637.5, 30);
await cmd('BLOCCO'); await cmd('SEDIA');
check('BLOCCO con un nome esistente chiede conferma', (await prompt()).includes('esiste già'), await prompt());
await cmd('S'); await cmd('6600,0');
check('ridefinire il blocco cambia la definizione usata da tutti gli inserimenti', (await blocks()).sedia.ents.length === 3 && Object.keys(await blocks()).length === 1 && !!(await byId(ins2.id)));
await page.evaluate(() => { const b = { x0: 5950, y0: -100, x1: 6900, y1: 750 }; window.app.zoomWindow({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }); });
await page.waitForTimeout(100);
await kb.press('Escape');
await page.screenshot({ path: join(OUT, 'curve-e-blocchi.png') });
await kb.press('Control+z');
check('annullare ripristina anche la definizione del blocco', (await blocks()).sedia.ents.length === 2);
await kb.press('Control+y');
const saved = await page.evaluate(() => {
  const d = JSON.parse(JSON.stringify(window.app.doc.toData()));
  return { blocks: Object.keys(d.blocks ?? {}), inserts: d.ents.filter(e => e.t === 'insert').length };
});
check('i blocchi si salvano nel file', saved.blocks.join() === 'sedia' && saved.inserts === 2, JSON.stringify(saved));
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);

// ---- pennello: copia l'altezza del testo da una quota all'altra
await cmd('DLI'); await cmd('7000,0'); await cmd('7300,0'); await cmd('7150,-60');
const dimA = await lastEnt();
await cmd('DLI'); await cmd('7000,300'); await cmd('7300,300'); await cmd('7150,240');
const dimB = await lastEnt();
await page.evaluate(id => { const d = window.app.doc; d.edit('prova', () => d.replace([{ ...d.byId(id), h: 40 }])); }, dimA.id);
await page.evaluate(() => window.app.zoomWindow({ x: 6900, y: -150 }, { x: 7400, y: 400 }));
await page.waitForTimeout(50);
await cmd('MA');
await clickWorld(7100, -60);
await clickWorld(7100, 240);
await cmd('');
check('COPIA PROPRIETÀ porta l\'altezza del testo da una quota all\'altra', (await byId(dimB.id)).h === 40, JSON.stringify(await byId(dimB.id)));
await clickWorld(7100, 240);
const dimPanel = await page.evaluate(() => [...document.querySelectorAll('#props .prop')].map(p => p.textContent + '=' + (p.querySelector('input')?.value ?? '')).join(' | '));
check('pannello Proprietà: altezza del testo della quota', /Altezza testo=40/.test(dimPanel), dimPanel);
await kb.press('Escape');

// ---- cambio di unità: il disegno si converte e le misure reali restano le stesse
const wallBefore = (await ents()).find(e => e.t === 'wall');
await cmd('DS');
await page.waitForSelector('.modal select');
await page.selectOption('.modal select[name="units"]', 'm');
await page.click('.modal button.primary');
await page.waitForTimeout(100);
const afterM = await page.evaluate(() => ({ s: window.app.doc.settings, w: window.app.doc.ents.find(e => e.t === 'wall') }));
check('unità in metri: coordinate e valori predefiniti convertiti', afterM.s.units === 'm' && Math.abs(afterM.w.b.x - wallBefore.b.x / 100) < 1e-9 && Math.abs(afterM.w.th - wallBefore.th / 100) < 1e-9 && afterM.s.wallTh === 0.3 && afterM.s.textH === 0.2,
  JSON.stringify(afterM.s));
await cmd('MURO'); await cmd('80,0'); await cmd('85,0'); await cmd('');
const wallM = await lastEnt();
check('in metri un muro nuovo è spesso 0,3 e non 30', wallM.t === 'wall' && wallM.th === 0.3, JSON.stringify(wallM));
await kb.press('Control+z');
await kb.press('Control+z');
const backCm = await page.evaluate(() => ({ u: window.app.doc.settings.units, w: window.app.doc.ents.find(e => e.t === 'wall') }));
check('annulla riporta ai centimetri', backCm.u === 'cm' && backCm.w.b.x === wallBefore.b.x, JSON.stringify(backCm));
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);

// ---- difetti corretti dopo la revisione: riferimento, spostamento, appunti, Canc
await cmd('L'); await cmd('8000,0'); await cmd('8100,0'); await cmd('');
const refLine = await lastEnt();
await page.evaluate(() => window.app.zoomWindow({ x: 7900, y: -200 }, { x: 8500, y: 350 }));
await page.waitForTimeout(50);
await clickWorld(8050, 0);
await cmd('RO'); await cmd('8000,0'); await cmd('R'); await cmd('30');
check('RUOTA Riferimento: dopo l\'angolo di riferimento chiede il nuovo angolo', (await prompt()).includes('nuovo angolo'), await prompt());
await cmd('90');
const rot60 = await byId(refLine.id);
check('RUOTA Riferimento 30 → 90 ruota di 60°', Math.abs(rot60.b.x - 8050) < 1e-6 && Math.abs(rot60.b.y - 86.60254) < 1e-4 && (await prompt()) === 'Comando:', JSON.stringify(rot60));
await clickWorld(8025, 43.30127);
await cmd('M'); await cmd('S'); await cmd('@100,0');
const moved = await byId(refLine.id);
check('SPOSTA Spostamento @100,0 sposta di 100 e non dall\'ultimo punto', Math.abs(moved.a.x - 8100) < 1e-6 && Math.abs(moved.a.y) < 1e-6, JSON.stringify(moved));
await cmd('C'); await cmd('8300,0'); await cmd('20');
await clickWorld(8314.14, 14.14);
await kb.press('Control+c');
await kb.press('Control+v');
await cmd('8200,180');
const pastedC = await lastEnt();
check('copia e incolla di un solo cerchio: finisce dove si indica', pastedC.t === 'circle' && Math.abs(pastedC.c.x - 8220) < 1e-6 && Math.abs(pastedC.c.y - 200) < 1e-6, JSON.stringify(pastedC));
await page.focus('#cmdinput');
await kb.press('Delete');
check('Canc cancella la selezione anche con il cursore nella riga di comando', !(await byId(pastedC.id)));
await clickWorld(8314.14, 14.14);
await cmd('MI'); await cmd('8400,0'); await cmd('8400,100'); await cmd('si');
check('"si" senza accento vale come Sì', (await lastEnt()).t === 'circle' && Math.abs((await lastEnt()).c.x - 8500) < 1e-6 && (await prompt()) === 'Comando:', await prompt());
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);

// ==================================================================== versione 0.3
const zoomTo = async (x0, y0, x1, y1) => { await page.evaluate(b => window.app.zoomWindow({ x: b[0], y: b[1] }, { x: b[2], y: b[3] }), [x0, y0, x1, y1]); await page.waitForTimeout(50); };
const history = () => page.textContent('#history');
const docState = () => page.evaluate(() => ({ editing: window.app.doc.editing?.name ?? null, blocks: Object.fromEntries(Object.entries(window.app.doc.blocks).map(([k, d]) => [k, d.ents.length])), layers: window.app.doc.layers.map(l => [l.name, l.visible]) }));
await kb.press('Escape');
await zoomTo(8900, -100, 10100, 700);

// ---- poligono, rettangolo con dimensioni, linea dall'ultimo punto
await cmd('POL'); await cmd('6'); await cmd('9100,100'); await cmd('I'); await cmd('9150,100');
const pol = await lastEnt();
check('POLIGONO di 6 lati inscritto', pol.t === 'poly' && pol.closed && pol.pts.length === 6 && pol.pts[0].x === 9150 && pol.pts.every(p => Math.abs(Math.hypot(p.x - 9100, p.y - 100) - 50) < 1e-6) && (await prompt()) === 'Comando:', JSON.stringify(pol.pts[1]));
await cmd('REC'); await cmd('9300,0'); await cmd('D'); await cmd('200'); await cmd('100'); await cmd('9250,-50');
const recD = await lastEnt();
check('RETTANGOLO con Dimensioni, dalla parte indicata', recD.t === 'poly' && recD.pts.some(p => p.x === 9100 && p.y === -100) && recD.pts.some(p => p.x === 9300 && p.y === 0), JSON.stringify(recD.pts));
await cmd('L'); await cmd('9000,300'); await cmd('9100,300'); await cmd('');
await cmd('L'); await cmd(''); await cmd('9100,400'); await cmd('');
const cont = await lastEnt();
check('LINEA: Invio al primo punto riparte dall\'ultimo punto', cont.t === 'line' && cont.a.x === 9100 && cont.a.y === 300 && cont.b.y === 400, JSON.stringify(cont));

// ---- spezza, allunga, dividi
await cmd('L'); await cmd('9000,500'); await cmd('9400,500'); await cmd('');
const nBeforeBr = (await ents()).length;
await cmd('BR'); await clickWorld(9100, 500); await cmd('9300,500');
// il primo punto è quello del clic, preciso al pixel: si confronta con un po' di tolleranza
const brLines = (await ents()).filter(e => e.t === 'line' && e.a.y === 500 && e.b.y === 500 && e.a.x >= 9000).map(e => [e.a.x, e.b.x]).sort((p, q) => p[0] - q[0]);
check('SPEZZA toglie il tratto fra i due punti', (await ents()).length === nBeforeBr + 1 && brLines.length === 2 && brLines[0][0] === 9000 && Math.abs(brLines[0][1] - 9100) < 2 && brLines[1][0] === 9300 && brLines[1][1] === 9400 && (await prompt()) === 'Comando:', JSON.stringify(brLines));
await cmd('LEN'); await cmd('D'); await cmd('50'); await clickWorld(9390, 500); await cmd('');
check('ALLUNGA di 50 dalla parte del clic', (await ents()).some(e => e.t === 'line' && e.a.x === 9300 && e.b.x === 9450) && (await prompt()) === 'Comando:');
await cmd('L'); await cmd('9000,600'); await cmd('9400,600'); await cmd('');
const nPts = await count('point');
await cmd('DIV'); await clickWorld(9250, 600); await cmd('4');
const divPts = (await ents()).filter(e => e.t === 'point').map(e => e.p.x).sort();
check('DIVIDI in 4 mette 3 punti', (await count('point')) === nPts + 3 && divPts.join() === '9100,9200,9300', divPts.join());

// ---- modifica polilinea
await cmd('PL'); await cmd('9600,0'); await cmd('9800,0'); await cmd('9800,200'); await cmd('');
const pe0 = await lastEnt();
await cmd('PE'); await clickWorld(9650, 0); await cmd('A'); await cmd('9700,0'); await cmd(''); await cmd('C'); await cmd('');
const pe1 = await byId(pe0.id);
check('EDITPL: aggiunge un vertice e chiude', pe1.pts.length === 4 && pe1.pts[1].x === 9700 && pe1.closed === true && (await prompt()) === 'Comando:', JSON.stringify(pe1));
await cmd('PE'); await clickWorld(9650, 0); await cmd('R'); await cmd('9700,0'); await cmd(''); await cmd('');
check('EDITPL: toglie un vertice', (await byId(pe0.id)).pts.length === 3);

// ---- quota dalla linea di base, direttrice
await cmd('DLI'); await cmd('9600,400'); await cmd('9700,400'); await cmd('9650,450');
await cmd('DBA'); await cmd('9900,400'); await cmd('');
const dba = await lastEnt();
check('QUOTA dalla linea di base: stessa origine, linea più lontana', dba.t === 'dim' && dba.a.x === 9600 && dba.b.x === 9900 && Math.abs(dba.p.y - 487.5) < 1e-6, JSON.stringify(dba));
await cmd('LE'); await cmd('9600,600'); await cmd('9700,650'); await cmd('9800,650'); await cmd('');
await page.waitForSelector('.write-box textarea');
await kb.type('pilastro 30x30');
await kb.press('Control+Enter');
await page.waitForTimeout(40);
const lead = await lastEnt();
check('DIRETTRICE con testo', lead.t === 'leader' && lead.pts.length === 3 && lead.s === 'pilastro 30x30' && lead.layer === 'QUOTE' && (await prompt()) === 'Comando:', JSON.stringify(lead));

// ---- snap digitato
await cmd('L'); await cmd('MED'); await clickWorld(9062, 303); await cmd('9060,350'); await cmd('');
const medLine = await lastEnt();
check('snap digitato MED: prende il punto medio', medLine.t === 'line' && medLine.a.x === 9050 && medLine.a.y === 300, JSON.stringify(medLine));
await cmd('L'); await cmd('CEN'); await clickWorld(9062, 303);
check('snap digitato che lì non c\'è (una linea non ha un centro): il punto non viene preso', (await history()).includes('non c\'è il punto di snap') && (await prompt()).startsWith('LINEA: Specificare punto iniziale'), await prompt());
await kb.press('Escape');

// ---- zoom dentro un comando
await cmd('L'); await cmd('9500,300'); await cmd('Z');
check('Z durante LINEA apre lo zoom senza annullare', (await prompt()).startsWith('ZOOM'), await prompt());
await cmd('E');
check('finito lo zoom si torna a LINEA', (await prompt()).startsWith('LINEA: Specificare punto successivo'), await prompt());
await cmd('@100,0'); await cmd('');
const zl = await lastEnt();
check('la linea continua dal suo punto, anche dopo lo zoom', zl.a.x === 9500 && zl.a.y === 300 && zl.b.x === 9600 && zl.b.y === 300, JSON.stringify(zl));
await zoomTo(8900, -100, 10200, 700);

// ---- TAGLIA con linea di intercettazione, parole chiave di selezione
await cmd('L'); await cmd('10000,-50'); await cmd('10000,150'); await cmd('');
await cmd('L'); await cmd('9900,0'); await cmd('10100,0'); await cmd('');
await cmd('L'); await cmd('9900,100'); await cmd('10100,100'); await cmd('');
await cmd('TR'); await cmd('');
await clickWorld(10050, -30);
check('TAGLIA: un clic a vuoto apre la linea di intercettazione', (await prompt()).includes('intercettazione'), await prompt());
await clickWorld(10050, 130);
await cmd('');
const cutLines = (await ents()).filter(e => e.t === 'line' && e.a.y === e.b.y && (e.a.y === 0 || e.a.y === 100) && Math.min(e.a.x, e.b.x) === 9900).map(e => Math.max(e.a.x, e.b.x));
check('la linea di intercettazione taglia tutte e due le linee', cutLines.length === 2 && cutLines.every(x => x === 10000) && (await prompt()) === 'Comando:', JSON.stringify(cutLines));
await cmd('M'); await cmd('U');
const selU = await page.evaluate(() => [...window.app.selection]);
await cmd('TUTTO');
const selAll = await page.evaluate(() => window.app.selection.size);
check('alla richiesta di selezione: U prende l\'ultima, TUTTO tutte', selU.length === 1 && selAll > 50, `${selU.length} poi ${selAll}`);
await kb.press('Escape');

// ---- la porta segue il muro
await zoomTo(8900, -620, 9700, -280);
await cmd('MURO'); await cmd('9000,-400'); await cmd('9500,-400'); await cmd('');
await cmd('PORTA'); await clickWorld(9200, -400); await clickWorld(9200, -360);
await kb.press('Escape'); // PORTA resta attivo per metterne altre
const door0 = (await ents()).filter(e => e.t === 'door').at(-1);
await clickWorld(9450, -400);
await cmd('M'); await cmd('0,0'); await cmd('@0,-100');
const door1 = await byId(door0.id);
check('spostando il muro la porta lo segue', !!door1 && Math.abs(door1.p.y - (door0.p.y - 100)) < 1e-6 && Math.abs(door1.p.x - door0.p.x) < 1e-6, `${JSON.stringify(door0.p)} → ${JSON.stringify(door1?.p)}`);
await clickWorld(9450, -500);
await cmd('ISOLA');
const iso = (await docState()).layers.filter(l => l[1]).map(l => l[0]);
await cmd('ANNULLAISOLA');
check('ISOLA lascia solo il layer scelto, ANNULLAISOLA ripristina anche il layer corrente', iso.join() === 'MURI' && (await docState()).layers.every(l => l[1]) && (await page.evaluate(() => window.app.doc.current)) === '0', iso.join());
await clickWorld(9450, -500);
await kb.press('Delete');
check('cancellando il muro sparisce anche la porta', !(await byId(door0.id)));

// ---- avviso sui layer nascosti
await page.evaluate(() => { const d = window.app.doc; d.edit('prova', () => { d.layer('0').visible = false; }); });
await cmd('L'); await cmd('9000,-700'); await cmd('9100,-700'); await cmd('');
check('disegnare su un layer nascosto avvisa', (await history()).includes('che è nascosto'));
await cmd('ACCENDILAYER');
check('ACCENDILAYER riaccende tutto', (await docState()).layers.every(l => l[1]));

// ---- modifica di un blocco sul posto
await zoomTo(8900, -900, 9900, -500);
await cmd('C'); await cmd('9300,-700'); await cmd('20');
await clickWorld(9314.14, -685.86);
await cmd('B'); await cmd('tavolino'); await cmd('9300,-700');
const nMain = (await ents()).length;
await cmd('BE');
const inEdit = await docState();
check('MODBLOCCO apre il contenuto del blocco', inEdit.editing === 'tavolino' && (await ents()).length === 1 && (await page.textContent('#st-info')).includes('MODIFICA DEL BLOCCO'), JSON.stringify(inEdit.editing));
await cmd('L'); await cmd('0,0'); await cmd('30,0'); await cmd('');
await cmd('BC'); await cmd('S');
const afterEdit = await docState();
check('CHIUDIBLOCCO salva e torna al disegno', afterEdit.editing === null && afterEdit.blocks.tavolino === 2 && (await ents()).length === nMain && (await prompt()) === 'Comando:', JSON.stringify(afterEdit.blocks));
await kb.press('Control+z');
check('annulla riporta il blocco a com\'era', (await docState()).blocks.tavolino === 1);
await kb.press('Control+y');

// ---- arco di ellisse, eliminazione di un layer
await cmd('EL'); await cmd('A'); await cmd('9600,-700'); await cmd('9800,-700'); await cmd('50'); await cmd('9800,-700'); await cmd('9700,-600');
const elArc = await lastEnt();
check('ELLISSE Arco: un quarto di ellisse', elArc.t === 'ellipse' && Math.abs(elArc.a0) < 1e-9 && Math.abs(elArc.a1 - Math.PI / 2) < 1e-9 && Math.abs(elArc.k - 0.5) < 1e-9 && (await prompt()) === 'Comando:', JSON.stringify(elArc));
await cmd('LAYDEL'); await cmd('ARREDI');
if ((await prompt()) !== 'Comando:') await cmd('S');
check('ELIMINALAYER toglie il layer', !(await docState()).layers.some(l => l[0] === 'ARREDI') && (await prompt()) === 'Comando:');
await page.screenshot({ path: join(OUT, 'v03.png') });
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);

// ==================================================================== richieste della mail
await zoomTo(10900, -100, 11900, 700);
// ---- RACCORDA sullo spigolo di un rettangolo, e su tutta la polilinea
await cmd('REC'); await cmd('11000,0'); await cmd('@200,100');
const fr = await lastEnt();
await cmd('F'); await cmd('R'); await cmd('20');
await clickWorld(11100, 0); await clickWorld(11200, 50);
const fr1 = await byId(fr.id);
check('RACCORDA lo spigolo di un rettangolo', fr1.pts.length === 5 && Math.abs(fr1.pts[1].x - 11180) < 1e-6 && Math.abs(fr1.pts[2].y - 20) < 1e-6 && Math.abs(fr1.bulges[1] - Math.tan(Math.PI / 8)) < 1e-9 && (await prompt()) === 'Comando:', JSON.stringify(fr1.pts));
await cmd('REC'); await cmd('11300,0'); await cmd('@200,100');
const fr2 = await lastEnt();
await cmd('F'); await cmd('P'); await clickWorld(11400, 0);
check('RACCORDA Polilinea intera: quattro spigoli', (await byId(fr2.id)).pts.length === 8 && (await history()).includes('4 spigoli raccordati') && (await prompt()) === 'Comando:');
await cmd('REC'); await cmd('11600,0'); await cmd('@200,100');
const ch3 = await lastEnt();
await cmd('CHA'); await cmd('D'); await cmd('30'); await cmd('10');
await clickWorld(11700, 0); await clickWorld(11800, 50);
const ch3b = await byId(ch3.id);
check('SMUSSO lo spigolo di un rettangolo', ch3b.pts.length === 5 && Math.abs(ch3b.pts[1].x - 11770) < 1e-6 && Math.abs(ch3b.pts[2].y - 10) < 1e-6 && !ch3b.bulges, JSON.stringify(ch3b.pts));

// ---- retini: scelta e passo
await cmd('REC'); await cmd('11000,200'); await cmd('@200,150');
await cmd('H'); await cmd('P'); await cmd('M'); await cmd('PA'); await cmd('25');
check('TRATTEGGIO: retino Mattoni con passo 25 nel prompt', (await prompt()).includes('Mattoni') && (await prompt()).includes('passo 25'), await prompt());
await clickWorld(11100, 275);
await kb.press('Escape');
const hb = await lastEnt();
check('TRATTEGGIO a mattoni creato', hb.t === 'hatch' && hb.pat === 'brick' && hb.sp === 25, JSON.stringify({ pat: hb.pat, sp: hb.sp }));
await clickWorld(11110, 275); // su un corso del retino, lontano dal contorno
const hPanel = await page.evaluate(() => [...document.querySelectorAll('#props .prop')].map(p => p.querySelector('span')?.textContent).join('|'));
check('pannello del tratteggio: retino, passo e angolo', /Pattern/.test(hPanel) && /Passo/.test(hPanel) && /Angolo/.test(hPanel) && (await page.evaluate(() => document.querySelectorAll('#props select option[value="brick"]').length)) === 1, hPanel);
await kb.press('Escape');

// ---- retini nuovi, muro con il retino, quota sul filo del muro
const viewBefore = await page.evaluate(() => { const b = window.app.view.visibleBox(); return [b.x0, b.y0, b.x1, b.y1]; });
await cmd('H'); await cmd('P');
const patPrompt = await prompt();
check('TRATTEGGIO: fra i retini ci sono spina di pesce, listoni, zig-zag e calcestruzzo', ['Spina di pesce', 'ListoniSfalsati', 'Zig-zag', 'Calcestruzzo', 'Doppie a 45'].every(s => patPrompt.includes(s)), patPrompt);
await cmd('S');
check('TRATTEGGIO: scelta la spina di pesce', (await prompt()).includes('Spina di pesce'), await prompt());
await cmd('P'); await cmd('M'); await kb.press('Escape');
await zoomTo(19900, -150, 20600, 450);
await cmd('MURO'); await cmd('R');
check('MURO: l\'opzione Riempimento propone Normale e i retini', (await prompt()).includes('Normale') && (await prompt()).includes('Mattoni'), await prompt());
await cmd('45');
check('MURO: il retino scelto compare nel prompt', (await prompt()).includes('Linee a 45°'), await prompt());
await cmd('20000,0'); await cmd('20400,0'); await cmd('20400,300'); await cmd('');
const wp = (await ents()).filter(e => e.t === 'wall').slice(-2);
check('MURO con Riempimento: i muri nascono con il retino', wp.length === 2 && wp.every(w => w.pat === 'ansi31') && wp[0].a.x === 20000, JSON.stringify(wp));
await cmd('MURO'); await cmd('R'); await cmd('N');
check('MURO: Riempimento Normale toglie il retino', !(await prompt()).includes('Linee a 45°'), await prompt());
// misure interne: i punti dati sono gli spigoli interni della stanza, in qualunque verso la si disegni
await cmd('G');
const justPrompt = await prompt();
check('MURO: Giustificazione propone interne, esterne, asse e i due fili', ['Interne', 'Esterne', 'Centro', 'Sinistra', 'Destra'].every(x => justPrompt.includes(x)), justPrompt);
await cmd('I');
await cmd('21000,0'); await cmd('21300,0'); await cmd('21300,200'); await cmd('21000,200'); await cmd('C');
const hI = wp[0].th / 2;
const near2 = (p, x, y) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6;
const wIn = (await ents()).filter(e => e.t === 'wall').slice(-4);
check('MURO con misure interne, in senso antiorario: lo spessore va all\'esterno', near2(wIn[0].a, 21000 - hI, -hI) && near2(wIn[0].b, 21300 + hI, -hI) && near2(wIn[2].a, 21300 + hI, 200 + hI), JSON.stringify(wIn.map(w => [w.a, w.b])));
const innerOf = id => page.evaluate(id => { const i = window.app.doc.ctx().walls.walls.get(id); return [i.sl, i.el, i.sr, i.er]; }, id);
const inn = await innerOf(wIn[0].id);
check('MURO con misure interne: il filo interno misura quanto digitato (300)', inn.some(q => near2(q, 21000, 0)) && inn.some(q => near2(q, 21300, 0)), JSON.stringify(inn));
await cmd('MURO'); await cmd('21000,-600'); await cmd('21000,-400'); await cmd('21300,-400'); await cmd('21300,-600'); await cmd('C');
const wCw = (await ents()).filter(e => e.t === 'wall').slice(-4);
check('MURO con misure interne, in senso orario: lo spessore va ancora all\'esterno', near2(wCw[0].a, 21000 - hI, -600 - hI) && near2(wCw[1].b, 21300 + hI, -400 + hI), JSON.stringify(wCw.map(w => [w.a, w.b])));
// stanza chiusa tornando sul punto di partenza invece che con Chiudi: i quattro angoli sono giuntati lo stesso
await cmd('MURO'); await cmd('21000,-1600'); await cmd('21200,-1600'); await cmd('21200,-1300'); await cmd('21000,-1300'); await cmd('21000,-1600');
const wBack = (await ents()).filter(e => e.t === 'wall').slice(-4);
const capsBack = await page.evaluate(ids => ids.map(id => { const i = window.app.doc.ctx().walls.walls.get(id); return i.capS || i.capE; }), wBack.map(w => w.id));
check('MURO: tornando sul primo punto la stanza si chiude e il comando finisce', (await prompt()) === 'Comando:' && near2(wBack[0].a, 21000 - hI, -1600 - hI) && near2(wBack[3].b, 21000 - hI, -1600 - hI) && capsBack.every(c => !c), JSON.stringify([wBack.map(w => [w.a, w.b]), capsBack]));
await cmd('MURO'); await cmd('G'); await cmd('E'); await cmd('21000,-1000'); await cmd('21300,-1000'); await cmd('21300,-800'); await cmd('');
const wEx = (await ents()).filter(e => e.t === 'wall').slice(-2);
check('MURO con misure esterne: lo spessore va all\'interno', near2(wEx[0].a, 21000, -1000 + hI) && near2(wEx[0].b, 21300 - hI, -1000 + hI), JSON.stringify(wEx.map(w => [w.a, w.b])));
await cmd('MURO'); await cmd('G'); await cmd('C');
await kb.press('Escape');
const hw = wp[0].th / 2;
await clickWorld(20200, hw);
const wPanel = await page.evaluate(() => [...document.querySelectorAll('#props .prop')].map(p => (p.querySelector('span')?.textContent ?? '') + '=' + (p.querySelector('input,select')?.value ?? '')).join('|'));
check('pannello del muro: riempimento e passo del retino', /Riempimento=ansi31/.test(wPanel) && /Passo retino=/.test(wPanel), wPanel);
await kb.press('Escape');
await cmd('QL'); await cmd('');
await clickWorld(20200, hw); // il filo interno del muro in basso: l'altro muro sale da lì
await cmd('20200,150');
const dw = await lastEnt();
check('QUOTA selezionando un muro, messa all\'interno: misura il filo interno, da spigolo a spigolo',
  dw.t === 'dim' && Math.abs(dw.a.y - hw) < 1e-6 && Math.abs(dw.b.y - hw) < 1e-6 && Math.abs(Math.abs(dw.b.x - dw.a.x) - (400 - hw)) < 1e-6, JSON.stringify([dw.a, dw.b, hw]));
await cmd('QL'); await cmd('');
await clickWorld(20200, hw); // stesso clic sul filo interno, ma la quota va messa fuori
await cmd('20200,-150');
const dw2 = await lastEnt();
check('QUOTA selezionando un muro, messa all\'esterno: misura il filo esterno', Math.abs(dw2.a.y + hw) < 1e-6 && Math.abs(Math.abs(dw2.b.x - dw2.a.x) - (400 + hw)) < 1e-6, JSON.stringify([dw2.a, dw2.b]));

// ---- grip dei blocchi: con il punto base lontano c'è anche un grip al centro, e lo sposta
await cmd('REC'); await cmd('20000,-500'); await cmd('@80,60');
await zoomTo(19950, -550, 20250, -350);
await clickWorld(20000, -470);
await cmd('BLOCCO'); await cmd('lontano'); await cmd('19000,-500');
await zoomTo(18900, -900, 20300, -100);
const farIns = await lastEnt();
const farGrips = await page.evaluate(async id => (await import('/src/model/entities.ts')).grips(window.app.doc.byId(id), window.app.doc.ctx()), farIns.id);
check('blocco con il punto base lontano: grip sul punto base e al centro', farGrips.length === 2 && farGrips[0].x === 19000 && Math.abs(farGrips[1].x - 20040) < 1e-6 && Math.abs(farGrips[1].y + 470) < 1e-6, JSON.stringify(farGrips));
await clickWorld(20040, -470);
check('clic sul grip al centro del blocco: parte lo spostamento', (await prompt()).includes('STIRA'), await prompt());
await cmd('20140,-470');
const farMoved = await byId(farIns.id);
check('il grip al centro sposta il blocco intero', Math.abs(farMoved.p.x - 19100) < 1e-6 && Math.abs(farMoved.p.y + 500) < 1e-6 && (await prompt()) === 'Comando:', JSON.stringify(farMoved.p));
await kb.press('Escape');
// un muro solo, con le misure interne: non c'è una stanza, il muro sta sull'asse dei punti dati
await cmd('MURO'); await cmd('G'); await cmd('I'); await cmd('22000,0'); await cmd('22400,0'); await cmd('');
const wOne = await lastEnt();
check('MURO di un tratto solo con le misure interne: sull\'asse', wOne.t === 'wall' && wOne.a.y === 0 && wOne.b.y === 0, JSON.stringify(wOne));
await cmd('MURO'); await cmd('G'); await cmd('C'); await kb.press('Escape');

// ---- il punto base si aggancia agli angoli dell'oggetto stesso che si sposta
await zoomTo(23900, -100, 24300, 200);
await cmd('REC'); await cmd('24000,0'); await cmd('@100,50');
const recB = await lastEnt();
await page.evaluate(id => window.app.setSelection([id]), recB.id);
await cmd('SPOSTA');
await clickWorld(24001.5, 1.2); // vicino all'angolo, non sopra
await cmd('24200,0');
const recB2 = await byId(recB.id);
check('SPOSTA: il punto base si aggancia all\'angolo dell\'oggetto selezionato', recB2.pts.some(q => q.x === 24200 && q.y === 0), JSON.stringify(recB2.pts));
await page.evaluate(id => window.app.setSelection([id]), recB.id);
await cmd('RUOTA');
await clickWorld(24201, 0.9);
await cmd('90');
const recB3 = await byId(recB.id);
check('RUOTA: il centro si aggancia all\'angolo dell\'oggetto selezionato, che resta fermo', recB3.pts.some(q => Math.abs(q.x - 24200) < 1e-6 && Math.abs(q.y) < 1e-6) && recB3.pts.some(q => Math.abs(q.x - 24200) < 1e-6 && Math.abs(q.y - 100) < 1e-6), JSON.stringify(recB3.pts));

// ---- finestre dei comandi (accese, come per chi usa il programma)
await cmd('IMPOSTAZIONI');
check('Impostazioni: il modo di lavorare è la prima scelta, qui con la sola riga di comando', (await page.evaluate(() => document.querySelector('.modal select')?.getAttribute('name'))) === 'cmd-mode' && (await page.inputValue('.modal select[name="cmd-mode"]')) === 'cmdline');
await page.selectOption('.modal select[name="cmd-mode"]', 'dialogs');
await page.click('.modal-foot button:has-text("Salva")');
check('Impostazioni: scelto "Con le finestre", vale', (await page.evaluate(() => localStorage.getItem('planimetrie.dialogs'))) === '1');
const modalOpen = () => page.evaluate(() => !!document.querySelector('.modal'));
const thBefore = await page.evaluate(() => window.app.doc.settings.wallTh);
await cmd('MURO');
check('MURO apre la finestra: spessore, misure e riempimento con i retini disegnati', (await modalOpen()) && (await page.locator('.modal .tile canvas').count()) === 14 && (await page.locator('.modal .seg button').count()) === 5, String(await page.locator('.modal .tile').count()));
await page.fill('.modal input[name="th"]', '12');
await page.click('.modal .tile[data-value="brick"]');
await page.click('.modal .seg button[data-value="C"]');
await kb.press('Enter');
check('finestra del muro: OK e i valori valgono', !(await modalOpen()) && (await prompt()).includes('spessore 12') && (await prompt()).includes('Mattoni') && (await prompt()).includes('asse'), await prompt());
await kb.press('Escape');
await cmd('MURO');
await page.fill('.modal input[name="th"]', 'abc');
await kb.press('Enter');
check('finestra del muro: un numero sbagliato la tiene aperta e lo segnala', (await modalOpen()) && /non valido/.test(await page.textContent('.modal')), await page.textContent('.modal small.err'));
await kb.press('Escape');
check('finestra del muro: Esc annulla il comando', !(await modalOpen()) && (await prompt()) === 'Comando:', await prompt());
await cmd('MURO');
await page.fill('.modal input[name="th"]', String(thBefore).replace('.', ','));
await page.click('.modal .tile[data-value=""]');
await kb.press('Enter'); await kb.press('Escape');
await cmd('H');
check('TRATTEGGIO apre la finestra con i retini disegnati', (await modalOpen()) && (await page.locator('.modal .tile').count()) === 13);
await page.dblclick('.modal .tile[data-value="herring"]');
check('TRATTEGGIO: doppio clic su un retino lo sceglie e chiude la finestra', !(await modalOpen()) && (await prompt()).includes('Spina di pesce'), await prompt());
await kb.press('Escape');
await cmd('I');
const nBlocks = await page.evaluate(() => Object.keys(window.app.doc.blocks).length);
check('INSERISCI apre la finestra con le miniature dei blocchi', (await modalOpen()) && (await page.locator('.modal .tile canvas').count()) === nBlocks && nBlocks > 0, String(nBlocks));
await page.fill('.modal input[name="s"]', '2');
await kb.press('Enter');
check('INSERISCI: scala dalla finestra, poi si indica il punto', !(await modalOpen()) && (await prompt()).includes('scala 2'), await prompt());
await kb.press('Escape');
await cmd('L'); await cmd('23000,0'); await cmd('23100,0'); await cmd('');
const rl = await lastEnt();
await page.evaluate(id => window.app.setSelection([id]), rl.id);
await cmd('RUOTA'); await cmd('23000,0');
check('RUOTA: dato il punto base, l\'angolo nella finestra (con "Col mouse")', (await modalOpen()) && (await page.textContent('.modal')).includes('Col mouse'));
await page.fill('.modal input[name="a"]', '90');
await kb.press('Enter');
const rl2 = await byId(rl.id);
check('RUOTA con l\'angolo della finestra', Math.abs(rl2.b.x - 23000) < 1e-6 && Math.abs(rl2.b.y - 100) < 1e-6 && (await prompt()) === 'Comando:', JSON.stringify(rl2));
await page.evaluate(id => window.app.setSelection([id]), rl.id);
await cmd('SERIE');
const visibleField = name => page.evaluate(n => { const i = document.querySelector(`.modal input[name="${n}"]`); return !!i && i.closest('.field').style.display !== 'none'; }, name);
check('SERIE apre la finestra con i campi della serie rettangolare', (await visibleField('rows')) && !(await visibleField('n')));
await page.click('.modal .seg button[data-value="P"]');
check('SERIE: scegliendo Polare si vedono i suoi campi', !(await visibleField('rows')) && (await visibleField('n')));
await page.fill('.modal input[name="n"]', '4');
await kb.press('Enter');
const nBeforeSerie = (await ents()).length;
await cmd('23000,-200');
check('SERIE polare dalla finestra: dato il centro, le copie ci sono', (await ents()).length === nBeforeSerie + 3 && (await prompt()) === 'Comando:', String((await ents()).length - nBeforeSerie));
await page.evaluate(id => window.app.setSelection([id]), rl.id);
await cmd('BLOCCO'); await cmd('sedia');
check('BLOCCO con un nome che c\'è già: la domanda in una finestra con Sì e No', (await modalOpen()) && (await page.textContent('.modal')).includes('ridefinirlo'), await page.textContent('#prompt'));
await page.click('.modal-foot button:has-text("No")');
check('domanda in finestra: No torna alla richiesta del nome', !(await modalOpen()) && (await prompt()).includes('Nome del blocco'), await prompt());
await kb.press('Escape');
await page.evaluate(() => localStorage.setItem('planimetrie.dialogs', '0'));

await zoomTo(...viewBefore);

// ---- AREA con un clic dentro
await cmd('L'); await cmd('11300,200'); await cmd('11500,200'); await cmd('11500,300'); await cmd('11300,300'); await cmd('C');
await cmd('AA'); await cmd('I'); await clickWorld(11400, 250);
check('AREA Interno: 200 × 100 dentro quattro linee', /Area = 20000 cm² \(2 m²\);\s+Perimetro = 600/.test(await history()) && (await prompt()) === 'Comando:', (await history()).slice(-120));

// ---- Copia proprietà con Impostazioni
await cmd('L'); await cmd('11600,200'); await cmd('11800,200'); await cmd('');
const mpA = await lastEnt();
await cmd('L'); await cmd('11600,300'); await cmd('11800,300'); await cmd('');
const mpB = await lastEnt();
await page.evaluate(id => { const d = window.app.doc; d.edit('prova', () => d.replace([{ ...d.byId(id), layer: 'TESTI', color: '#ff0000', lt: 'dashed' }])); }, mpA.id);
await cmd('MA'); await cmd('I');
await page.waitForSelector('.modal input[type=checkbox]');
const nChecks = await page.evaluate(() => document.querySelectorAll('.modal input[type=checkbox]').length);
await page.evaluate(() => { document.querySelectorAll('.modal input[type=checkbox]')[0].click(); });
await page.click('.modal button.primary');
await page.waitForTimeout(80);
await clickWorld(11700, 200); await clickWorld(11700, 300); await cmd('');
const mpB2 = await byId(mpB.id);
check('COPIA PROPRIETÀ con Impostazioni: senza il layer, il resto sì', nChecks === 6 && mpB2.layer === '0' && mpB2.color === '#ff0000' && mpB2.lt === 'dashed', JSON.stringify(mpB2));
await page.evaluate(() => { /* per i passi dopo: di nuovo tutte le proprietà */ });
await cmd('MA'); await cmd('I');
await page.waitForSelector('.modal input[type=checkbox]');
await page.evaluate(() => { document.querySelectorAll('.modal input[type=checkbox]')[0].click(); });
await page.click('.modal button.primary');
await page.waitForTimeout(80);
await kb.press('Escape');

// ---- immagine
const pngPath = join(OUT, 'logo.png');
// un'immagine vera, 40 × 20, arancione con una fascia blu: la disegna il browser stesso
const pngData = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 20;
  const g = c.getContext('2d');
  g.fillStyle = '#ff8800'; g.fillRect(0, 0, 40, 20);
  g.fillStyle = '#2060ff'; g.fillRect(0, 0, 40, 6);
  return c.toDataURL('image/png').split(',')[1];
});
writeFileSync(pngPath, Buffer.from(pngData, 'base64'));
const imgChooser = page.waitForEvent('filechooser');
await cmd('IMMAGINE');
await (await imgChooser).setFiles(pngPath);
await page.waitForFunction(() => document.getElementById('prompt').textContent.includes('punto di inserimento'), null, { timeout: 10000 });
await cmd('11000,450'); await cmd('11200,450');
const img = await lastEnt();
check('IMMAGINE: inserita con le sue proporzioni (2 a 1)', img.t === 'image' && img.p.x === 11000 && img.w === 200 && Math.abs(img.h - 100) < 1e-6 && img.src.startsWith('data:image/png') && (await prompt()) === 'Comando:', JSON.stringify({ ...img, src: img.src.slice(0, 20) }));
await page.waitForTimeout(300);
// il colore al centro dell'immagine sullo schermo deve essere il suo arancione, e in alto la fascia blu
const pix = await page.evaluate(() => {
  const cv = document.getElementById('base');
  const k = cv.width / cv.getBoundingClientRect().width;
  const at = (x, y) => { const p = window.app.view.toScreen({ x, y }); return [...cv.getContext('2d').getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data].slice(0, 3).join(); };
  return [at(11100, 480), at(11100, 540)];
});
check('l\'immagine si vede sul disegno, dritta', pix[0] === '255,136,0' && pix[1] === '32,96,255', pix.join(' | '));
await page.screenshot({ path: join(OUT, 'mail.png') });
await kb.press('Control+p');
await page.waitForSelector('.print-preview svg');
await page.selectOption('.print-form select >> nth=2', '0'); // adatta al foglio: a 1:100 il disegno di prova non ci sta
await page.waitForTimeout(150);
check('la stampa contiene l\'immagine', (await page.evaluate(() => document.querySelectorAll('.print-preview svg image').length)) >= 1);
await kb.press('Escape');
await page.evaluate(() => window.app.zoomExtents());
await page.waitForTimeout(50);

// ---- comando sconosciuto
await cmd('PIPPO');
check('comando sconosciuto segnalato', (await page.textContent('#history')).includes('Comando sconosciuto'));

// ================================================================ versione 0.4
const NL = String.fromCharCode(10);
await kb.press('Escape');
await page.evaluate(() => window.app.zoomWindow({ x: 19800, y: 19700 }, { x: 20700, y: 20200 }));
await page.waitForTimeout(60);

// ---- testo su più righe: riquadro che cresce, Invio va a capo
await cmd('T'); await cmd('20000,20000'); await cmd('20'); await cmd('0');
await page.waitForSelector('.write-box textarea');
const boxH = () => page.evaluate(() => { const t = document.querySelector('.write-box textarea'); return { h: t.clientHeight, sh: t.scrollHeight, w: t.clientWidth, sw: t.scrollWidth }; });
const h0 = await boxH();
await kb.type('Bagno');
await kb.press('Enter');
await kb.type('piastrelle 60x60');
await page.waitForTimeout(40);
const prevText = await page.evaluate(() => window.app.tool?.preview({ x: 0, y: 0 })[0]?.s);
check('TESTO: anteprima nel disegno mentre si scrive, con gli a capo', prevText === 'Bagno' + NL + 'piastrelle 60x60', JSON.stringify(prevText));
await kb.press('Enter'); await kb.type('terza riga'); await kb.press('Enter'); await kb.type('quarta riga molto lunga, per vedere che il riquadro si allarga insieme a quello che si scrive');
await page.waitForTimeout(40);
const h1 = await boxH();
check('TESTO: il riquadro cresce e mostra tutte le righe', h1.h > h0.h && h1.sh <= h1.h + 2 && h1.w > h0.w && h1.sw <= h1.w + 2, JSON.stringify([h0, h1]));
await page.screenshot({ path: join(OUT, 'testo-riquadro.png') });
for (let i = 0; i < 2; i++) { await kb.press('Shift+Home'); await kb.press('Backspace'); await kb.press('Backspace'); }
await kb.press('Control+Enter');
await page.waitForTimeout(40);
const mt = await lastEnt();
check('TESTO: Invio va a capo, Ctrl+Invio conferma', mt.t === 'text' && mt.s === 'Bagno' + NL + 'piastrelle 60x60' && (await prompt()) === 'Comando:', JSON.stringify(mt));
check('TESTO: la prima riga sta sul punto cliccato, la seconda sotto', mt.p.x === 20000 && Math.abs(mt.p.y - 19970) < 1e-6, JSON.stringify(mt.p));

// ---- doppio clic: si modifica nello stesso riquadro
const edge = await toScreen(20000, 19985);
await page.mouse.dblclick(edge.x, edge.y);
await page.waitForSelector('.write-box textarea');
check('doppio clic su un testo: riquadro con le sue righe', (await page.inputValue('.write-box textarea')) === mt.s);
await kb.press('Enter'); await kb.type('fuga 2 mm');
await page.click('.write-box button.primary');
await page.waitForTimeout(40);
const mt2 = await byId(mt.id);
check('modifica del testo: riga aggiunta sotto, la prima non si sposta', mt2.s === mt.s + NL + 'fuga 2 mm' && Math.abs(mt2.p.y - 19940) < 1e-6, JSON.stringify(mt2));
await page.mouse.dblclick(edge.x, edge.y);
await page.waitForSelector('.write-box textarea');
await kb.type('zzz'); await kb.press('Escape');
await page.waitForTimeout(40);
check('modifica del testo: Esc lascia tutto com\'era', (await byId(mt.id)).s === mt2.s && !(await page.$('.write-box')));

// ---- pannello Proprietà: casella a più righe
await page.evaluate(id => window.app.setSelection([id]), mt.id);
await page.waitForSelector('#props textarea');
check('Proprietà: il testo si vede su più righe', (await page.inputValue('#props textarea')) === mt2.s && await page.evaluate(() => { const t = document.querySelector('#props textarea'); return t.scrollHeight <= t.clientHeight + 2 && t.clientHeight > 40; }));
await page.fill('#props textarea', 'A' + NL + 'B');
await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(40);
check('Proprietà: testo cambiato su due righe', (await byId(mt.id)).s === 'A' + NL + 'B', (await byId(mt.id)).s);
await kb.press('Escape');

// ---- clic fuori dal riquadro: il destro non fa niente, il sinistro conferma
const nTxt0 = (await ents()).length;
await page.mouse.dblclick(edge.x, edge.y);
await page.waitForSelector('.write-box textarea');
await kb.type('C');
const out = await toScreen(20500, 20150);
await page.mouse.click(out.x, out.y, { button: 'right' });
await page.waitForTimeout(60);
check('riquadro di scrittura: il clic destro fuori non conferma e non rilancia comandi', !!(await page.$('.write-box')) && (await byId(mt.id)).s === 'A' + NL + 'B' && (await prompt()) === 'Comando:');
for (let i = 0; i < 4; i++) await kb.press('Tab');
check('riquadro di scrittura: Tab resta dentro il riquadro', await page.evaluate(() => !!document.activeElement.closest('.write-box')));
await page.waitForTimeout(450);
await page.mouse.click(out.x, out.y);
await page.waitForTimeout(60);
check('riquadro di scrittura: il clic sinistro fuori conferma', !(await page.$('.write-box')) && (await byId(mt.id)).s === 'A' + NL + 'BC' && (await ents()).length === nTxt0, (await byId(mt.id)).s);
await kb.press('Escape');

// ---- nome di un locale su due righe: si modifica senza perdere l'a capo
const roomId = await page.evaluate(nl => {
  const d = window.app.doc;
  d.edit('locale', () => { d.add({ t: 'room', pts: [{ x: 20300, y: 19750 }, { x: 20600, y: 19750 }, { x: 20600, y: 19950 }, { x: 20300, y: 19950 }], name: 'Soggiorno' + nl + 'Cucina', layer: '0' }); });
  const id = d.ents.at(-1).id;
  window.app.editText(d.byId(id));
  return id;
}, NL);
await page.waitForSelector('.write-box textarea');
check('nome del locale su due righe: il riquadro le mostra', (await page.inputValue('.write-box textarea')) === 'Soggiorno' + NL + 'Cucina');
await kb.type(' abitabile');
await kb.press('Control+Enter');
await page.waitForTimeout(40);
check('nome del locale: l\'a capo resta', (await byId(roomId)).name === 'Soggiorno' + NL + 'Cucina abitabile', (await byId(roomId)).name);

// ---- cartiglio: Nome cliente, Posa gres, Note, su più righe e salvati nel disegno
await cmd('PRINT');
await page.waitForSelector('.print-preview svg');
const tas = page.locator('.title-fields textarea');
check('cartiglio: tre caselle (Nome cliente, Posa gres, Note)', (await tas.count()) === 3 && (await page.textContent('.title-fields')).includes('Nome cliente') && !(await page.textContent('.print-form')).includes('Disegnatore'));
await tas.nth(0).fill('Rossi Mario');
await tas.nth(1).fill('60x60 a correre');
await tas.nth(2).click();
const n0 = await tas.nth(2).evaluate(t => t.clientHeight);
await kb.type('fuga 2 mm'); await kb.press('Enter'); await kb.type('battiscopa'); await kb.press('Enter'); await kb.type('terza'); await kb.press('Enter'); await kb.type('quarta'); await kb.press('Enter'); await kb.type('quinta');
await page.waitForTimeout(400);
const n1 = await tas.nth(2).evaluate(t => ({ h: t.clientHeight, sh: t.scrollHeight }));
check('cartiglio: Invio va a capo nella casella, che cresce (e non fa partire la stampa)', !!(await page.$('.modal')) && n1.h > n0 && n1.sh <= n1.h + 2, JSON.stringify([n0, n1]));
const tbText = await page.evaluate(() => [...document.querySelectorAll('.print-preview svg > text')].map(t => t.textContent));
check('cartiglio in stampa: le tre voci nuove con le righe scritte', ['NOME CLIENTE', 'POSA GRES', 'NOTE', 'Rossi Mario', '60x60 a correre', 'fuga 2 mm', 'battiscopa', 'quinta'].every(s => tbText.includes(s)), tbText.join(' | '));
check('cartiglio in stampa: niente scala, data, tavola, disegnatore', !tbText.some(s => ['SCALA', 'DATA', 'TAVOLA', 'DISEGNATORE', 'PROGETTO', 'OGGETTO'].includes(s)), tbText.join(' | '));
await page.screenshot({ path: join(OUT, 'cartiglio.png') });
check('cartiglio: le scritte stanno nel disegno', await page.evaluate(() => window.app.doc.toData().cartiglio?.note) === ['fuga 2 mm', 'battiscopa', 'terza', 'quarta', 'quinta'].join(NL));
await kb.press('Escape');
await page.waitForTimeout(40);

// ---- stampa di una finestra scelta sul disegno: solo quella, adattata al foglio
await page.evaluate(() => {
  const d = window.app.doc;
  d.edit('prova stampa', () => {
    d.add({ t: 'circle', c: { x: 30100, y: 30100 }, r: 50, layer: '0' });
    d.add({ t: 'circle', c: { x: 30400, y: 30100 }, r: 50, layer: '0' });
  });
  window.app.zoomWindow({ x: 29900, y: 29900 }, { x: 30700, y: 30300 });
});
await page.waitForTimeout(60);
const circleIds = (await ents()).slice(-2).map(e => e.id);
const nCircles = () => page.evaluate(() => document.querySelectorAll('.print-preview svg g circle').length);
await cmd('PRINT');
await page.waitForSelector('.print-preview svg');
await page.selectOption('.print-form select >> nth=2', '100');
await page.click('.print-form button.small');
check('finestra di stampa: la finestra di dialogo si chiude per scegliere sul disegno', !(await page.$('.modal')));
await clickWorld(30020, 30020);
await clickWorld(30180, 30180);
await page.waitForSelector('.print-preview svg');
check('finestra di stampa con due clic: si stampa solo quello che c\'è dentro', (await nCircles()) === 1 && (await page.inputValue('.print-form select >> nth=3')) === 'win', String(await nCircles()));
const winInfo = await page.textContent('.print-info');
check('finestra di stampa: adattata al foglio, non alla scala di prima', (await page.inputValue('.print-form select >> nth=2')) === '0' && winInfo.includes('entra nel foglio') && !winInfo.includes('1:100 '), winInfo);
const clipW = await page.evaluate(() => parseFloat(document.querySelector('.print-preview svg clipPath rect').getAttribute('width')));
check('finestra di stampa: il resto del foglio resta bianco', clipW > 50 && clipW < 400, String(clipW));
// si può scegliere anche trascinando
await page.click('.print-form button.small');
const d0 = await toScreen(30320, 30020), d1 = await toScreen(30480, 30180);
await page.mouse.move(d0.x, d0.y); await page.mouse.down(); await page.mouse.move((d0.x + d1.x) / 2, (d0.y + d1.y) / 2); await page.mouse.move(d1.x, d1.y); await page.mouse.up();
await page.waitForSelector('.print-preview svg');
check('finestra di stampa trascinando', (await nCircles()) === 1 && Math.abs((await page.evaluate(() => window.app.printWin.x0)) - 30320) < 3, JSON.stringify(await page.evaluate(() => window.app.printWin)));
await kb.press('Escape');
// solo gli oggetti selezionati
await page.evaluate(id => window.app.setSelection([id]), circleIds[0]);
await cmd('PRINT');
await page.waitForSelector('.print-preview svg');
await page.selectOption('.print-form select >> nth=3', 'sel');
await page.waitForTimeout(60);
check('stampa dei soli oggetti selezionati', (await nCircles()) === 1 && (await page.evaluate(() => document.querySelectorAll('.print-preview svg g > *').length)) === 1);
await kb.press('Escape');
await kb.press('Escape');

// ---- barra di stato: tipi di snap e passo dello snap senza passare dalle Impostazioni
await page.click('#st-osnap-more');
await page.waitForSelector('.st-pop');
check('menu ESNAP: gli otto tipi di snap', (await page.locator('.st-pop input[type=checkbox]').count()) === 8 && (await page.textContent('.st-pop')).includes('Perpendicolare'));
await page.locator('.st-pop label', { hasText: 'Vicino' }).click();
check('menu ESNAP: il tipo scelto vale subito', await page.evaluate(() => window.app.snapSt.modes.has('near')));
await page.locator('.st-pop label', { hasText: 'Vicino' }).click();
await page.screenshot({ path: join(OUT, 'menu-snap.png') });
await kb.press('Escape');
check('menu ESNAP: Esc lo chiude', !(await page.$('.st-pop')));
await page.click('#st-snap', { button: 'right' });
await page.waitForSelector('.st-pop input[type=text]');
await page.fill('.st-pop input[type=text]', '2,5');
await kb.press('Enter');
await page.waitForTimeout(40);
check('menu SNAP (clic destro): passo dello snap cambiato e snap acceso', await page.evaluate(() => window.app.doc.settings.snap === 2.5 && window.app.snapSt.gridSnap) && !(await page.$('.st-pop')),
  JSON.stringify(await page.evaluate(() => ({ passo: window.app.doc.settings.snap, unita: window.app.doc.settings.units, snap: window.app.snapSt.gridSnap, menuAperto: !!document.querySelector('.st-pop') }))));
await cmd('L'); await clickWorld(30101.1, 30201.4); await clickWorld(30151.2, 30201.3); await cmd('');
const snapped = await lastEnt();
check('con lo snap acceso i punti cadono sui multipli del passo', snapped.t === 'line' && [snapped.a.x, snapped.a.y, snapped.b.x, snapped.b.y].every(n => Math.abs(n / 2.5 - Math.round(n / 2.5)) < 1e-9), JSON.stringify(snapped));
await kb.press('F9');
check('icone diverse per SPOSTA e PAN', await page.evaluate(() => { const q = t => document.querySelector('#toolbar button[title^="' + t + '"]')?.innerHTML; return !!q('Sposta') && !!q('Pan') && q('Sposta') !== q('Pan'); }));

// ---- file base e salvataggi: Nuovo da file base, Salva, Salva con nome
const basePath = join(OUT, 'base.kalista');
const baseData = await page.evaluate(() => JSON.stringify(window.app.doc.toData()));
writeFileSync(basePath, baseData);
await page.evaluate(() => {
  window.__saved = []; window.__asked = 0;
  const handle = name => ({ name, createWritable: async () => ({ write: async d => { window.__saved.push({ name, len: d.length }); }, close: async () => {} }) });
  window.__handle = handle;
  window.showSaveFilePicker = async o => { window.__asked++; return handle(o.suggestedName); };
  window.app.doc.dirty = false;
});
const nEnts = (await ents()).length;
const baseCh = page.waitForEvent('filechooser');
await cmd('NUOVODA');
await (await baseCh).setFiles(basePath);
await page.waitForFunction(() => document.getElementById('history').textContent.includes('Nuovo disegno dal file base base.kalista'));
check('NUOVODA: il file base si apre come copia senza nome', (await page.title()).startsWith('Senza nome') && (await ents()).length === nEnts, await page.title());
check('NUOVODA: porta con sé anche il cartiglio del file base', await page.evaluate(() => window.app.doc.cartiglio.posa) === '60x60 a correre');
await kb.press('Control+s');
await page.waitForFunction(() => window.__saved.length === 1);
check('primo Salva dopo il file base: chiede il nome e propone quello del cliente', await page.evaluate(() => window.__asked === 1 && window.__saved[0].name === 'Rossi Mario.kalista'), JSON.stringify(await page.evaluate(() => window.__saved)));
check('dopo il salvataggio il disegno ha il nome nuovo', (await page.title()).startsWith('Rossi Mario'), await page.title());
await cmd('L'); await cmd('20000,19800'); await cmd('20100,19800'); await cmd('');
await kb.press('Control+s');
await page.waitForFunction(() => window.__saved.length === 2);
check('Salva successivo: stesso file, senza chiedere', await page.evaluate(() => window.__asked === 1 && window.__saved[1].name === 'Rossi Mario.kalista' && window.__saved[1].len > window.__saved[0].len));
await page.click('#toolbar button[title^="Salva con nome"]');
await page.waitForFunction(() => window.__saved.length === 3);
check('pulsante Salva con nome: chiede un file nuovo', await page.evaluate(() => window.__asked === 2));
check('pulsante Nuovo da un file base nella barra', !!(await page.$('#toolbar button[title^="Nuovo da un file base"]')));
// Apri con il selettore del browser: Salva riscrive il file aperto
await page.evaluate(data => {
  window.showOpenFilePicker = async () => [{ ...window.__handle('cliente2.kalista'), getFile: async () => new File([data], 'cliente2.kalista') }];
  window.app.doc.dirty = false;
}, baseData);
await cmd('APRI');
await page.waitForFunction(() => document.getElementById('history').textContent.includes('Aperto cliente2.kalista'));
await cmd('L'); await cmd('20000,19750'); await cmd('20100,19750'); await cmd('');
await kb.press('Control+s');
await page.waitForFunction(() => window.__saved.length === 4);
check('Apri e poi Salva: riscrive il file aperto senza chiedere', await page.evaluate(() => window.__asked === 2 && window.__saved[3].name === 'cliente2.kalista'), JSON.stringify(await page.evaluate(() => window.__saved)));
await page.evaluate(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; window.app.doc.dirty = false; });

// ---- DWG: il modulo LibreDWG si carica nel browser e un file rovinato dà un errore chiaro
const junkDwg = join(OUT, 'rovinato.dwg');
writeFileSync(junkDwg, 'AC1032' + 'x'.repeat(4000));
async function tryDwg(p) {
  const ch = p.waitForEvent('filechooser');
  await p.keyboard.type('IMPORTA');
  await p.keyboard.press('Enter');
  await (await ch).setFiles(junkDwg);
  await p.waitForFunction(() => /rovinato\.dwg: /.test(document.getElementById('history').textContent), null, { timeout: 30000 });
  const h = await p.textContent('#history');
  return h.slice(h.lastIndexOf('rovinato.dwg: '));
}
const devDwg = await tryDwg(page);
check('DWG in sviluppo: errore esplicito, non un problema di caricamento', /codice LibreDWG \d+/.test(devDwg), devDwg);
check('nessun errore in console', errors.length === 0, errors.join(' | '));
await server.close();

// ---- versione compilata
// il server di sviluppo di prima ha lasciato NODE_ENV=development: la build sarebbe quella di sviluppo
process.env.NODE_ENV = 'production';
await build({ logLevel: 'error' });
const pv = await preview({ preview: { port: 5197, strictPort: false }, logLevel: 'error' });
const errs2 = [];
const p2 = await browser.newPage();
p2.on('pageerror', e => errs2.push(e.message));
p2.on('console', m => { if (m.type() === 'error') errs2.push(m.text()); });
await p2.goto(pv.resolvedUrls.local[0]);
await p2.waitForSelector('#prompt');
check('versione compilata: si apre', (await p2.textContent('#prompt')) === 'Comando:');
const buildDwg = await tryDwg(p2);
check('versione compilata: DWG caricato, errore esplicito', /codice LibreDWG \d+/.test(buildDwg), buildDwg);
// app installabile (PWA): manifest con le icone e i file che apre, copia per lavorare senza rete
const mf = await p2.evaluate(async () => {
  const m = await (await fetch('./manifest.webmanifest')).json();
  const icons = await Promise.all(m.icons.map(async i => (await fetch(i.src)).ok));
  return { name: m.short_name, display: m.display, icons, kalista: JSON.stringify(m.file_handlers ?? []).includes('.kalista'), linked: !!document.querySelector('link[rel="manifest"]') };
});
check('app installabile: manifest collegato, con nome, finestra propria, icone e file .kalista', mf.linked && mf.name === 'Kalista' && mf.display === 'standalone' && mf.icons.length >= 3 && mf.icons.every(Boolean) && mf.kalista, JSON.stringify(mf));
await p2.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 60000 });
await p2.waitForFunction(async () => (await caches.keys()).some(k => k.startsWith('kalista-')) && (await (await caches.open((await caches.keys()).find(k => k.startsWith('kalista-')))).keys()).length >= 10, null, { timeout: 60000, polling: 300 });
await p2.reload();
await p2.waitForSelector('#prompt');
check('app installabile: dopo la prima apertura la copia del programma è pronta', await p2.evaluate(() => !!navigator.serviceWorker.controller));
await p2.context().setOffline(true);
await p2.reload();
await p2.waitForSelector('#prompt');
check('senza rete: il programma si apre lo stesso', (await p2.textContent('#prompt')) === 'Comando:');
const offDwg = await tryDwg(p2);
check('senza rete: anche il lettore DWG si carica', /codice LibreDWG \d+/.test(offDwg), offDwg);
await p2.context().setOffline(false);
check('versione compilata: nessun errore in console', errs2.length === 0, errs2.join(' | '));
await pv.close();

console.log(`\nScreenshot in ${OUT}`);
await browser.close();
process.exit(failures ? 1 : 0);
