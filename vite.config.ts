import { defineConfig, type Plugin } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// La versione mostrata nel programma è quella di package.json: per pubblicarne una nuova si cambia lì.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Service worker dell'app installabile: scritto a ogni build dal modello in src/pwa, con l'elenco
 * di tutti i file da tenere per il funzionamento senza rete. Il numero della build cambia quando
 * cambia un file, e così il browser sa che c'è una versione nuova.
 */
function serviceWorker(): Plugin {
  return {
    name: 'kalista-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const pub = readdirSync(fileURLToPath(new URL('./public', import.meta.url)));
      const files = ['./', './index.html', ...[...Object.keys(bundle), ...pub].filter(f => f !== 'index.html').map(f => `./${f}`)].sort();
      const id = createHash('sha256').update(version + Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 12);
      const src = readFileSync(new URL('./src/pwa/sw.template.js', import.meta.url), 'utf8')
        .replace('__BUILD_ID__', `${version}-${id}`)
        .replace('__FILES__', JSON.stringify(files, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __PORTABLE__: 'false', __APP_VERSION__: JSON.stringify(version), __BUILD_DATE__: JSON.stringify(today) },
  resolve: {
    alias: { 'libredwg-wasm-module': fileURLToPath(new URL('./node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.js', import.meta.url)) },
  },
  optimizeDeps: { exclude: ['@mlightcad/libredwg-web'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  plugins: [serviceWorker()],
});
