/**
 * Danzig: dichte Nominatim-Admin-Grenze + Ostsee/Bucht abziehen.
 *   node .cursor/_clip_danzig_water_local.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import polygonClipping from 'polygon-clipping';

const ROOT = process.cwd();
const PACK = join(ROOT, 'data/staedte/danzig.json');
const UA = 'YorroDanzigClip/1.1';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function bboxOf(poly) {
  let latMin = 90,
    latMax = -90,
    lngMin = 180,
    lngMax = -180;
  for (const [lat, lng] of poly) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lng < lngMin) lngMin = lng;
    if (lng > lngMax) lngMax = lng;
  }
  return { latMin, latMax, lngMin, lngMax };
}

function areaAbs(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lat1, lng1] = ring[i];
    const [lat2, lng2] = ring[(i + 1) % ring.length];
    a += lng1 * lat2 - lng2 * lat1;
  }
  return Math.abs(a) * 0.5;
}

function ringFromGeojson(gj) {
  if (!gj?.coordinates) return null;
  let ring = null;
  if (gj.type === 'Polygon') ring = gj.coordinates[0];
  if (gj.type === 'MultiPolygon') {
    let best = null;
    for (const p of gj.coordinates) {
      const r = p?.[0];
      if (r && (!best || r.length > best.length)) best = r;
    }
    ring = best;
  }
  if (!ring || ring.length < 6) return null;
  const out = [];
  for (const c of ring) {
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
  }
  return out.length >= 6 ? out : null;
}

function toLngLatClosed(ringLatLng) {
  const r = ringLatLng.map(([lat, lng]) => [lng, lat]);
  const a = r[0];
  const b = r[r.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
}

function fromLngLat(ring) {
  const out = [];
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([lat, lng]);
  }
  if (out.length >= 2) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-12 && Math.abs(f[1] - l[1]) < 1e-12) out.pop();
  }
  return out;
}

/** Nur offene Ostsee/Bucht — Oliwa/Brzeźno-Land (~18.56 / ≤54.42) bleibt drin. */
function gulfBayWater() {
  return [
    [
      [18.68, 54.418],
      [19.05, 54.418],
      [19.05, 54.60],
      [18.68, 54.60],
      [18.68, 54.418],
    ],
  ];
}

function neSpikeWater() {
  return [
    [
      [18.97, 54.42],
      [19.15, 54.42],
      [19.15, 54.60],
      [18.97, 54.60],
      [18.97, 54.42],
    ],
  ];
}

async function fetchDenseAdmin() {
  const url =
    'https://nominatim.openstreetmap.org/lookup?osm_ids=R1553098&format=json&polygon_geojson=1&polygon_threshold=0';
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hits = await res.json();
  const ring = ringFromGeojson(hits?.[0]?.geojson);
  if (!ring) throw new Error('no admin ring');
  return ring;
}

const pack = JSON.parse(readFileSync(PACK, 'utf8'));
const prev = pack._coverage?.polygon;
console.log('[danzig] prev', prev?.length, prev ? bboxOf(prev) : null);

await sleep(1100);
const admin = await fetchDenseAdmin();
console.log('[danzig] admin', admin.length, bboxOf(admin));

const adminGeom = [[toLngLatClosed(admin)]];
const result = polygonClipping.difference(adminGeom, [
  gulfBayWater(),
  neSpikeWater(),
]);
if (!result?.length) throw new Error('empty after clip');

let bestRing = null;
let bestArea = -1;
for (const poly of result) {
  const outer = poly?.[0];
  if (!outer || outer.length < 6) continue;
  const ring = fromLngLat(outer);
  const a = areaAbs(ring);
  if (a > bestArea) {
    bestArea = a;
    bestRing = ring;
  }
}
if (!bestRing) throw new Error('no ring');

const bb = bboxOf(bestRing);
pack._coverage = { ...(pack._coverage || {}), ...bb, polygon: bestRing };
writeFileSync(PACK, JSON.stringify(pack, null, 2) + '\n', 'utf8');
writeFileSync(
  join(ROOT, '.cursor/_danzig_coverage_clipped.geojson'),
  JSON.stringify({
    type: 'Feature',
    properties: { name: 'danzig_land', pts: bestRing.length },
    geometry: {
      type: 'Polygon',
      coordinates: [
        bestRing
          .map(([lat, lng]) => [lng, lat])
          .concat([[bestRing[0][1], bestRing[0][0]]]),
      ],
    },
  }),
  'utf8',
);
console.log('[danzig] after', bestRing.length, bb);
