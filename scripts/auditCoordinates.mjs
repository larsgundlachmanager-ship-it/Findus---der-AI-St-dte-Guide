#!/usr/bin/env node
/**
 * Geocode all pack places via Nominatim and compare to pack centroids.
 * Also fetch OSM station details for Prisdorf.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const UA = 'FindusCoordAudit/1.0';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function nominatim(q) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '3');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'de');
  await sleep(1100);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

function centroid(poly) {
  if (!poly?.length) return null;
  const lat = poly.reduce((s, p) => s + (p.latitude ?? p.lat), 0) / poly.length;
  const lng = poly.reduce((s, p) => s + (p.longitude ?? p.lng), 0) / poly.length;
  return { lat, lng };
}

function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function packCenter(spot, trigger) {
  const c = centroid(spot.polygonCoordinates || spot.polygon);
  if (c) return c;
  if (trigger && typeof trigger.lat === 'number') {
    return { lat: trigger.lat, lng: trigger.lng };
  }
  return null;
}

async function auditPack(file, queries) {
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = [];
  for (const item of queries) {
    const spot = pack.spots.find((s) => s.id === item.id);
    const trigger = pack.trigger_points?.find((t) => t.id === item.id);
    const center = spot ? packCenter(spot, trigger) : null;
    let hits = [];
    try {
      hits = await nominatim(item.q);
    } catch (e) {
      rows.push({ id: item.id, error: e.message });
      continue;
    }
    const best = hits[0];
    if (!best || !center) {
      rows.push({
        id: item.id,
        name: spot?.name,
        pack: center,
        nominatim: best
          ? { lat: +best.lat, lng: +best.lon, label: best.display_name }
          : null,
        delta_m: null,
        status: !best ? 'NO_HIT' : 'NO_PACK_CENTER',
      });
      continue;
    }
    const nom = { lat: +best.lat, lng: +best.lon };
    const d = distM(center, nom);
    const approaches = (spot.approach_triggers || []).map((a) => ({
      id: a.id,
      lat: a.lat,
      lng: a.lng,
      dist_to_center_m: Math.round(distM(center, { lat: a.lat, lng: a.lng })),
    }));
    const subs = (spot.sub_pois || []).map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      dist_to_center_m: Math.round(distM(center, { lat: s.lat, lng: s.lng })),
    }));
    rows.push({
      id: item.id,
      name: spot.name,
      pack: { lat: +center.lat.toFixed(6), lng: +center.lng.toFixed(6) },
      nominatim: {
        lat: +nom.lat.toFixed(6),
        lng: +nom.lng.toFixed(6),
        label: best.display_name.slice(0, 120),
        osm: `${best.osm_type}/${best.osm_id}`,
      },
      delta_m: Math.round(d),
      status: d < 40 ? 'OK' : d < 120 ? 'CHECK' : 'BAD',
      approaches,
      subs,
      alt_hits: hits.slice(1, 3).map((h) => ({
        lat: +(+h.lat).toFixed(6),
        lng: +(+h.lon).toFixed(6),
        label: h.display_name.slice(0, 80),
        d: Math.round(distM(center, { lat: +h.lat, lng: +h.lon })),
      })),
    });
  }
  return rows;
}

const prisdorfQs = [
  { id: 'prisdorf_bahnhof_wartehäuschen', q: 'Bahnhof Prisdorf, Germany' },
];

const wangeroogeQs = [
  { id: 'wangerooge_anleger', q: 'Fähranleger Wangerooge' },
  { id: 'wangerooge_inselbahnhof', q: 'Bahnhof Wangerooge Inselbahn' },
  { id: 'wangerooge_leuchtturm', q: 'Alter Leuchtturm Wangerooge' },
  { id: 'wangerooge_westturm', q: 'Westturm Wangerooge' },
  { id: 'wangerooge_kirche_dorf', q: 'Kirche Wangerooge Dorf' },
  { id: 'wangerooge_hauptstrand', q: 'Hauptstrand Wangerooge' },
  { id: 'wangerooge_weststrand', q: 'Weststrand Wangerooge' },
  { id: 'wangerooge_duenen', q: 'Dünen Wangerooge' },
  { id: 'wangerooge_nationalparkhaus', q: 'Nationalpark-Haus Wangerooge' },
  { id: 'wangerooge_kurplatz', q: 'Kurplatz Wangerooge' },
  { id: 'wangerooge_promenade', q: 'Promenade Wangerooge' },
  { id: 'wangerooge_cafe', q: 'Café Kurplatz Wangerooge' },
  { id: 'wangerooge_fischrestaurant', q: 'Restaurant Fisch Wangerooge' },
  { id: 'wangerooge_strandimbiss', q: 'Strandimbiss Wangerooge' },
  { id: 'wangerooge_buchladen', q: 'Buchhandlung Wangerooge' },
  { id: 'wangerooge_heimatmuseum', q: 'Heimatmuseum Wangerooge' },
];

const out = {
  generated_at: new Date().toISOString(),
  note: 'Nominatim/OSM audit — Google Maps needs consent + no API key in project',
  prisdorf: await auditPack(
    path.join(ROOT, 'data/staedte/prisdorf.json'),
    prisdorfQs,
  ),
  wangerooge: await auditPack(
    path.join(ROOT, 'data/staedte/wangerooge.json'),
    wangeroogeQs,
  ),
};

const dest = path.join(ROOT, 'data/staedte/coord_audit.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log('wrote', dest);
