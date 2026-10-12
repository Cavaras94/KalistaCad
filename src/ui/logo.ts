// Logo di Kalista: una fiammella blu attraversata da una lancia.
const OUTER = 'M17.5 1.5c.9 5.2-2.3 7.6-4.9 10.9C10.3 15.3 8 18 8 21.5a8.3 8.3 0 0 0 16.6 0c0-3.3-1.5-5.6-2.8-7.3-.4 2.1-1.3 3.3-2.9 3.9 1.3-5.3.2-12-1.4-16.6z';
const INNER = 'M16.2 29.5a4.6 4.6 0 0 0 4.6-4.6c0-2.7-2.1-3.8-3.2-6.4-2 1.7-6 3.6-6 6.4a4.6 4.6 0 0 0 4.6 4.6z';
// la lancia è disegnata in verticale, con la punta in alto, e poi inclinata attorno al centro
const SHAFT = 'M15.45 11.5h1.1v19l-.55 1.5-.55-1.5z';
const HEAD = 'M16-1.5l1.9 9-1 3.2h2.3l-.9 1.3h-4.6l-.9-1.3h2.3l-1-3.2z';
const TILT = 'rotate(42 16 16)';

/** Versione di questa copia del programma, per capire se un problema viene da una copia non aggiornata. */
export const VERSION = __APP_VERSION__;
export const VERSION_LONG = `Kalista ${__APP_VERSION__} del ${__BUILD_DATE__}`;

export function logo(size = 22): string {
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">` +
    '<defs><linearGradient id="kalista-fiamma" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1557e6"/><stop offset="1" stop-color="#46b8ff"/></linearGradient></defs>' +
    `<g transform="${TILT}"><path d="${SHAFT}" fill="#7fd0f5"/><path d="${HEAD}" fill="#d6f4ff"/></g>` +
    `<path d="${OUTER}" fill="url(#kalista-fiamma)"/><path d="${INNER}" fill="#c9ecff"/></svg>`;
}
