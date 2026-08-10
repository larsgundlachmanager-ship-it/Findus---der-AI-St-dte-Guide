#!/usr/bin/env node
/**
 * Audit & refine city packs with Google Geocoding + Places + Street View metadata.
 * Reads GOOGLE_MAPS_API_KEY from .env (never prints the key).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
const KEY = process.env.GOOGLE_MAPS_API_KEY || '';
if (!KEY || KEY.includes('your-')) {
  console.error('Missing GOOGLE_MAPS_API_KEY in .env');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function centroid(poly) {
  if (!poly?.length) return null;
  return {
    lat: poly.reduce((s, p) => s + (p.latitude ?? p.lat), 0) / poly.length,
    lng: poly.reduce((s, p) => s + (p.longitude ?? p.lng), 0) / poly.length,
  };
}

async function gjson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`${data.status}: ${data.error_message || url.slice(0, 80)}`);
  }
  return data;
}

async function geocode(query, bias) {
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  u.searchParams.set('address', query);
  u.searchParams.set('language', 'de');
  u.searchParams.set('region', 'de');
  u.searchParams.set('key', KEY);
  if (bias) {
    u.searchParams.set('bounds', `${bias.swLat},${bias.swLng}|${bias.neLat},${bias.neLng}`);
  }
  await sleep(120);
  return gjson(u.toString());
}

async function placesText(query, location) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  u.searchParams.set('query', query);
  u.searchParams.set('language', 'de');
  u.searchParams.set('region', 'de');
  u.searchParams.set('key', KEY);
  if (location) {
    u.searchParams.set('location', `${location.lat},${location.lng}`);
    u.searchParams.set('radius', '2500');
  }
  await sleep(120);
  return gjson(u.toString());
}

async function streetViewMeta(lat, lng) {
  const u = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('radius', '40');
  u.searchParams.set('source', 'outdoor');
  u.searchParams.set('key', KEY);
  await sleep(80);
  return gjson(u.toString());
}

function boxPolygon(lat, lng, halfMeters) {
  const dLat = halfMeters / 111320;
  const dLng = halfMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    { latitude: lat - dLat, longitude: lng - dLng },
    { latitude: lat - dLat, longitude: lng + dLng },
    { latitude: lat + dLat, longitude: lng + dLng },
    { latitude: lat + dLat, longitude: lng - dLng },
    { latitude: lat - dLat, longitude: lng - dLng },
  ];
}

function elongatePolygon(lat, lng, halfLenM, halfWM) {
  const dLat = halfWM / 111320;
  const dLng = halfLenM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    { latitude: lat - dLat, longitude: lng - dLng },
    { latitude: lat - dLat, longitude: lng + dLng },
    { latitude: lat + dLat, longitude: lng + dLng },
    { latitude: lat + dLat, longitude: lng - dLng },
    { latitude: lat - dLat, longitude: lng - dLng },
  ];
}

function pickBest(results, preferTypes = []) {
  if (!results?.length) return null;
  const scored = results.map((r) => {
    let score = 0;
    const types = r.types || [];
    for (const t of preferTypes) if (types.includes(t)) score += 10;
    if (types.includes('point_of_interest')) score += 2;
    if (types.includes('establishment')) score += 1;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

function locOf(r) {
  if (!r) return null;
  const loc = r.geometry?.location;
  if (!loc) return null;
  return {
    lat: loc.lat,
    lng: loc.lng,
    name: r.name || r.formatted_address || r.place_id,
    place_id: r.place_id,
    types: r.types || [],
    address: r.formatted_address || r.vicinity || null,
  };
}

async function resolvePlace(query, { near, preferTypes = [], geocodeFallback = true } = {}) {
  const places = await placesText(query, near);
  let best = pickBest(places.results, preferTypes);
  if (!best && geocodeFallback) {
    const bias = near
      ? {
          swLat: near.lat - 0.05,
          swLng: near.lng - 0.05,
          neLat: near.lat + 0.05,
          neLng: near.lng + 0.05,
        }
      : null;
    const geo = await geocode(query, bias);
    best = pickBest(geo.results, preferTypes) || geo.results?.[0];
  }
  return locOf(best);
}

// --- Prisdorf ---
async function fixPrisdorf() {
  const file = path.join(ROOT, 'data/staedte/prisdorf.json');
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const spotId = 'prisdorf_bahnhof_wartehäuschen';
  const spot = pack.spots.find((s) => s.id === spotId);
  const trigger = pack.trigger_points.find((t) => t.id === spotId);

  const station = await resolvePlace('Bahnhof Prisdorf', {
    near: { lat: 53.6753, lng: 9.7602 },
    preferTypes: ['train_station', 'transit_station', 'subway_station'],
  });
  // fallback already used DB coords if Google misses
  const center = station || { lat: 53.675291, lng: 9.760216, name: 'DB fallback' };

  const sv = await streetViewMeta(center.lat, center.lng);
  const approachN = {
    lat: +(center.lat + 30 / 111320).toFixed(7),
    lng: +center.lng.toFixed(7),
  };
  const approachS = {
    lat: +(center.lat - 28 / 111320).toFixed(7),
    lng: +(center.lng - 0.00005).toFixed(7),
  };
  const svN = await streetViewMeta(approachN.lat, approachN.lng);
  const svS = await streetViewMeta(approachS.lat, approachS.lng);

  const polygon = elongatePolygon(center.lat, center.lng, 95, 18);
  spot.polygonCoordinates = polygon;
  spot.approach_triggers = [
    {
      id: 'prisdorf_bahnhof_approach_bahnhofstrasse_nord',
      lat: approachN.lat,
      lng: approachN.lng,
      radius_m: 28,
      teaser_text:
        svN.status === 'OK'
          ? 'Auf der Bahnhofstraße kurz vor den Gleisen: Gleich voraus liegt der Haltepunkt Prisdorf — schau nach dem Fachwerk-Wartehäuschen am Bahnsteig.'
          : 'Kurz vor den Gleisen: Der Haltepunkt Prisdorf liegt direkt voraus.',
      condition_rule: 'always',
      _streetview: svN.status,
    },
    {
      id: 'prisdorf_bahnhof_approach_hudenfeld',
      lat: approachS.lat,
      lng: approachS.lng,
      radius_m: 28,
      teaser_text:
        'Von der Südseite der Gleise: Über den Übergang zum Bahnsteig und zum Wartehäuschen.',
      condition_rule: 'always',
      _streetview: svS.status,
    },
  ];
  spot.sub_pois = [
    {
      id: 'prisdorf_bahnhof_wartehaeuschen_sub',
      name: 'Historisches Bahnwartehäuschen',
      lat: +(center.lat + 8 / 111320).toFixed(7),
      lng: +(center.lng + 12 / (111320 * Math.cos((center.lat * Math.PI) / 180))).toFixed(7),
      radius_m: 12,
      fact_details:
        'Siehst du das Fachwerk mit dem Walmdach? 1911 von Bürgern mitfinanziert, später vom Verein Wartehäuschen Prisdorf gerettet und saniert.',
      tags: ['denkmal', 'architecture'],
    },
    {
      id: 'prisdorf_bahnhof_gueterbahnsteig_sub',
      name: 'Alter Güterbahnsteig / abgetrenntes Gleis',
      lat: +center.lat.toFixed(7),
      lng: +(center.lng - 25 / (111320 * Math.cos((center.lat * Math.PI) / 180))).toFixed(7),
      radius_m: 14,
      fact_details:
        'Am Gleisende erinnern Spuren des Güterverkehrs und abgetrennter Gleise daran, dass hier früher mehr Bahnhof war als nur ein Haltepunkt.',
      tags: ['transport', 'historical_core'],
    },
  ];

  trigger.lat = center.lat;
  trigger.lng = center.lng;
  trigger.polygon = polygon.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  trigger.trigger_kind = 'area';
  trigger.trigger_type = 'polygon';
  trigger.radius_m = 35;

  pack.data_version = Math.max(Number(pack.data_version || 0) + 1, 10);
  // strip internal flags
  for (const a of spot.approach_triggers) delete a._streetview;

  fs.writeFileSync(file, JSON.stringify(pack, null, 2));
  return {
    city: 'prisdorf',
    version: pack.data_version,
    google: station,
    used: center,
    streetview_station: sv.status,
    streetview_approaches: [svN.status, svS.status],
    delta_from_previous_db_m: distM(
      { lat: 53.675291, lng: 9.760216 },
      center,
    ),
  };
}

// --- Wangerooge ---
const WANGEROOGE_QUERIES = [
  {
    id: 'wangerooge_anleger',
    q: 'Fähranleger Wangerooge',
    prefer: ['transit_station', 'point_of_interest'],
    half: 45,
  },
  {
    id: 'wangerooge_inselbahnhof',
    q: 'Bahnhof Wangerooge',
    prefer: ['train_station', 'transit_station'],
    half: 35,
  },
  {
    id: 'wangerooge_leuchtturm',
    q: 'Alter Leuchtturm Wangerooge',
    prefer: ['museum', 'tourist_attraction', 'point_of_interest'],
    half: 22,
  },
  {
    id: 'wangerooge_westturm',
    q: 'Westturm Wangerooge',
    prefer: ['tourist_attraction', 'point_of_interest'],
    half: 28,
  },
  {
    id: 'wangerooge_nikolaikirche',
    q: 'Nikolai-Kirche Wangerooge',
    prefer: ['church', 'place_of_worship'],
    half: 22,
  },
  {
    id: 'wangerooge_dorfplatz',
    q: 'Dorfplatz Wangerooge',
    prefer: ['park', 'premise'],
    half: 35,
  },
  {
    id: 'wangerooge_nationalparkhaus',
    q: 'Nationalpark-Haus Wangerooge Rosenhaus',
    prefer: ['museum', 'tourist_attraction'],
    half: 22,
  },
  {
    id: 'wangerooge_promenade',
    q: 'Obere Strandpromenade Wangerooge',
    prefer: ['route', 'premise'],
    half: 55,
  },
  {
    id: 'wangerooge_cafe_pudding',
    q: 'Cafe Pudding Wangerooge',
    prefer: ['cafe', 'restaurant', 'food'],
    half: 16,
  },
  {
    id: 'wangerooge_bistro_am_strand',
    q: 'Bistro am Strand Wangerooge',
    prefer: ['restaurant', 'food', 'meal_takeaway'],
    half: 16,
  },
  {
    id: 'wangerooge_hauptstrand',
    q: 'Strand Wangerooge Nordseite',
    prefer: ['natural_feature'],
    half: 80,
    keepIfNoHit: true,
  },
  {
    id: 'wangerooge_weststrand',
    q: 'Weststrand Wangerooge',
    prefer: ['natural_feature'],
    half: 70,
    keepIfNoHit: true,
  },
];

async function fixWangerooge() {
  const file = path.join(ROOT, 'data/staedte/wangerooge.json');
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const island = { lat: 53.7902, lng: 7.8995 };
  const report = [];

  for (const item of WANGEROOGE_QUERIES) {
    const spot = pack.spots.find((s) => s.id === item.id);
    const trigger = pack.trigger_points.find((t) => t.id === item.id);
    if (!spot || !trigger) {
      report.push({ id: item.id, status: 'MISSING_IN_PACK' });
      continue;
    }
    const old = centroid(spot.polygonCoordinates) || {
      lat: trigger.lat,
      lng: trigger.lng,
    };
    const hit = await resolvePlace(item.q, {
      near: island,
      preferTypes: item.prefer,
    });
    if (!hit) {
      report.push({
        id: item.id,
        status: item.keepIfNoHit ? 'KEEP_NO_GOOGLE_HIT' : 'NO_HIT',
        pack: old,
      });
      continue;
    }
    const d = distM(old, hit);
    const half = item.half || 25;
    const polygon =
      item.id.includes('bahnhof') || item.id.includes('promenade')
        ? elongatePolygon(hit.lat, hit.lng, half * 1.4, Math.max(14, half * 0.35))
        : boxPolygon(hit.lat, hit.lng, half);

    spot.polygonCoordinates = polygon;
    // keep approach south of place for street approach
    const aLat = +(hit.lat - 38 / 111320).toFixed(7);
    const aLng = +hit.lng.toFixed(7);
    const svA = await streetViewMeta(aLat, aLng);
    spot.approach_triggers = [
      {
        id: `${item.id}_approach_1`,
        lat: aLat,
        lng: aLng,
        radius_m: 30,
        teaser_text:
          spot.approach_triggers?.[0]?.teaser_text ||
          `Gleich voraus liegt ${spot.name}.`,
        condition_rule: 'always',
      },
    ];
    // keep existing subs but shift relative to new center if any
    if (spot.sub_pois?.length) {
      for (const s of spot.sub_pois) {
        // leave relative offsets roughly: re-anchor first sub near center
        if (s.id.includes('mitte') || s.id.includes('steig')) {
          s.lat = +(hit.lat + 0.00005).toFixed(7);
          s.lng = +(hit.lng + 0.00005).toFixed(7);
        }
      }
    }

    trigger.lat = hit.lat;
    trigger.lng = hit.lng;
    trigger.polygon = polygon.map((p) => ({ lat: p.latitude, lng: p.longitude }));
    trigger.trigger_kind = 'area';
    trigger.trigger_type = 'polygon';

    report.push({
      id: item.id,
      status: d < 40 ? 'OK' : d < 120 ? 'UPDATED_CHECK' : 'UPDATED_FAR',
      delta_m: Math.round(d),
      google: {
        lat: +hit.lat.toFixed(6),
        lng: +hit.lng.toFixed(6),
        name: hit.name,
        address: hit.address,
        types: hit.types.slice(0, 5),
      },
      streetview_approach: svA.status,
    });
  }

  pack.data_version = Math.max(Number(pack.data_version || 0) + 1, 3);
  pack._google_audit = {
    at: new Date().toISOString(),
    engine: 'Geocoding+Places+StreetViewMetadata',
  };
  const clean = structuredClone(pack);
  // keep audit out of runtime pack optional — leave in file for transparency
  fs.writeFileSync(file, JSON.stringify(clean, null, 2));
  return { city: 'wangerooge', version: pack.data_version, places: report };
}

const prisdorf = await fixPrisdorf();
const wangerooge = await fixWangerooge();

const indexPath = path.join(ROOT, 'data/staedte/index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
for (const c of index.available_cities) {
  if (c.id === 'prisdorf') c.data_version = prisdorf.version;
  if (c.id === 'wangerooge') c.data_version = wangerooge.version;
}
index.last_global_update = new Date().toISOString();
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

const out = { prisdorf, wangerooge };
fs.writeFileSync(
  path.join(ROOT, 'data/staedte/google_audit_report.json'),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
