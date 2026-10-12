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
await page.evaluate(() => { localStorage.clear(); });
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
  check('porta a 100 dallo spigolo destro', Math.abs(door.p.x - (500 - 100 - 40)) < 1e-6 && Math.abs(door.p.y) < 1e-6, JSON.stringify(door.p));
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
await kb.type('Cucina abitabile');
await kb.press('Enter');
await cmd('');
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
await page.selectOption('.modal select >> nth=0', 'm');
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

// ---- comando sconosciuto
await cmd('PIPPO');
check('comando sconosciuto segnalato', (await page.textContent('#history')).includes('Comando sconosciuto'));

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
check('versione compilata: nessun errore in console', errs2.length === 0, errs2.join(' | '));
await pv.close();

console.log(`\nScreenshot in ${OUT}`);
await browser.close();
process.exit(failures ? 1 : 0);
