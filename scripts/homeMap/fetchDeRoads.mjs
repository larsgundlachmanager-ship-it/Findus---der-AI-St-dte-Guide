/**
 * DE Hauptstraßen (trunk/primary/secondary) aus Overpass — gekachelt.
 * Merged in buildWorldLabels. Output: scripts/homeMap/deRoads.geojson
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'scripts/homeMap/deRoads.geojson');

const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const TILES = [
  [47.2, 5.5, 51.2, 10.5],
  [47.2, 10.5, 51.2, 15.4],
  [51.2, 5.5, 55.2, 10.5],
  [51.2, 10.5, 55.2, 15.4],
];

function round(n, p = 4) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

function simplify(pts, minDeg) {
  const min2 = minDeg * minDeg;
  const out = [];
  let last = null;
  for (const raw of pts) {
    const p = [round(Number(raw[0])), round(Number(raw[1]))];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (last) {
      const dx = last[0] - p[0];
      const dy = last[1] - p[1];
      if (dx * dx + dy * dy < min2) continue;
    }
    out.push(p);
    last = p;
  }
  return out;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function overpass(query) {
  let last = null;
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new Error('overpass failed');
}

function rankFor(highway) {
  if (highway === 'motorway' || highway === 'trunk') return 3;
  if (highway === 'primary') return 5;
  if (highway === 'secondary') return 7;
  return 8;
}

async function main() {
  const roads = [];
  const seen = new Set();
  for (let i = 0; i < TILES.length; i++) {
    const [s, w, n, e] = TILES[i];
    process.stdout.write(`[de-roads] tile ${i + 1}/${TILES.length} … `);
    const q = `
[out:json][timeout:90];
(
  way["highway"="motorway"](${s},${w},${n},${e});
  way["highway"="trunk"](${s},${w},${n},${e});
  way["highway"="primary"](${s},${w},${n},${e});
  way["highway"="secondary"](${s},${w},${n},${e});
);
out geom;
`;
    try {
      const data = await overpass(q);
      let added = 0;
      for (const el of data.elements || []) {
        if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
        const id = `w${el.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const coords = simplify(
          el.geometry.map((g) => [g.lon, g.lat]),
          0.012,
        );
        if (coords.length < 2) continue;
        const hw = String(el.tags?.highway || 'secondary');
        roads.push({
          type: 'Feature',
          properties: { r: rankFor(hw), n: el.tags?.ref || el.tags?.name || '' },
          geometry: { type: 'LineString', coordinates: coords },
        });
        added += 1;
      }
      console.log(`+${added}`);
    } catch (err) {
      console.log('ERR', err?.message || err);
    }
    await sleep(1500);
  }
  roads.sort(
    (a, b) =>
      a.properties.r - b.properties.r ||
      b.geometry.coordinates.length - a.geometry.coordinates.length,
  );
  const out = {
    v: 1,
    roads: { type: 'FeatureCollection', features: roads.slice(0, 8_000) },
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log('[de-roads] wrote', OUT, 'roads', out.roads.features.length);
  if (out.roads.features.length < 200) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
