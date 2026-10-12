/** Vero solo nella versione da chiavetta (scripts/chiavetta.mjs). */
declare const __PORTABLE__: boolean;
/** Versione del programma, da package.json. */
declare const __APP_VERSION__: string;
/** Giorno in cui questa copia è stata preparata. */
declare const __BUILD_DATE__: string;

/** Modulo Emscripten di LibreDWG, raggiunto con un alias di Vite perché il pacchetto non lo esporta. */
declare module 'libredwg-wasm-module' {
  const createModule: (opts?: { wasmBinary?: Uint8Array; locateFile?: (name: string) => string }) => Promise<import('@mlightcad/libredwg-web').MainModule>;
  export default createModule;
}
