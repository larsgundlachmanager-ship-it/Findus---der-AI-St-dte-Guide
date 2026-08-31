/**
 * Enrich existing *.map.json roads with street names from housenumbers.
 * Until offline-map rebuild succeeds (Overpass), labels can sit on the line.
 *
 * Usage: node scripts/homeMap/enrichRoadNamesFromHn.mjs --city prisdorf
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const city =
  process.argv.find((a) => a.startsWith('--city='))?.split('=')[1] ||
  (process.argv.includes('--city')
    ? process.argv[process.argv.indexOf('--city') + 1]
    : 'prisdorf');

const path = join(ROOT, 'data/staedte', `${city}.map.json`);
if (!existsSync(path)) {
  console.error('missing', path);
  process.exit(1);
}

const extract = JSON.parse(readFileSync(path, 'utf8'));
const hn = extract.housenumbers || [];
const roads = extract.roads || [];

const buckets = new Map();
for (const h of hn) {
  const name = String(h.s || '').trim();
  if (name.length < 2) continue;
  const key = name.toLowerCase();
  if (!buckets.has(key)) buckets.set(key, { name, pts: [] });
  buckets.get(key).pts.push({ lat: h.lat, lng: h.lng });
}

function dist2(a, b) {
  const dLat = (a.lat - b.lat) * 111_320;
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * 111_320 * Math.max(0.2, cos);
  return dLat * dLat + dLng * dLng;
}

function roadNearName(road, pts, maxM = 55) {
  const max2 = maxM * maxM;
  const coords = road.c || [];
  if (coords.length < 2 || pts.length < 2) return false;
  let hits = 0;
  for (const p of pts) {
    let best = Infinity;
    for (const c of coords) {
      // c = [lat, lng] in extract compact form
      const lat = Array.isArray(c) ? Number(c[0]) : NaN;
      const lng = Array.isArray(c) ? Number(c[1]) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const d = dist2(p, { lat, lng });
      if (d < best) best = d;
    }
    if (best <= max2) hits += 1;
  }
  return hits >= Math.min(2, pts.length);
}

let named = 0;
for (const road of roads) {
  if (road.n && String(road.n).trim()) continue;
  if (road.k === 2) continue;
  for (const [, b] of buckets) {
    if (roadNearName(road, b.pts)) {
      road.n = b.name;
      named += 1;
      break;
    }
  }
}

writeFileSync(path, JSON.stringify(extract));
console.log(
  `[enrich-road-names] ${city}: named ${named}/${roads.length} roads, hn streets ${buckets.size}`,
);
