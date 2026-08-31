/**
 * Offline MapLibre-Glyphen (Latin + Umlaute) — kein HTTP zur Laufzeit.
 * Run: node scripts/homeMap/fetchMapGlyphs.mjs
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FONT = 'Noto Sans Regular';
const RANGES = ['0-255', '256-511'];
const SRC = join(ROOT, 'src/assets/homeMap/glyphs', FONT);
const ANDROID = join(
  ROOT,
  'android/app/src/main/assets/fonts',
  FONT,
);

const BASES = [
  'https://protomaps.github.io/basemaps-assets/fonts/',
  'https://demotiles.maplibre.org/font/',
];

async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  mkdirSync(SRC, { recursive: true });
  for (const range of RANGES) {
    let last = null;
    for (const base of BASES) {
      const url = `${base}${encodeURIComponent(FONT)}/${range}.pbf`;
      try {
        const buf = await fetchBuf(url);
        if (buf.length < 200) throw new Error('too small');
        writeFileSync(join(SRC, `${range}.pbf`), buf);
        console.log('[glyphs]', range, buf.length, 'bytes');
        last = null;
        break;
      } catch (err) {
        last = err;
      }
    }
    if (last) throw last;
  }
  mkdirSync(ANDROID, { recursive: true });
  for (const range of RANGES) {
    const from = join(SRC, `${range}.pbf`);
    if (existsSync(from)) copyFileSync(from, join(ANDROID, `${range}.pbf`));
  }
  console.log('[glyphs] android assets', ANDROID);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
