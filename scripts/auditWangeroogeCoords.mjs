#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadEnv();

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const pack = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/staedte/wangerooge.json'), 'utf8'),
);

function centroid(poly) {
  let lat = 0;
  let lng = 0;
  for (const p of poly) {
    lat += p.latitude;
    lng += p.longitude;
  }
  return { lat: lat / poly.length, lng: lng / poly.length };
}
function distM(a, b) {
  const dLat = (a.lat - b.lat) * 111320;
  const dLng =
    (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findPlace(q) {
  const u =
    'https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=' +
    encodeURIComponent(q) +
    '&inputtype=textquery&fields=place_id,name,geometry,formatted_address&locationbias=circle:8000@53.7902,7.8995&key=' +
    KEY;
  const j = await (await fetch(u)).json();
  const c = j.candidates?.[0];
  return c
    ? {
        name: c.name,
        lat: c.geometry.location.lat,
        lng: c.geometry.location.lng,
        addr: c.formatted_address,
        status: j.status,
      }
    : { status: j.status };
}

async function geocode(q) {
  const u =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(q) +
    '&key=' +
    KEY;
  const j = await (await fetch(u)).json();
  const r = j.results?.[0];
  return r
    ? {
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        fmt: r.formatted_address,
        status: j.status,
      }
    : { status: j.status };
}

const re =
  /neudeich|willehad|golf|fundamente|hartmann|harlesiel|westturm|pudding|bahnhof|fähr|fahranleger|leuchtturm|rosenhaus|polizei|apotheke|kortenhorn|diggers_aussen|hauptstrand|st_willehad|neuer_leuchtturm|inselmuseum|gerken|fischerstube|dorfplatz|nikolai|lzo|diggers/i;

const priority = pack.spots.filter((s) => re.test(s.id + s.name));
const all = pack.spots
  .map((s) => ({ s, c: centroid(s.polygonCoordinates) }))
  .sort((a, b) => b.c.lng - a.c.lng);
const extremes = [all[0], all[1], all[all.length - 1], all[all.length - 2]].map(
  (x) => x.s,
);
const seen = new Set();
const suspects = [...priority, ...extremes].filter((s) => {
  if (seen.has(s.id)) return false;
  seen.add(s.id);
  return true;
});

const report = [];
for (const s of suspects) {
  const c = centroid(s.polygonCoordinates);
  const q = /harlesiel/i.test(s.name + s.id)
    ? 'Fährhafen Harlesiel Wittmund'
    : `${s.name.replace(/["«»]/g, '')}, Wangerooge, Germany`;
  let g = await findPlace(q);
  await sleep(140);
  if (!g.lat) {
    g = await geocode(q);
    await sleep(140);
  }
  if (g.lat) {
    const d = distM(c, { lat: g.lat, lng: g.lng });
    report.push({
      id: s.id,
      name: s.name,
      packLat: c.lat,
      packLng: c.lng,
      gLat: g.lat,
      gLng: g.lng,
      gLabel: g.name || g.fmt,
      delta_m: Math.round(d),
      bad: d > 200,
    });
  } else {
    report.push({
      id: s.id,
      name: s.name,
      packLat: c.lat,
      packLng: c.lng,
      status: g.status,
      bad: true,
    });
  }
}
report.sort((a, b) => (b.delta_m || 9999) - (a.delta_m || 0));
fs.writeFileSync(
  path.join(ROOT, 'data/staedte/_wg_coord_check.json'),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      checked: report.length,
      bad: report.filter((r) => r.bad),
      okish: report.filter((r) => !r.bad).length,
    },
    null,
    2,
  ),
);
