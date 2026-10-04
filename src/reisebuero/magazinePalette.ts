/**
 * Magazin-Palette aus Hero-Foto.
 * Soft: optional jpeg-js; sonst Fallback. UI nutzt zusätzlich Blur-Ambient.
 */

export type MagazinePalette = {
  paper: string;
  card: string;
  ink: string;
  muted: string;
  scrub: string;
  accent: string;
  header: string;
  /** Frost über Ambient-Blur (rgba). */
  frost: string;
};

export const MAGAZINE_PALETTE_FALLBACK: MagazinePalette = {
  paper: '#F3EBE0',
  card: '#FFFBF5',
  ink: '#1A2E28',
  muted: '#5D6E68',
  scrub: 'rgba(10, 28, 24, 0.42)',
  accent: '#C4A35A',
  header: '#0F241F',
  frost: 'rgba(243, 235, 224, 0.82)',
};

type Rgb = { r: number; g: number; b: number };

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((c) => clampByte(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = clampByte(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clampByte(hue2rgb(p, q, h + 1 / 3) * 255),
    g: clampByte(hue2rgb(p, q, h) * 255),
    b: clampByte(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

/** Papier / Cards / Text aus dominantem Bildton. */
export function paletteFromAverageRgb(avg: Rgb): MagazinePalette {
  const { h, s } = rgbToHsl(avg.r, avg.g, avg.b);
  const sat = Math.min(0.28, Math.max(0.06, s * 0.55));
  const paper = hslToRgb(h, sat, 0.93);
  const card = hslToRgb(h, sat * 0.7, 0.97);
  const ink = hslToRgb(h, Math.min(0.35, sat + 0.12), 0.16);
  const muted = hslToRgb(h, Math.min(0.22, sat + 0.05), 0.42);
  const header = hslToRgb(h, Math.min(0.4, sat + 0.18), 0.12);
  const accent =
    s > 0.18
      ? hslToRgb(h, Math.min(0.55, s * 0.85), 0.48)
      : { r: 196, g: 163, b: 90 };
  return {
    paper: hex(paper),
    card: hex(card),
    ink: hex(ink),
    muted: hex(muted),
    scrub: `rgba(${header.r},${header.g},${header.b},0.45)`,
    accent: hex(accent),
    header: hex(header),
    frost: `rgba(${paper.r},${paper.g},${paper.b},0.78)`,
  };
}

function averageRgbFromPixels(
  data: Uint8Array,
  width: number,
  height: number,
): Rgb | null {
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const pr = data[i] ?? 0;
      const pg = data[i + 1] ?? 0;
      const pb = data[i + 2] ?? 0;
      const lum = (pr * 299 + pg * 587 + pb * 114) / 1000;
      if (lum > 245 || lum < 18) continue;
      r += pr;
      g += pg;
      b += pb;
      n += 1;
    }
  }
  if (n < 8) return null;
  return { r: r / n, g: g / n, b: b / n };
}

const cache = new Map<string, MagazinePalette>();

/**
 * Extrahiert Palette aus Remote-JPEG (wenn jpeg-js installiert).
 * Sonst null → UI nutzt Blur-Ambient + Fallback-Frost.
 */
export async function extractMagazinePalette(
  uri: string | null | undefined,
): Promise<MagazinePalette | null> {
  const url = (uri || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const hit = cache.get(url);
  if (hit) return hit;
  try {
    let jpeg: {
      decode: (
        b: Uint8Array,
        o?: { useTArray?: boolean; maxResolutionInMP?: number },
      ) => { data: Uint8Array; width: number; height: number };
    };
    try {
      jpeg = require('jpeg-js') as typeof jpeg;
    } catch {
      return null;
    }
    const res = await fetch(url, {
      headers: { Accept: 'image/jpeg,image/*;q=0.8' },
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
    const raw = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 0.35 });
    if (!raw?.data?.length || !raw.width || !raw.height) return null;
    const avg = averageRgbFromPixels(raw.data, raw.width, raw.height);
    if (!avg) return null;
    const palette = paletteFromAverageRgb(avg);
    cache.set(url, palette);
    return palette;
  } catch {
    return null;
  }
}
