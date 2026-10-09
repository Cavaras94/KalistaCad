import ACI from 'dxf-parser/dist/AutoCadColorIndex.js';

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function rgbIntToHex(n: number): string {
  return `#${hex2((n >> 16) & 255)}${hex2((n >> 8) & 255)}${hex2(n & 255)}`;
}

export function aciToHex(i: number): string {
  if (i === 7) return '#ffffff';
  const n = ACI[i];
  return n === undefined ? '#ffffff' : rgbIntToHex(n);
}

function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colore AutoCAD più vicino. Bianco e nero diventano 7 (bianco su sfondo scuro, nero su carta). */
export function hexToAci(h: string): number {
  const [r, g, b] = hexToRgb(h);
  if ((r > 240 && g > 240 && b > 240) || (r < 15 && g < 15 && b < 15)) return 7;
  let best = 7, bd = Infinity;
  for (let i = 1; i <= 255; i++) {
    const n = ACI[i];
    const d = (((n >> 16) & 255) - r) ** 2 + (((n >> 8) & 255) - g) ** 2 + ((n & 255) - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
