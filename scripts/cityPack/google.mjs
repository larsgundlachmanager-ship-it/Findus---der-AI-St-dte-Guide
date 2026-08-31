/** Google Maps helpers for city-pack tooling (Geocode / Places API New / Street View).
 * Places Legacy (Text Search / Nearby) ist in neuen GCP-Projekten oft deaktiviert —
 * wir nutzen Places API (New): places.googleapis.com/v1
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile, sleep, STAEDTE_DIR } from './lib.mjs';

loadEnvFile();

/**
 * Field masks = SKU. websiteUri / rating / userRatingCount → Enterprise
 * (~35 $/1k Text Search, ~20 $/1k Details). Pack-GPS braucht das nicht.
 *
 * Discovery: Text Search Pro (~32 $/1k) — Name, Pin, Adresse, Types.
 * resolvePlace: Text Search IDs Only (kostenlos) + Details Essentials (~5 $/1k).
 */
const PLACES_FIELD_MASK_PRO =
  'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.googleMapsUri';
const PLACES_FIELD_MASK_ID = 'places.id';
const DETAILS_FIELD_MASK_ESSENTIALS =
  'id,displayName,location,formattedAddress,types,googleMapsUri';
const DETAILS_FIELD_MASK_REVIEWS =
  'id,displayName,types,editorialSummary,reviews.text,reviews.rating';

const CACHE_PATH = path.join(STAEDTE_DIR, '.places-cache.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const cost = {
  textPro: 0,
  textId: 0,
  detailsEss: 0,
  detailsReviews: 0,
  geocode: 0,
  cacheHit: 0,
};

function estUsd() {
  return (
    cost.textPro * 0.032 +
    cost.detailsEss * 0.005 +
    cost.detailsReviews * 0.025 +
    cost.geocode * 0.005
  );
}

function logCost(reason = 'done') {
  const usd = estUsd();
  if (cost.textPro + cost.textId + cost.detailsEss + cost.detailsReviews + cost.geocode + cost.cacheHit === 0) {
    return;
  }
  console.log(
    `[places] ${reason} searchPro=${cost.textPro} searchId=${cost.textId} details=${cost.detailsEss} reviews=${cost.detailsReviews} geocode=${cost.geocode} cacheHit=${cost.cacheHit} ≈ $${usd.toFixed(2)}`,
  );
}

process.on('exit', () => logCost('exit'));

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return { savedAt: new Date().toISOString(), entries: {} };
  }
}

function saveCache(cache) {
  try {
    fs.mkdirSync(STAEDTE_DIR, { recursive: true });
    cache.savedAt = new Date().toISOString();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch {
    /* cache is best-effort */
  }
}

function cacheGet(key) {
  const cache = loadCache();
  const hit = cache.entries?.[key];
  if (!hit || !hit.at) return null;
  if (Date.now() - new Date(hit.at).getTime() > CACHE_TTL_MS) return null;
  cost.cacheHit += 1;
  return hit.value;
}

function cacheSet(key, value) {
  const cache = loadCache();
  cache.entries = cache.entries || {};
  cache.entries[key] = { at: new Date().toISOString(), value };
  saveCache(cache);
}

function textCacheKey(kind, query, location) {
  const lat = location?.lat != null ? Number(location.lat).toFixed(3) : '';
  const lng = location?.lng != null ? Number(location.lng).toFixed(3) : '';
  const r = location?.radiusM || '';
  return `text:${kind}:${String(query).toLowerCase()}:${lat}:${lng}:${r}`;
}

export function requireGoogleKey() {
  const key =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    '';
  if (!key || key.includes('your-')) {
    throw new Error(
      'Missing GOOGLE_MAPS_API_KEY / EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in .env',
    );
  }
  return key;
}

async function gjson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(
      `${data.status}: ${data.error_message || url.slice(0, 100)}`,
    );
  }
  return data;
}

/** Normalize Places API (New) place → legacy Text Search result shape. */
function fromNewPlace(place) {
  if (!place) return null;
  const rawId = String(place.id || '').replace(/^places\//, '');
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const reviews = (place.reviews || [])
    .map((r) => ({
      rating: r.rating ?? null,
      text: String(r.text?.text || r.originalText?.text || '').trim(),
    }))
    .filter((r) => r.text.length >= 8);
  return {
    place_id: rawId || null,
    name: place.displayName?.text || place.formattedAddress || rawId,
    geometry:
      lat != null && lng != null
        ? { location: { lat, lng } }
        : undefined,
    formatted_address: place.formattedAddress || null,
    vicinity: place.formattedAddress || null,
    types: place.types || [],
    rating: place.rating ?? null,
    user_ratings_total: place.userRatingCount ?? null,
    website: place.websiteUri || null,
    url: place.googleMapsUri || null,
    editorialSummary: place.editorialSummary?.text || null,
    reviews,
  };
}

async function placesNewPost(path, body, fieldMask, key = requireGoogleKey()) {
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || 'Places New error';
    const status = data?.error?.status || `HTTP_${res.status}`;
    throw new Error(`${status}: ${msg}`);
  }
  return data;
}

export async function geocode(query, bias, key = requireGoogleKey()) {
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  u.searchParams.set('address', query);
  u.searchParams.set('language', 'de');
  u.searchParams.set('region', 'de');
  u.searchParams.set('key', key);
  if (bias) {
    u.searchParams.set(
      'bounds',
      `${bias.swLat},${bias.swLng}|${bias.neLat},${bias.neLng}`,
    );
  }
  await sleep(120);
  cost.geocode += 1;
  return gjson(u.toString());
}

export async function placesText(query, location, key = requireGoogleKey()) {
  const body = {
    textQuery: query,
    languageCode: 'de',
    maxResultCount: 20,
  };
  if (location?.lat != null && location?.lng != null) {
    const radiusM = Number(location.radiusM || 4000);
    body.locationBias = {
      circle: {
        center: { latitude: location.lat, longitude: location.lng },
        radius: Math.min(Math.max(radiusM, 50), 50000),
      },
    };
  }
  const cacheKey = textCacheKey('pro', query, location);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  await sleep(120);
  try {
    cost.textPro += 1;
    const data = await placesNewPost(
      'places:searchText',
      body,
      PLACES_FIELD_MASK_PRO,
      key,
    );
    const results = (data.places || []).map(fromNewPlace).filter(Boolean);
    const out = { results, status: results.length ? 'OK' : 'ZERO_RESULTS' };
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/REQUEST_DENIED|PERMISSION_DENIED|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED/i.test(msg)) {
      console.warn('[placesText] soft-fail →', msg.slice(0, 120));
      return { results: [], status: 'ZERO_RESULTS' };
    }
    throw e;
  }
}

/**
 * Text Search (New). `maxPages` kept for API compat — New API uses maxResultCount.
 */
export async function placesTextAll(
  query,
  location,
  { maxPages = 1, key = requireGoogleKey() } = {},
) {
  const maxResultCount = Math.min(20 * Math.max(1, maxPages), 20);
  const body = {
    textQuery: query,
    languageCode: 'de',
    maxResultCount,
  };
  if (location?.lat != null && location?.lng != null) {
    const radiusM = Number(location.radiusM || 6000);
    body.locationBias = {
      circle: {
        center: { latitude: location.lat, longitude: location.lng },
        radius: Math.min(Math.max(radiusM, 50), 50000),
      },
    };
  }
  const cacheKey = textCacheKey('pro', query, location);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  await sleep(120);
  try {
    cost.textPro += 1;
    const data = await placesNewPost(
      'places:searchText',
      body,
      PLACES_FIELD_MASK_PRO,
      key,
    );
    const results = (data.places || []).map(fromNewPlace).filter(Boolean);
    const out = { results, status: results.length ? 'OK' : 'ZERO_RESULTS' };
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/REQUEST_DENIED|PERMISSION_DENIED|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED/i.test(msg)) {
      console.warn('[placesTextAll] soft-fail →', msg.slice(0, 120));
      return { results: [], status: 'ZERO_RESULTS' };
    }
    throw e;
  }
}

export async function placesNearby(
  location,
  { type, keyword, radiusM = 3500 } = {},
  key = requireGoogleKey(),
) {
  const body = {
    languageCode: 'de',
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: location.lat, longitude: location.lng },
        radius: Math.min(Math.max(Number(radiusM) || 3500, 50), 50000),
      },
    },
  };
  if (type) body.includedTypes = [type];
  // New Nearby has no free-text keyword; fall back to Text Search bias.
  if (keyword && !type) {
    return placesText(keyword, { ...location, radiusM }, key);
  }
  if (keyword && type) {
    return placesText(`${keyword} ${type}`, { ...location, radiusM }, key);
  }
  await sleep(120);
  try {
    cost.textPro += 1;
    const data = await placesNewPost(
      'places:searchNearby',
      body,
      PLACES_FIELD_MASK_PRO,
      key,
    );
    const results = (data.places || []).map(fromNewPlace).filter(Boolean);
    return { results, status: results.length ? 'OK' : 'ZERO_RESULTS' };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/REQUEST_DENIED|PERMISSION_DENIED|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED/i.test(msg)) {
      console.warn('[placesNearby] soft-fail →', msg.slice(0, 120));
      return { results: [], status: 'ZERO_RESULTS' };
    }
    throw e;
  }
}

export async function placeDetails(placeId, key = requireGoogleKey()) {
  const id = String(placeId || '').replace(/^places\//, '');
  if (!id) return { result: null, status: 'ZERO_RESULTS' };
  const cacheKey = `details:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  await sleep(120);
  cost.detailsEss += 1;
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK_ESSENTIALS,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`${data?.error?.status || res.status}: ${msg}`);
  }
  const result = fromNewPlace(data);
  const out = { result, status: result ? 'OK' : 'ZERO_RESULTS' };
  cacheSet(cacheKey, out);
  return out;
}

/** Place Details with reviews (Atmosphere). Cached separately from Essentials. */
export async function placeDetailsReviews(placeId, key = requireGoogleKey()) {
  const id = String(placeId || '').replace(/^places\//, '');
  if (!id) return { result: null, status: 'ZERO_RESULTS' };
  const cacheKey = `detailsReviews:v1:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  await sleep(120);
  cost.detailsReviews += 1;
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK_REVIEWS,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`${data?.error?.status || res.status}: ${msg}`);
  }
  const result = fromNewPlace(data);
  const out = { result, status: result ? 'OK' : 'ZERO_RESULTS' };
  cacheSet(cacheKey, out);
  return out;
}

export async function streetViewMeta(lat, lng, key = requireGoogleKey()) {
  const u = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('radius', '40');
  u.searchParams.set('source', 'outdoor');
  u.searchParams.set('key', key);
  await sleep(80);
  return gjson(u.toString());
}

export async function placesTextIdsOnly(query, location, key = requireGoogleKey()) {
  const body = {
    textQuery: query,
    languageCode: 'de',
    maxResultCount: 5,
  };
  if (location?.lat != null && location?.lng != null) {
    const radiusM = Number(location.radiusM || 4000);
    body.locationBias = {
      circle: {
        center: { latitude: location.lat, longitude: location.lng },
        radius: Math.min(Math.max(radiusM, 50), 50000),
      },
    };
  }
  await sleep(80);
  cost.textId += 1;
  const data = await placesNewPost(
    'places:searchText',
    body,
    PLACES_FIELD_MASK_ID,
    key,
  );
  return (data.places || [])
    .map((p) => String(p.id || '').replace(/^places\//, ''))
    .filter(Boolean);
}

function pickBest(results, preferTypes = []) {
  if (!results?.length) return null;
  const scored = results.map((r) => {
    let score = 0;
    const types = r.types || [];
    for (const t of preferTypes) if (types.includes(t)) score += 10;
    if (types.includes('point_of_interest')) score += 2;
    if (types.includes('establishment')) score += 1;
    if (types.includes('tourist_attraction')) score += 3;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

/**
 * Prefer Google "entrance" / place geometry — this is the Maps pin users navigate to.
 */
export function locOf(r) {
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
    website: r.website || null,
    rating: r.rating ?? null,
    user_ratings_total: r.user_ratings_total ?? null,
    maps_url: r.url || null,
  };
}

export async function resolvePlace(
  query,
  { near, preferTypes = [], geocodeFallback = true } = {},
) {
  const cacheKey = textCacheKey(
    'resolve',
    query,
    near ? { lat: near.lat, lng: near.lng, radiusM: near.radiusM || 4000 } : null,
  );
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Cheap path: ID-only search (free) + Details Essentials (~$5/1k).
  try {
    const ids = await placesTextIdsOnly(query, near);
    if (ids[0]) {
      const det = await placeDetails(ids[0]);
      const loc = locOf(det.result);
      if (loc) {
        cacheSet(cacheKey, loc);
        return loc;
      }
    }
  } catch (e) {
    console.warn('[resolvePlace] id-only soft-fail', String(e?.message || e).slice(0, 120));
  }

  let places = { results: [] };
  try {
    places = await placesText(query, near);
  } catch (e) {
    console.warn('[resolvePlace] places soft-fail', String(e?.message || e).slice(0, 120));
  }
  let best = pickBest(places.results, preferTypes);
  if (!best && geocodeFallback) {
    const bias = near
      ? {
          swLat: near.lat - 0.06,
          swLng: near.lng - 0.06,
          neLat: near.lat + 0.06,
          neLng: near.lng + 0.06,
        }
      : null;
    const geo = await geocode(query, bias);
    best = pickBest(geo.results, preferTypes) || geo.results?.[0];
  }
  const loc = locOf(best);
  if (loc) cacheSet(cacheKey, loc);
  return loc;
}

/** Discovery queries for Module-1 coverage (stable POIs first). */
export const DISCOVERY_QUERIES = [
  { q: 'Bahnhof OR Haltepunkt OR S-Bahn OR Inselbahn', categoryHint: 'bahnhof', prefer: ['train_station', 'transit_station'] },
  { q: 'Hafen OR Fähre OR Anleger', categoryHint: 'hafen', prefer: ['ferry_terminal', 'point_of_interest'] },
  { q: 'Museum', categoryHint: 'museum', prefer: ['museum'] },
  { q: 'Kirche OR Kapelle', categoryHint: 'kirche', prefer: ['church', 'place_of_worship'] },
  { q: 'Denkmal OR Denkmal OR Skulptur OR Brunnen', categoryHint: 'denkmal', prefer: ['tourist_attraction'] },
  { q: 'Park OR Natur OR Strand OR Dünen OR Aussicht', categoryHint: 'natur', prefer: ['park', 'natural_feature'] },
  { q: 'Leuchtturm OR Aussichtsturm OR Turm', categoryHint: 'aussicht', prefer: ['tourist_attraction'] },
  { q: 'Freizeit OR Sportplatz OR Schwimmbad OR Golf', categoryHint: 'freizeit', prefer: ['stadium', 'gym'] },
  { q: 'Rathaus', categoryHint: 'verwaltung', prefer: ['city_hall'] },
  { q: 'Altstadt OR historischer Stadtkern', categoryHint: 'altstadt', prefer: ['tourist_attraction'] },
  { q: 'Aussichtspunkt OR Viewpoint OR Panorama', categoryHint: 'aussicht', prefer: ['tourist_attraction'] },
  { q: 'Theater OR Konzerthalle OR Oper', categoryHint: 'theater', prefer: ['movie_theater'] },
  { q: 'Wanderweg OR Lehrpfad OR Wandergebiet', categoryHint: 'wanderung', prefer: ['park'] },
  { q: 'Radweg OR Fahrradweg OR Radroute OR Fernradweg', categoryHint: 'radweg', prefer: ['park'] },
  { q: 'Zoo OR Freizeitpark OR Paintball', categoryHint: 'freizeitpark', prefer: ['amusement_park', 'zoo'] },
  { q: 'Souvenir OR Andenken', categoryHint: 'souvenir', prefer: ['store'] },
  { q: 'Krankenhaus OR Apotheke OR Arzt', categoryHint: 'gesundheit', prefer: ['hospital', 'pharmacy', 'doctor'] },
  // Optional — skeleton only, prefer live research for prices/menus
  { q: 'Café OR Cafe', categoryHint: 'cafe', prefer: ['cafe', 'bakery'], optional: true },
  { q: 'Restaurant', categoryHint: 'restaurant', prefer: ['restaurant'], optional: true },
  { q: 'Hotel OR Pension OR Hostel', categoryHint: 'hotel', prefer: ['lodging'], optional: true },
];

/** Offline-directory discovery (no deep story required). */
export const DIRECTORY_QUERIES = [
  { q: 'Supermarkt OR Lidl OR Aldi OR Rewe OR Edeka OR Kaufland', categoryHint: 'supermarket', prefer: ['supermarket', 'grocery_or_supermarket'] },
  { q: 'Apotheke', categoryHint: 'apotheke', prefer: ['pharmacy'] },
  { q: 'Krankenhaus OR Klinik OR Notaufnahme', categoryHint: 'gesundheit', prefer: ['hospital'] },
  { q: 'Polizei', categoryHint: 'service', prefer: ['police'] },
  { q: 'Spielplatz', categoryHint: 'spielplatz', prefer: ['park'] },
  { q: 'Golfplatz OR Golfclub', categoryHint: 'golf', prefer: ['golf_course'] },
  { q: 'Kino OR Theater OR Konzert', categoryHint: 'kino', prefer: ['movie_theater'] },
  { q: 'Kletterhalle OR Boulder OR Klettern', categoryHint: 'activity', prefer: ['gym'] },
  { q: 'Wanderparkplatz OR Wanderweg OR Naturschutzgebiet', categoryHint: 'natur', prefer: ['park', 'natural_feature'] },
  { q: 'Stadion OR Sportplatz OR Tennis', categoryHint: 'sport', prefer: ['stadium'] },
  { q: 'Freibad OR Hallenbad OR Schwimmbad', categoryHint: 'freizeit', prefer: ['gym'] },
  { q: 'Trinkwasserbrunnen OR Brunnen Trinkwasser', categoryHint: 'wasser', prefer: ['point_of_interest'] },
  { q: 'Tankstelle', categoryHint: 'tankstelle', prefer: ['gas_station'] },
  { q: 'Bäckerei', categoryHint: 'cafe', prefer: ['bakery'] },
  { q: 'Drogerie OR dm OR Rossmann', categoryHint: 'einkaufen', prefer: ['store'] },
  { q: 'Feldkreuz OR Wegkreuz OR Bildstock', categoryHint: 'denkmal', prefer: ['place_of_worship'] },
  { q: 'Öffentliche Toilette OR WC', categoryHint: 'toilette', prefer: ['point_of_interest'] },
  { q: 'Gepäckaufbewahrung OR Luggage storage', categoryHint: 'gepaeck', prefer: ['point_of_interest'] },
  { q: 'Tourist Information OR Touristeninformation', categoryHint: 'tourist_info', prefer: ['travel_agency'] },
  { q: 'Wochenmarkt OR Bauernmarkt', categoryHint: 'markt', prefer: ['point_of_interest'] },
  { q: 'Souvenir OR Andenken', categoryHint: 'souvenir', prefer: ['store'] },
];
