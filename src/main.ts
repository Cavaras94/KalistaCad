import './style.css';
import { App } from './ui/app';

const app = new App();
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;

// App installata (PWA): un doppio clic su un file .kalista, .dxf o .dwg apre Kalista con quel file.
type Launch = { files?: unknown[] };
const lq = (window as unknown as { launchQueue?: { setConsumer(f: (p: Launch) => void): void } }).launchQueue;
lq?.setConsumer(p => { if (p.files?.length) void app.openLaunched(p.files[0]); });

// Copia del programma per lavorare anche senza rete, e aggiornamenti: solo nella versione
// pubblicata (non durante lo sviluppo, né nella chiavetta, che si apre da disco).
if (import.meta.env.PROD && !__PORTABLE__ && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          // c'era già una versione in uso: la nuova si usa alla prossima apertura del programma
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            app.msg('È stata scaricata una versione nuova di Kalista: si userà alla prossima apertura (chiudere e riaprire il programma).');
          }
        });
      });
    }).catch(err => console.warn('Copia per il lavoro senza rete non disponibile:', err));
  });
}
