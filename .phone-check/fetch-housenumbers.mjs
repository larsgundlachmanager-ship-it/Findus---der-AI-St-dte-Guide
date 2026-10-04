/**
 * Fetch Prisdorf-core housenumbers and merge into prisdorf.map.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('c:/Users/larsf/Findus 2.0');
const MAP = path.join(ROOT, 'data/staedte/prisdorf.map.json');
const lat = 53.67667;
const lng = 9.76285;
const r = 4500;
const dLat = r / 111320;
const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
const south = lat - dLat;
const north = lat + dLat;
const west = lng - dLng;
const east = lng + dLng;

const q = `[out:json][timeout:90];
(
  node["addr:housenumber"](${south},${west},${north},${east});
  way["addr:housenumber"](${south},${west},${north},${east});
);
out center;`;

const mirrors = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

let data = null;
for (const url of mirrors) {
  try {
    console.log('try', url);
    const res = await fetch(url, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) {
      console.log('status', res.status);
      continue;
    }
    data = await res.json();
    break;
  } catch (e) {
    console.log('fail', e.cause?.code || e.message);
  }
}
if (!data) {
  console.error('no overpass data');
  process.exit(1);
}

const out = [];
const seen = new Set();
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

const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
map.housenumbers = out.slice(0, 8000);
fs.writeFileSync(MAP, JSON.stringify(map));
console.log(JSON.stringify({ housenumbers: map.housenumbers.length, bytes: fs.statSync(MAP).size }));
