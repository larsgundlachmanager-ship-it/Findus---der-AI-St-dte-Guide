/**
 * Dichte DE-Gewässer (Flüsse + Seen) aus Overpass — gekachelt (weniger 5xx).
 * Output: scripts/homeMap/deHydro.geojson
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'scripts/homeMap/deHydro.geojson');

const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** 2×3 Kacheln über DE */
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

function ingest(els, rivers, lakes, seen) {
  for (const el of els) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const id = `w${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const coords = simplify(
      el.geometry.map((g) => [g.lon, g.lat]),
      0.01,
    );
    if (coords.length < 2) continue;
    const tags = el.tags || {};
    if (tags.waterway === 'river' || tags.waterway === 'canal') {
      rivers.push({
        type: 'Feature',
        properties: {
          r: tags.waterway === 'canal' ? 6 : 4,
          n: tags.name || '',
        },
        geometry: { type: 'LineString', coordinates: coords },
      });
      continue;
    }
    if (tags.natural === 'water' || tags.landuse === 'reservoir') {
      if (coords.length < 4) continue;
      const closed =
        coords[0][0] === coords[coords.length - 1][0] &&
        coords[0][1] === coords[coords.length - 1][1]
          ? coords
          : [...coords, coords[0]];
      if (closed.length < 5) continue;
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const p of closed) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      if (Math.hypot(maxX - minX, maxY - minY) < 0.01) continue;
      lakes.push({
        type: 'Feature',
        properties: { n: tags.name || '' },
        geometry: { type: 'Polygon', coordinates: [closed] },
      });
    }
  }
}

async function fetchTile(bbox) {
  const [s, w, n, e] = bbox;
  const q = `
[out:json][timeout:90];
(
  way["waterway"="river"]["name"](${s},${w},${n},${e});
  way["waterway"="canal"]["name"](${s},${w},${n},${e});
  way["natural"="water"]["name"](${s},${w},${n},${e});
  way["landuse"="reservoir"]["name"](${s},${w},${n},${e});
);
out geom;
`;
  return overpass(q);
}

async function main() {
  const rivers = [];
  const lakes = [];
  const seen = new Set();
  for (let i = 0; i < TILES.length; i++) {
    const bbox = TILES[i];
    process.stdout.write(`[de-hydro] tile ${i + 1}/${TILES.length} … `);
    try {
      const data = await fetchTile(bbox);
      const before = rivers.length + lakes.length;
      ingest(data.elements || [], rivers, lakes, seen);
      console.log(`+${rivers.length + lakes.length - before}`);
    } catch (err) {
      console.log('ERR', err?.message || err);
    }
    await sleep(1500);
  }
  rivers.sort(
    (a, b) => b.geometry.coordinates.length - a.geometry.coordinates.length,
  );
  lakes.sort(
    (a, b) =>
      b.geometry.coordinates[0].length - a.geometry.coordinates[0].length,
  );
  const out = {
    v: 1,
    rivers: { type: 'FeatureCollection', features: rivers.slice(0, 2_500) },
    lakes: { type: 'FeatureCollection', features: lakes.slice(0, 1_200) },
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(
    '[de-hydro] wrote',
    OUT,
    'rivers',
    out.rivers.features.length,
    'lakes',
    out.lakes.features.length,
  );
  if (out.rivers.features.length < 50 && out.lakes.features.length < 20) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
