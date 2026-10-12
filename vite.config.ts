import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La versione mostrata nel programma è quella di package.json: per pubblicarne una nuova si cambia lì.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

export default defineConfig({
  base: './',
  define: { __PORTABLE__: 'false', __APP_VERSION__: JSON.stringify(version), __BUILD_DATE__: JSON.stringify(today) },
  resolve: {
    alias: { 'libredwg-wasm-module': fileURLToPath(new URL('./node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.js', import.meta.url)) },
  },
  optimizeDeps: { exclude: ['@mlightcad/libredwg-web'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
