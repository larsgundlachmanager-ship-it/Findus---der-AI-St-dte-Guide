/**
 * Tile housenumber fetch for Prisdorf core → prisdorf.map.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchOverpass, sleep } from '../scripts/geo/osm.mjs';

const ROOT = path.resolve('c:/Users/larsf/Findus 2.0');
const MAP = path.join(ROOT, 'data/staedte/prisdorf.map.json');
const lat0 = 53.67667;
const lng0 = 9.76285;
const R = 3500;
const TILE = 1800;

function bboxAround(lat, lng, rM) {
  const dLat = rM / 111320;
  const dLng = rM / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lng - dLng,
    east: lng + dLng,
  };
}

const outer = bboxAround(lat0, lng0, R);
const tiles = [];
for (let lat = outer.south; lat < outer.north; lat += TILE / 111320) {
  for (
    let lng = outer.west;
    lng < outer.east;
    lng += TILE / (111320 * Math.cos((lat0 * Math.PI) / 180))
  ) {
    tiles.push(bboxAround(lat + TILE / 222640, lng + TILE / 222640, TILE / 2));
  }
}
console.log('tiles', tiles.length);

const out = [];
const seen = new Set();
for (let i = 0; i < tiles.length; i++) {
  const b = tiles[i];
  const q = `
[out:json][timeout:45];
(
  node["addr:housenumber"](${b.south},${b.west},${b.north},${b.east});
  way["addr:housenumber"](${b.south},${b.west},${b.north},${b.east});
);
out center;
`;
  try {
    console.log(`tile ${i + 1}/${tiles.length}`);
    const data = await fetchOverpass(q, { timeoutMs: 60_000 });
    for (const e of data.elements || []) {
      const a = typeof e.lat === 'number' ? e.lat : e.center?.lat;
      const o = typeof e.lon === 'number' ? e.lon : e.center?.lon;
      const n = e.tags?.['addr:housenumber'];
      if (typeof a !== 'number' || typeof o !== 'number' || !n) continue;
      const key = `${a.toFixed(5)},${o.toFixed(5)},${n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = String(e.tags['addr:street'] || '').trim().slice(0, 80);
      out.push({
        lat: +a.toFixed(6),
        lng: +o.toFixed(6),
        n: String(n).slice(0, 8),
        ...(s ? { s } : {}),
      });
    }
    console.log('  total', out.length);
  } catch (e) {
    console.warn('  fail', e.message || e);
  }
  await sleep(500);
}

const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
map.housenumbers = out.slice(0, 8000);
fs.writeFileSync(MAP, JSON.stringify(map));
console.log(JSON.stringify({ housenumbers: map.housenumbers.length }));
