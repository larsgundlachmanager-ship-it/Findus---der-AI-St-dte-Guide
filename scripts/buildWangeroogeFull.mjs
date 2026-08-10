#!/usr/bin/env node
/**
 * Build a full Wangerooge city pack via Google Places discovery + geocoding.
 * Every place gets polygon area + approach Wegweiser(s).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/staedte/wangerooge.json');
const REPORT = path.join(ROOT, 'data/staedte/wangerooge_build_report.json');

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
    )
      val = val.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadEnv();
const KEY = process.env.GOOGLE_MAPS_API_KEY || '';
if (!KEY) {
  console.error('Missing GOOGLE_MAPS_API_KEY');
  process.exit(1);
}

const ISLAND = { lat: 53.7902, lng: 7.8995 };
const BOUNDS = {
  minLat: 53.768,
  maxLat: 53.802,
  minLng: 7.84,
  maxLng: 7.98,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function inBounds(lat, lng) {
  return (
    lat >= BOUNDS.minLat &&
    lat <= BOUNDS.maxLat &&
    lng >= BOUNDS.minLng &&
    lng <= BOUNDS.maxLng
  );
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

function offset(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

function boxPolygon(lat, lng, halfM) {
  const a = offset(lat, lng, -halfM, -halfM);
  const b = offset(lat, lng, -halfM, halfM);
  const c = offset(lat, lng, halfM, halfM);
  const d = offset(lat, lng, halfM, -halfM);
  return [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
    { latitude: c.lat, longitude: c.lng },
    { latitude: d.lat, longitude: d.lng },
    { latitude: a.lat, longitude: a.lng },
  ];
}

function elongateEW(lat, lng, halfLenM, halfWM) {
  const a = offset(lat, lng, -halfWM, -halfLenM);
  const b = offset(lat, lng, -halfWM, halfLenM);
  const c = offset(lat, lng, halfWM, halfLenM);
  const d = offset(lat, lng, halfWM, -halfLenM);
  return [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
    { latitude: c.lat, longitude: c.lng },
    { latitude: d.lat, longitude: d.lng },
    { latitude: a.lat, longitude: a.lng },
  ];
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

async function gjson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status)) {
    throw new Error(`${data.status}: ${data.error_message || ''}`);
  }
  return data;
}

async function textSearch(query) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  u.searchParams.set('query', query);
  u.searchParams.set('location', `${ISLAND.lat},${ISLAND.lng}`);
  u.searchParams.set('radius', '5000');
  u.searchParams.set('language', 'de');
  u.searchParams.set('region', 'de');
  u.searchParams.set('key', KEY);
  await sleep(160);
  return gjson(u.toString());
}

async function nearby(type, location = ISLAND, radius = 4500) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  u.searchParams.set('location', `${location.lat},${location.lng}`);
  u.searchParams.set('radius', String(radius));
  u.searchParams.set('type', type);
  u.searchParams.set('language', 'de');
  u.searchParams.set('key', KEY);
  await sleep(160);
  return gjson(u.toString());
}

async function placeDetails(placeId) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  u.searchParams.set('place_id', placeId);
  u.searchParams.set(
    'fields',
    'name,formatted_address,geometry,types,rating,user_ratings_total,opening_hours,website,editorial_summary,serves_vegetarian_food,price_level',
  );
  u.searchParams.set('language', 'de');
  u.searchParams.set('key', KEY);
  await sleep(120);
  return gjson(u.toString());
}

function classify(types = [], name = '') {
  const t = new Set(types);
  const n = name.toLowerCase();
  if (t.has('train_station') || t.has('transit_station') || /bahnhof/.test(n))
    return 'bahnhof';
  if (t.has('church') || t.has('place_of_worship') || /kirche|kapelle/.test(n))
    return 'kirche';
  if (t.has('museum') || /museum|leuchtturm/.test(n)) return 'museum';
  if (t.has('cafe') || t.has('bakery') || /café|cafe|bäckerei/.test(n))
    return 'cafe';
  if (
    t.has('restaurant') ||
    t.has('meal_takeaway') ||
    t.has('food') ||
    /restaurant|bistro|gaststätte|imbiss/.test(n)
  ) {
    if (/fisch|seafood|nordsee|kutter|matjes|garnele/.test(n))
      return 'fischrestaurant';
    return 'restaurant';
  }
  if (t.has('lodging') || /hotel|pension|appartement/.test(n)) return 'hotel';
  if (t.has('park') || t.has('natural_feature') || /strand|düne|promenade/.test(n))
    return 'natur';
  if (t.has('tourist_attraction') || /turm|aussicht/.test(n)) return 'aussicht';
  if (t.has('store') || t.has('supermarket') || /laden|markt/.test(n))
    return 'einkaufen';
  return 'ort';
}

function districtOf(lat, lng) {
  if (lng < 7.87) return 'West';
  if (lat > 53.792) return 'Nord';
  if (lng > 7.93) return 'Ost';
  if (lat < 53.78) return 'Hafen';
  return 'Dorf';
}

function footprint(category, name) {
  if (category === 'bahnhof' || /promenade|strand/.test(name.toLowerCase()))
    return { mode: 'elongate', halfLen: 70, halfW: 18 };
  if (category === 'natur') return { mode: 'box', half: 55 };
  if (category === 'fischrestaurant' || category === 'restaurant' || category === 'cafe')
    return { mode: 'box', half: 16 };
  if (category === 'kirche' || category === 'museum' || category === 'aussicht')
    return { mode: 'box', half: 24 };
  if (category === 'hotel') return { mode: 'box', half: 22 };
  return { mode: 'box', half: 26 };
}

function tagsFor(category, name, types) {
  const tags = new Set([category, 'google_places']);
  const n = name.toLowerCase();
  if (category === 'fischrestaurant' || /fisch|seafood/.test(n)) {
    tags.add('fisch');
    tags.add('fischrestaurant');
    tags.add('abendessen');
  }
  if (category === 'cafe') tags.add('kaffee');
  if (category === 'restaurant') tags.add('abendessen');
  if (category === 'kirche') tags.add('kirchen');
  if (/must|leuchtturm|westturm|bahnhof|anleger|promenade|hauptstrand/i.test(n))
    tags.add('must_have');
  if (types.includes('tourist_attraction')) tags.add('aussicht');
  return [...tags];
}

function bulletsFromDetails(d, category) {
  const bullets = [];
  if (d.formatted_address) bullets.push(`Adresse: ${d.formatted_address}.`);
  if (d.editorial_summary?.overview)
    bullets.push(d.editorial_summary.overview.slice(0, 220));
  if (d.rating != null)
    bullets.push(
      `Google-Bewertung: ${d.rating}/5` +
        (d.user_ratings_total ? ` (${d.user_ratings_total} Stimmen)` : '') +
        '.',
    );
  if (d.opening_hours?.weekday_text?.[0])
    bullets.push(`Öffnungszeiten (Beispiel): ${d.opening_hours.weekday_text[0]}.`);
  if (category === 'fischrestaurant')
    bullets.push('Gastronomie mit Fisch-/Meeresfrüchte-Bezug laut Name/Kategorie.');
  if (bullets.length < 2)
    bullets.push('Ort auf Wangerooge laut Google Places.');
  return bullets.slice(0, 4);
}

const SEED_QUERIES = [
  'Fähranleger Wangerooge',
  'Bahnhof Wangerooge',
  'Alter Leuchtturm Wangerooge',
  'Westturm Wangerooge',
  'Nikolai-Kirche Wangerooge',
  'Dorfplatz Wangerooge',
  'Nationalpark-Haus Wangerooge',
  'Obere Strandpromenade Wangerooge',
  'Hauptstrand Wangerooge',
  'Restaurant Wangerooge',
  'Café Wangerooge',
  'Fischrestaurant Wangerooge',
  'Hotel Wangerooge',
  'Museum Wangerooge',
  'Supermarkt Wangerooge',
  'Imbiss Wangerooge',
  'Kurplatz Wangerooge',
  'Jugendbad Wangerooge',
];

const NEARBY_TYPES = [
  'restaurant',
  'cafe',
  'bakery',
  'museum',
  'church',
  'lodging',
  'tourist_attraction',
  'supermarket',
  'meal_takeaway',
];

async function discover() {
  const byPlaceId = new Map();

  for (const q of SEED_QUERIES) {
    console.log('[search]', q);
    const data = await textSearch(q);
    for (const r of data.results || []) {
      const lat = r.geometry?.location?.lat;
      const lng = r.geometry?.location?.lng;
      if (lat == null || lng == null) continue;
      if (!inBounds(lat, lng)) continue;
      if (!r.place_id) continue;
      const prev = byPlaceId.get(r.place_id);
      if (!prev || (r.user_ratings_total || 0) > (prev.user_ratings_total || 0)) {
        byPlaceId.set(r.place_id, r);
      }
    }
  }

  // Extra nearby around Dorf + Hafen + West
  const centers = [
    ISLAND,
    { lat: 53.775, lng: 7.867 },
    { lat: 53.785, lng: 7.857 },
    { lat: 53.793, lng: 7.9 },
  ];
  for (const c of centers) {
    for (const type of NEARBY_TYPES) {
      console.log('[nearby]', type, c.lat.toFixed(3));
      const data = await nearby(type, c, 2800);
      for (const r of data.results || []) {
        const lat = r.geometry?.location?.lat;
        const lng = r.geometry?.location?.lng;
        if (lat == null || lng == null || !inBounds(lat, lng) || !r.place_id)
          continue;
        if (!byPlaceId.has(r.place_id)) byPlaceId.set(r.place_id, r);
      }
    }
  }

  return [...byPlaceId.values()];
}

function dedupeNearby(places, minDistM = 35) {
  const kept = [];
  const sorted = [...places].sort(
    (a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0),
  );
  for (const p of sorted) {
    const loc = {
      lat: p.geometry.location.lat,
      lng: p.geometry.location.lng,
    };
    if (kept.some((k) => distM(k, loc) < minDistM && k.name === p.name)) continue;
    // merge identical coords different names only if very close AND same category later
    kept.push({ ...p, _loc: loc });
  }
  return kept;
}

async function main() {
  const raw = await discover();
  console.log(`[discover] raw in-bounds: ${raw.length}`);
  const unique = dedupeNearby(raw, 28);
  console.log(`[dedupe] ${unique.length}`);

  // Cap very large sets: keep must-haves + top rated remainder
  const MUST = /anleger|bahnhof|leuchtturm|westturm|nikolai|nationalpark|promenade|hauptstrand|dorfplatz|pudding|bistro/i;
  const must = unique.filter((p) => MUST.test(p.name || ''));
  const rest = unique
    .filter((p) => !MUST.test(p.name || ''))
    .sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0));
  const selected = [...must, ...rest].slice(0, 55);
  console.log(`[select] ${selected.length}`);

  const spots = [];
  const triggers = [];
  const report = [];

  for (let i = 0; i < selected.length; i++) {
    const base = selected[i];
    process.stdout.write(`  (${i + 1}/${selected.length}) ${base.name} … `);
    let details = base;
    try {
      const det = await placeDetails(base.place_id);
      if (det.result) details = { ...base, ...det.result };
    } catch (e) {
      console.log('details-fail', e.message);
    }

    const lat = details.geometry.location.lat;
    const lng = details.geometry.location.lng;
    const name = details.name;
    const category = classify(details.types || [], name);
    const id = `wangerooge_${slugify(name)}`;
    const fp = footprint(category, name);
    const polygon =
      fp.mode === 'elongate'
        ? elongateEW(lat, lng, fp.halfLen, fp.halfW)
        : boxPolygon(lat, lng, fp.half);
    const tags = tagsFor(category, name, details.types || []);
    const bullets = bulletsFromDetails(details, category);
    const ap1 = offset(lat, lng, -36, 0);
    const ap2 = offset(lat, lng, 28, 12);
    const approaches = [
      {
        id: `${id}_approach_1`,
        lat: ap1.lat,
        lng: ap1.lng,
        radius_m: 28,
        teaser_text: `Gleich voraus liegt ${name}. Geh die letzten Meter näher ran.`,
        condition_rule: 'always',
      },
      {
        id: `${id}_approach_2`,
        lat: ap2.lat,
        lng: ap2.lng,
        radius_m: 26,
        teaser_text: `Von hier aus siehst du schon ${name} — ein paar Schritte weiter bist du da.`,
        condition_rule: 'always',
      },
    ];

    const subs = [];
    // light sub for towers / museums
    if (category === 'aussicht' || category === 'museum' || category === 'kirche') {
      subs.push({
        id: `${id}_sub_eingang`,
        name: `${name} Eingang`,
        lat: offset(lat, lng, 6, 4).lat,
        lng: offset(lat, lng, 6, 4).lng,
        radius_m: 10,
        fact_details: `Direkt am Eingang von ${name} — hier lohnt der genauere Blick.`,
        tags: ['sub_poi'],
      });
    }

    spots.push({
      id,
      name,
      district: districtOf(lat, lng),
      category,
      tags,
      bullets,
      facts: {
        origin: bullets[0],
        now: bullets[1] || bullets[0],
        tags,
      },
      polygonCoordinates: polygon,
      approach_triggers: approaches,
      sub_pois: subs,
    });

    triggers.push({
      id,
      name,
      lat,
      lng,
      radius_m: Math.max(20, Math.min(50, (fp.half || 26) * 0.9)),
      trigger_kind: 'area',
      trigger_type: 'polygon',
      polygon: polygon.map((p) => ({ lat: p.latitude, lng: p.longitude })),
      general_info: `${name} auf Wangerooge — ${districtOf(lat, lng)}.`,
      deep_data_pool: bullets.map((t) => ({
        text: t,
        tags: ['sourced_google'],
      })),
    });

    console.log(`${category} ${lat.toFixed(5)},${lng.toFixed(5)}`);
    report.push({
      id,
      name,
      category,
      lat,
      lng,
      place_id: base.place_id,
      rating: details.rating ?? null,
      ratings: details.user_ratings_total ?? null,
    });
  }

  // Ensure id uniqueness
  const seen = new Set();
  for (const s of spots) {
    let id = s.id;
    let n = 2;
    while (seen.has(id)) {
      id = `${s.id}_${n++}`;
    }
    if (id !== s.id) {
      const t = triggers.find((x) => x.id === s.id);
      s.id = id;
      if (t) t.id = id;
      for (const a of s.approach_triggers) a.id = a.id.replace(/^wangerooge_[^_]+/, id);
    }
    seen.add(s.id);
  }

  const pack = {
    city_id: 'wangerooge',
    name: 'Wangerooge',
    data_version: 4,
    symbol: '🏝️',
    lat: ISLAND.lat,
    lng: ISLAND.lng,
    district_division: ['Hafen', 'Dorf', 'Nord', 'West', 'Ost'],
    spots,
    trigger_points: triggers,
    _build: {
      at: new Date().toISOString(),
      engine: 'google_places_full',
      count: spots.length,
    },
  };

  const v = validateCityPack(pack);
  if (!v.ok) {
    console.error(v.errors);
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(pack, null, 2));
  fs.writeFileSync(REPORT, JSON.stringify({ version: 4, places: report }, null, 2));

  const indexPath = path.join(ROOT, 'data/staedte/index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  for (const c of index.available_cities || []) {
    if (c.id === 'wangerooge') {
      c.data_version = 4;
      c.lat = ISLAND.lat;
      c.lng = ISLAND.lng;
      c.symbol = '🏝️';
    }
  }
  index.last_global_update = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  const byCat = {};
  for (const s of spots) byCat[s.category] = (byCat[s.category] || 0) + 1;
  console.log('[wangerooge] wrote', OUT, 'spots', spots.length, byCat);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
