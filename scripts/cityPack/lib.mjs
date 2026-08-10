/** Shared helpers for generic city-pack tooling. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
export const STAEDTE_DIR = path.join(ROOT, 'data', 'staedte');

export function loadEnvFile() {
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

export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function offset(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: +(lat + dLat).toFixed(7),
    lng: +(lng + dLng).toFixed(7),
  };
}

export function boxPolygon(lat, lng, halfM) {
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

export function centroid(poly) {
  if (!poly?.length) return null;
  return {
    lat: poly.reduce((s, p) => s + (p.latitude ?? p.lat), 0) / poly.length,
    lng: poly.reduce((s, p) => s + (p.longitude ?? p.lng), 0) / poly.length,
  };
}

export function loadPack(cityId) {
  const file = path.join(STAEDTE_DIR, `${cityId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function savePack(pack, { bumpVersion = true } = {}) {
  fs.mkdirSync(STAEDTE_DIR, { recursive: true });
  if (bumpVersion) {
    pack.data_version = Number(pack.data_version || 0) + 1;
  }
  const file = path.join(STAEDTE_DIR, `${pack.city_id}.json`);
  fs.writeFileSync(file, JSON.stringify(pack, null, 2), 'utf8');
  return file;
}

export function packPath(cityId) {
  return path.join(STAEDTE_DIR, `${cityId}.json`);
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

/** Categories that belong in a Module-1 pack (stable narrative POIs). */
export const MODULE1_MUST_HAVE = [
  'transport',
  'museum',
  'denkmal',
  'kirche',
  'natur',
  'aussicht',
  'freizeit',
];

/** Nice-to-have; hotels/restaurants optional (live research preferred). */
export const MODULE1_NICE = [
  'cafe',
  'restaurant',
  'hotel',
  'einkaufen',
  'service',
  'gesundheit',
  'sport',
  'hafen',
  'bahnhof',
];

/** Ephemeral topics → live research prompts, never hard prices/menus. */
export const LIVE_RESEARCH_TOPICS = [
  {
    id: 'events_today',
    topic: 'events',
    prompt:
      'Was läuft HEUTE und in den nächsten 7 Tagen an Konzerten, Theater, Festen und Touren in {{city}}? Nur belegte Termine mit Datum, Ort, Link.',
  },
  {
    id: 'tours_activities',
    topic: 'tours',
    prompt:
      'Welche geführten Touren, Wanderungen, Watt-/Naturführungen oder Ticket-Erlebnisse gibt es aktuell in {{city}}? Links zur Buchung, keine erfundenen Preise.',
  },
  {
    id: 'dining_live',
    topic: 'dining',
    prompt:
      'Aktuelle Speisekarten, Ruhetag und Bewertungen für empfohlene Restaurants/Cafés in {{city}} — Links suchen, keine alten Pack-Preise wiederholen.',
  },
  {
    id: 'hotels_live',
    topic: 'hotels',
    prompt:
      'Aktuelle Hotel-/Unterkunftsverfügbarkeit und Preise in {{city}} für das geplante Datum — Live-Suche, keine Pack-Preise.',
  },
];

export function defaultLiveResearch(cityName) {
  return LIVE_RESEARCH_TOPICS.map((t) => ({
    id: t.id,
    topic: t.topic,
    prompt: t.prompt.replace(/\{\{city\}\}/g, cityName),
    tags: ['live_research', 'ephemeral', t.topic],
  }));
}

export function mapGoogleTypeToCategory(types = []) {
  const t = new Set(types);
  if (t.has('train_station') || t.has('transit_station') || t.has('bus_station'))
    return 'bahnhof';
  if (t.has('ferry_terminal')) return 'hafen';
  if (t.has('museum')) return 'museum';
  if (t.has('church') || t.has('place_of_worship')) return 'kirche';
  if (t.has('park') || t.has('natural_feature')) return 'natur';
  if (t.has('tourist_attraction')) return 'aussicht';
  if (t.has('cafe') || t.has('bakery')) return 'cafe';
  if (t.has('restaurant') || t.has('meal_takeaway')) return 'restaurant';
  if (t.has('lodging')) return 'hotel';
  if (t.has('store') || t.has('supermarket')) return 'einkaufen';
  if (t.has('hospital') || t.has('doctor') || t.has('pharmacy'))
    return 'gesundheit';
  if (t.has('gym') || t.has('stadium')) return 'sport';
  return 'ort';
}

export function isEphemeralCategory(category) {
  return /^(restaurant|fischrestaurant|cafe|hotel|einkaufen|supermarket|apotheke|gesundheit|activity|spielplatz|golf|kino|theater|tankstelle|atm|wasser|sport)$/i.test(
    category || '',
  );
}

/** Story spots need full narration/approaches; directory is offline catalog. */
export function isDirectorySpot(spot) {
  if (!spot) return false;
  if (spot.pack_role === 'directory') return true;
  if ((spot.tags || []).includes('directory')) return true;
  if (Number(spot.place_tier) === 4) return true;
  return false;
}

export function isStorySpot(spot) {
  return !isDirectorySpot(spot) && !isEphemeralCategory(spot?.category);
}

export function relatedTriggers(pack, spot) {
  const triggers = pack.trigger_points || [];
  if (spot.id) {
    const byId = triggers.filter((t) => t.id === spot.id);
    if (byId.length) return byId;
  }
  const name = (spot.name || '').trim().toLowerCase();
  if (!name) return [];
  return triggers.filter(
    (t) => (t.name || '').trim().toLowerCase() === name,
  );
}

/** Prefer id match; fall back to same name (legacy Pinneberg _t1/_t2/_t3). */
export function triggerForSpot(pack, spot) {
  const related = relatedTriggers(pack, spot);
  return (
    related.find((t) => typeof t.lat === 'number' && typeof t.lng === 'number') ||
    related[0] ||
    null
  );
}

export function generalInfoFor(pack, spot) {
  const t = triggerForSpot(pack, spot);
  return String(spot.general_info || t?.general_info || '').trim();
}
