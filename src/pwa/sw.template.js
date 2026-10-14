// Service worker di Kalista installata come app (PWA): tiene una copia di tutto il programma, così
// funziona anche senza Internet. Il file vero (sw.js) lo scrive la build da questo modello, con
// l'elenco dei file e la versione al posto dei segnaposto (vite.config.ts).
//
// Una versione nuova si scarica da sola alla prima apertura con la rete, ma entra in uso alla
// riapertura successiva: cambiarla mentre si disegna lascerebbe il programma a metà fra le due.
const CACHE = 'kalista-__BUILD_ID__';
const FILES = __FILES__;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('kalista-') && k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // la pagina: sempre quella della copia in uso (anche con ?file=… o senza rete)
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html', { cacheName: CACHE, ignoreVary: true }).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true }).then(r => r || fetch(req)));
});
