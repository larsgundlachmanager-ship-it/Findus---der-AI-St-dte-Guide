#!/usr/bin/env node
/**
 * Prüft Map-Tile-Env für Vector-Basemap.
 * Run: npm run map:tiles:check
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = existsSync(envPath)
  ? parseEnv(readFileSync(envPath, 'utf8'))
  : {};

const vectorOff = ['0', 'false', 'no'].includes(
  (env.EXPO_PUBLIC_MAP_VECTOR_TILES || '').trim().toLowerCase(),
);

if (vectorOff) {
  console.log('map:tiles:check — Legacy Extract (EXPO_PUBLIC_MAP_VECTOR_TILES=0)');
  process.exit(0);
}

const xyz = (env.EXPO_PUBLIC_MAP_TILES_URL || '').trim();
const pmtiles = (env.EXPO_PUBLIC_MAP_PMTILES_URL || '').trim();
const key = (env.EXPO_PUBLIC_PROTOMAPS_API_KEY || '').trim();

const ok =
  (xyz.includes('{z}') && xyz.includes('{x}') && xyz.includes('{y}')) ||
  !!pmtiles ||
  !!key;

if (ok) {
  const src = xyz
    ? 'R2/Worker XYZ'
    : pmtiles
      ? 'PMTiles'
      : 'Protomaps API';
  console.log(`map:tiles:check OK — ${src}`);
  process.exit(0);
}

console.error(
  'map:tiles:check FAIL — Vector-Basemap aktiv, aber keine Tile-Quelle in .env',
);
console.error('Setze eine von:');
console.error('  EXPO_PUBLIC_MAP_TILES_URL=https://tiles.yorro.de/{z}/{x}/{y}.mvt');
console.error('  EXPO_PUBLIC_MAP_PMTILES_URL=https://…/world.pmtiles');
console.error('  EXPO_PUBLIC_PROTOMAPS_API_KEY=…');
if (existsSync(examplePath)) {
  console.error(`Siehe ${examplePath}`);
}
process.exit(1);
