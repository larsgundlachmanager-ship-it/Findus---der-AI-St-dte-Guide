/**
 * Densify prisdorf.map.json: keep umland sample, replace core with full OSM.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('c:/Users/larsf/Findus 2.0');
const MAP = path.join(ROOT, 'data/staedte/prisdorf.map.json');
const RAW = path.join(ROOT, '.phone-check/prisdorf-buildings-raw.json');
const CORE_M = 2800;
const TOTAL_CAP = 14000;

const packLat = 53.67667;
const packLng = 9.76285;

function distM(a, b) {
  const dLat = (a.lat - b.lat) * 111320;
  const dLng =
    (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function ringFromGeom(el) {
  const g = el.geometry;
  if (!Array.isArray(g) || g.length < 3) return null;
  const pts = [];
  for (const p of g) {
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    pts.push({ lat: p.lat, lng: p.lon });
  }
  if (pts.length < 3) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a.lat !== b.lat || a.lng !== b.lng) pts.push({ ...a });
  if (pts.length < 4) return null;
  return pts;
}

function simplifyRing(pts, minM) {
  if (pts.length <= 4) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = pts[i];
    if (distM(prev, cur) >= minM) out.push(cur);
  }
  out.push(pts[pts.length - 1]);
  if (out.length < 4) return pts;
  const a = out[0];
  const b = out[out.length - 1];
  if (a.lat !== b.lat || a.lng !== b.lng) out.push({ ...a });
  return out;
}

function compact(pts) {
  return simplifyRing(pts, 0.7).map((p) => [
    +p.lat.toFixed(6),
    +p.lng.toFixed(6),
  ]);
}

function centerOf(ring) {
  let a = 0;
  let o = 0;
  const n = ring.length;
  for (const p of ring) {
    a += p[0];
    o += p[1];
  }
  return { lat: a / n, lng: o / n };
}

const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const center = { lat: packLat, lng: packLng };

const coreRings = [];
const seen = new Set();
for (const el of raw.elements || []) {
  if (el.type !== 'way' || !el.tags?.building) continue;
  if (seen.has(el.id)) continue;
  const pts = ringFromGeom(el);
  if (!pts) continue;
  const ring = compact(pts);
  if (ring.length < 4) continue;
  const c = centerOf(ring);
  if (distM(c, center) > CORE_M) continue;
  seen.add(el.id);
  coreRings.push(ring);
}

const umland = [];
for (const ring of map.buildings || []) {
  const c = centerOf(ring);
  if (distM(c, center) > CORE_M) umland.push(ring);
}

const remain = Math.max(0, TOTAL_CAP - coreRings.length);
const buildings = coreRings.concat(umland.slice(0, remain));
map.buildings = buildings;
map.v = (map.v || 1) + 0; // keep
fs.writeFileSync(MAP, JSON.stringify(map));

let n800 = 0;
let n1200 = 0;
for (const ring of buildings) {
  const c = centerOf(ring);
  const d = distM(c, center);
  if (d < 800) n800++;
  if (d < 1200) n1200++;
}
console.log(
  JSON.stringify({
    core: coreRings.length,
    umlandKept: Math.min(umland.length, remain),
    total: buildings.length,
    n800,
    n1200,
    bytes: fs.statSync(MAP).size,
  }),
);
