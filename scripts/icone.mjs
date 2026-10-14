// Disegna le icone dell'app installabile (PWA) a partire dal logo: public/icon.svg e i PNG.
// Uso: node scripts/icone.mjs   (serve Chrome o Edge installato; le icone sono già nel progetto,
// va rifatto solo se cambia il logo in src/ui/logo.ts)
import { chromium } from 'playwright-core';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
mkdirSync(pub, { recursive: true });

// stessi tracciati di src/ui/logo.ts
const OUTER = 'M17.5 1.5c.9 5.2-2.3 7.6-4.9 10.9C10.3 15.3 8 18 8 21.5a8.3 8.3 0 0 0 16.6 0c0-3.3-1.5-5.6-2.8-7.3-.4 2.1-1.3 3.3-2.9 3.9 1.3-5.3.2-12-1.4-16.6z';
const INNER = 'M16.2 29.5a4.6 4.6 0 0 0 4.6-4.6c0-2.7-2.1-3.8-3.2-6.4-2 1.7-6 3.6-6 6.4a4.6 4.6 0 0 0 4.6 4.6z';
const SHAFT = 'M15.45 11.5h1.1v19l-.55 1.5-.55-1.5z';
const HEAD = 'M16-1.5l1.9 9-1 3.2h2.3l-.9 1.3h-4.6l-.9-1.3h2.3l-1-3.2z';

/** maskable: fondo a tutto campo e logo più piccolo, perché il sistema può ritagliare l'icona in tondo */
const svg = maskable => {
  const k = maskable ? 8.5 : 10.5, off = (512 - 32 * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    '<defs><linearGradient id="f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1557e6"/><stop offset="1" stop-color="#46b8ff"/></linearGradient></defs>' +
    `<rect width="512" height="512" rx="${maskable ? 0 : 104}" fill="#1b1f26"/>` +
    `<g transform="translate(${off} ${off}) scale(${k})">` +
    `<g transform="rotate(42 16 16)"><path d="${SHAFT}" fill="#7fd0f5"/><path d="${HEAD}" fill="#d6f4ff"/></g>` +
    `<path d="${OUTER}" fill="url(#f)"/><path d="${INNER}" fill="#c9ecff"/></g></svg>`;
};

writeFileSync(join(pub, 'icon.svg'), svg(false));

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => existsSync(p));
if (!exe) { console.error('Nessun Chrome/Edge trovato'); process.exit(2); }
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(maskable)}`);
  await page.screenshot({ path: join(pub, name), omitBackground: true });
  console.log(`${name} (${size}×${size})`);
}
await browser.close();
