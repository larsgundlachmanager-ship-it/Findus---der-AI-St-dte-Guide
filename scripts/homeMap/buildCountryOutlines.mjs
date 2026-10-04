/**
 * Legacy: Natural-Earth-Outlines (nicht mehr in der App).
 * Ländergrenzen kommen aus Protomaps `boundaries_country` (weiß).
 * Run: node scripts/homeMap/buildCountryOutlines.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'src/assets/homeMap/countryOutlines.json');
const BASES = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/',
];

async function fetchJson(name) {
  let lastErr;
  for (const base of BASES) {
    try {
      const res = await fetch(base + name);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function simplifyLine(ring, minDeg, places) {
  if (!ring || ring.length < 2) return [];
  const min2 = minDeg * minDeg;
  const out = [];
  for (const p of ring) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q = [
      Number(p[0].toFixed(places)),
      Number(p[1].toFixed(places)),
    ];
    const prev = out[out.length - 1];
    if (!prev || dist2(prev, q) >= min2) out.push(q);
  }
  if (out.length === 1) out.push(out[0]);
  return out;
}

function a3Of(p) {
  return String(
    p.ADM0_A3 || p.adm0_a3 || p.ISO_A3 || p.iso_a3 || p.BRK_A3 || p.brk_a3 || '',
  )
    .trim()
    .toUpperCase();
}

function nameOf(p) {
  return String(
    p.NAME_DE || p.name_de || p.NAME || p.name || p.ADMIN || p.admin || '',
  ).trim();
}

function pushRings(geom, sink) {
  if (!geom) return;
  if (geom.type === 'Polygon') {
    const outer = geom.coordinates?.[0];
    if (outer) sink.push(outer);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates ?? []) {
      const outer = poly?.[0];
      if (outer) sink.push(outer);
    }
  }
}

function mainRingSpan(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

console.log('[country-outlines] fetch ne_50m_admin_0_countries…');
const raw = await fetchJson('ne_50m_admin_0_countries.geojson');
const features = [];
for (const f of raw?.features ?? []) {
  const a3 = a3Of(f.properties || {});
  if (!a3 || a3 === '-99') continue;
  const n = nameOf(f.properties || {});
  const rings = [];
  pushRings(f.geometry, rings);
  for (const ring of rings) {
    const span = mainRingSpan(ring);
    if (span < 0.08) continue;
    const minDeg = span < 2 ? 0.012 : span < 8 ? 0.022 : 0.04;
    const simp = simplifyLine(ring, minDeg, 3);
    if (simp.length < 4) continue;
    features.push({
      type: 'Feature',
      properties: { a3, n },
      geometry: { type: 'LineString', coordinates: simp },
    });
  }
}

const bundle = {
  v: 1,
  borders: { type: 'FeatureCollection', features },
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle));
console.log(
  '[country-outlines] →',
  OUT,
  'features=',
  features.length,
  'kb=',
  Math.round(Buffer.byteLength(JSON.stringify(bundle)) / 1024),
);
