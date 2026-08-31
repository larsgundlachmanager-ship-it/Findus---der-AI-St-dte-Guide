/**
 * Fetch real island coast rings via Nominatim (Overpass oft 5xx).
 * Writes scripts/homeMap/deMustIslands.rings.json for buildWorldOverview.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'scripts/homeMap/deMustIslands.rings.json');

const ISLANDS = [
  { n: 'Juist', q: 'Juist, Germany' },
  { n: 'Norderney', q: 'Norderney, Germany' },
  { n: 'Langeoog', q: 'Langeoog, Germany' },
  { n: 'Spiekeroog', q: 'Spiekeroog, Germany' },
  { n: 'Wangerooge', q: 'Wangerooge, Germany' },
  { n: 'Helgoland', q: 'Helgoland, Germany' },
];

function round(n, p = 5) {
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
  if (out.length >= 3) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  }
  return out.length >= 8 ? out : null;
}

function chaikinOnce(ring) {
  if (!ring || ring.length < 4) return ring;
  const open =
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring.slice();
  const out = [];
  for (let i = 0; i < open.length; i++) {
    const a = open[i];
    const b = open[(i + 1) % open.length];
    out.push([
      round(0.75 * a[0] + 0.25 * b[0]),
      round(0.75 * a[1] + 0.25 * b[1]),
    ]);
    out.push([
      round(0.25 * a[0] + 0.75 * b[0]),
      round(0.25 * a[1] + 0.75 * b[1]),
    ]);
  }
  out.push([out[0][0], out[0][1]]);
  return out;
}

function outerRing(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') return geom.coordinates?.[0] ?? null;
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates ?? [];
    let best = null;
    let bestN = 0;
    for (const poly of polys) {
      const ring = poly?.[0];
      if (ring && ring.length > bestN) {
        best = ring;
        bestN = ring.length;
      }
    }
    return best;
  }
  return null;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchIsland(name, query) {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q: query,
      format: 'geojson',
      polygon_geojson: '1',
      limit: '1',
    }).toString();
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'YorroHomeMapIslandBuild/1.0 (findus city pack)',
    },
  });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const data = await res.json();
  const f = data.features?.[0];
  const raw = outerRing(f?.geometry);
  if (!raw || raw.length < 8) return null;
  const simp = simplify(raw, 0.001);
  if (!simp) return null;
  const soft = chaikinOnce(simp);
  let ring = simplify(soft, 0.0012);
  if (!ring) return null;
  if (ring.length > 50) {
    const step = Math.ceil(ring.length / 48);
    const capped = [];
    for (let i = 0; i < ring.length - 1; i += step) capped.push(ring[i]);
    capped.push(capped[0]);
    ring = capped;
  }
  return ring;
}

async function main() {
  const out = [];
  for (const isl of ISLANDS) {
    process.stdout.write(`[islands] ${isl.n} … `);
    try {
      const ring = await fetchIsland(isl.n, isl.q);
      if (!ring) {
        console.log('MISS');
      } else {
        console.log(`ok pts=${ring.length}`);
        out.push({ n: isl.n, ring });
      }
    } catch (err) {
      console.log('ERR', err?.message || err);
    }
    await sleep(1100);
  }
  writeFileSync(OUT, JSON.stringify({ v: 1, islands: out }));
  console.log(`[islands] wrote ${OUT} (${out.length}/${ISLANDS.length})`);
  if (out.length < 4) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
