/** Google Maps helpers for city-pack tooling (Geocode / Places / Street View).
 * Kosten: Legacy Text Search ist teuer — maxPages default 1; Key muss im
 * Findus-GCP-Projekt liegen (nie „My First Project“).
 */

import { loadEnvFile, sleep } from './lib.mjs';

loadEnvFile();

export function requireGoogleKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!key || key.includes('your-')) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY in .env');
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
  return gjson(u.toString());
}

export async function placesText(query, location, key = requireGoogleKey()) {
  const u = new URL(
    'https://maps.googleapis.com/maps/api/place/textsearch/json',
  );
  u.searchParams.set('query', query);
  u.searchParams.set('language', 'de');
  u.searchParams.set('region', 'de');
  u.searchParams.set('key', key);
  if (location) {
    u.searchParams.set('location', `${location.lat},${location.lng}`);
    u.searchParams.set('radius', String(location.radiusM || 4000));
  }
  await sleep(120);
  return gjson(u.toString());
}

/**
 * Text Search with pagination (up to `maxPages` × ~20 results).
 * Default 1 page — jede weitere Seite = volle Text-Search-Rechnung.
 * Prefer OSM/cache in callers; Google nur für Lücken.
 */
export async function placesTextAll(
  query,
  location,
  { maxPages = 1, key = requireGoogleKey() } = {},
) {
  const all = [];
  let pageToken = null;
  for (let page = 0; page < maxPages; page += 1) {
    const u = new URL(
      'https://maps.googleapis.com/maps/api/place/textsearch/json',
    );
    u.searchParams.set('query', query);
    u.searchParams.set('language', 'de');
    u.searchParams.set('region', 'de');
    u.searchParams.set('key', key);
    if (location) {
      u.searchParams.set('location', `${location.lat},${location.lng}`);
      u.searchParams.set('radius', String(location.radiusM || 6000));
    }
    if (pageToken) u.searchParams.set('pagetoken', pageToken);
    // Google requires a short delay before pagetoken works
    await sleep(pageToken ? 2000 : 120);
    const data = await gjson(u.toString());
    all.push(...(data.results || []));
    pageToken = data.next_page_token || null;
    if (!pageToken) break;
  }
  return { results: all, status: all.length ? 'OK' : 'ZERO_RESULTS' };
}

export async function placesNearby(
  location,
  { type, keyword, radiusM = 3500 } = {},
  key = requireGoogleKey(),
) {
  const u = new URL(
    'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
  );
  u.searchParams.set('location', `${location.lat},${location.lng}`);
  u.searchParams.set('radius', String(radiusM));
  u.searchParams.set('language', 'de');
  u.searchParams.set('key', key);
  if (type) u.searchParams.set('type', type);
  if (keyword) u.searchParams.set('keyword', keyword);
  await sleep(120);
  return gjson(u.toString());
}

export async function placeDetails(placeId, key = requireGoogleKey()) {
  const u = new URL(
    'https://maps.googleapis.com/maps/api/place/details/json',
  );
  u.searchParams.set('place_id', placeId);
  u.searchParams.set('language', 'de');
  u.searchParams.set(
    'fields',
    'place_id,name,geometry,formatted_address,types,url,website,opening_hours,rating,user_ratings_total,entrance',
  );
  u.searchParams.set('key', key);
  await sleep(120);
  return gjson(u.toString());
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
  const places = await placesText(query, near);
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
  if (!best?.place_id) return locOf(best);

  // Details = better pin / entrance geometry when available
  try {
    const det = await placeDetails(best.place_id);
    return locOf(det.result) || locOf(best);
  } catch {
    return locOf(best);
  }
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
