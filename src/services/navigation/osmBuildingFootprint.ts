/**
 * OSM-Gebäude-/Platz-/Gleis-Umrisse für die Fog-Karte.
 * Pack-Boxen (4 Ecken) werden durch echte Ways ersetzt, sobald Overpass antwortet.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  approxPolygonAreaM2,
  isAxisAlignedBoxPolygon,
  parsePolygonJson,
  pointInPolygon,
} from '../geo/polygon';
import type { GeoLatLng } from '../../types/poiGeo';

export type OsmFootprintRing = Array<[number, number]>;

type OverpassGeomEl = {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat?: number; lon?: number }>;
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

const CACHE_KEY = '@findus/osm_footprints_v8';
const FETCH_MS = 18_000;
const AROUND_M = 180;
const PARK_AROUND_M = 240;
const LOOSE_MATCH_M = 120;

type CacheBag = Record<string, OsmFootprintRing>;

let memCache: CacheBag | null = null;

function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * 111_320;
  const dLng =
    (lng2 - lng1) * 111_320 * Math.cos(((lat1 + lat2) * 0.5) * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}

function ringFromGeom(el: OverpassGeomEl): GeoLatLng[] | null {
  const geom = el.geometry;
  if (!Array.isArray(geom) || geom.length < 2) return null;
  const ring: GeoLatLng[] = [];
  for (const p of geom) {
    if (
      typeof p?.lat !== 'number' ||
      typeof p?.lon !== 'number' ||
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon)
    ) {
      continue;
    }
    ring.push({ latitude: p.lat, longitude: p.lon });
  }
  if (ring.length < 2) return null;
  return ring;
}

function isClosedRing(ring: GeoLatLng[]): boolean {
  if (ring.length < 4) return false;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  return (
    Math.abs(a.latitude - b.latitude) < 1e-6 &&
    Math.abs(a.longitude - b.longitude) < 1e-6
  );
}

function ensureClosed(ring: GeoLatLng[]): GeoLatLng[] {
  if (isClosedRing(ring)) return ring;
  if (ring.length < 3) return ring;
  return [...ring, { ...ring[0]! }];
}

function centroid(ring: GeoLatLng[]): { lat: number; lng: number } {
  const n = ring.length;
  return {
    lat: ring.reduce((s, p) => s + p.latitude, 0) / n,
    lng: ring.reduce((s, p) => s + p.longitude, 0) / n,
  };
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9äöü]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameOverlap(poiName: string, tags?: Record<string, string>): number {
  const n = normName(poiName.replace(/\s*(wegweiser|approach)\s*$/i, ''));
  if (n.length < 3) return 0;
  const hay = normName(
    `${tags?.name ?? ''} ${tags?.['name:de'] ?? ''} ${tags?.ref ?? ''}`,
  );
  if (!hay) return 0;
  if (hay.includes(n) || n.includes(hay)) return 70;
  const tokens = n.split(' ').filter((t) => t.length >= 4);
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hits += 1;
  }
  return hits ? Math.min(48, hits * 16) : 0;
}

function wantsPlatform(poiName: string): boolean {
  return /(haltepunkt|bahnsteig|bahnhof|haltestelle|station)\b/i.test(poiName);
}

function wantsShelter(poiName: string): boolean {
  return /(wartehäuschen|wartehaeuschen|shelter|unterstand)\b/i.test(poiName);
}

/** Brücke / Unterführung: nie auf Kita, Feuerwehr oder Haus daneben ziehen. */
export function isMapCrossingPoi(poiName: string): boolean {
  return /(brücke|bruecke|bridge|unterführung|unterfuehrung|viadukt|eisenbahnüberführung)/i.test(
    poiName,
  );
}

function wantsLargeFootprint(poiName: string, tags?: Record<string, string>): boolean {
  const blob = `${poiName} ${tags?.leisure ?? ''} ${tags?.landuse ?? ''} ${tags?.railway ?? ''}`.toLowerCase();
  return /(park|garten|hafen|bahnhof|haltepunkt|bahnsteig|station|gleis|friedhof|strand|anlage|wald|see)/i.test(
    blob,
  );
}

function tagScore(tags: Record<string, string> | undefined): number {
  const t = tags ?? {};
  if (t.railway === 'platform' || t.public_transport === 'platform') return 48;
  if (t.building === 'train_station' || t.railway === 'station' || t.railway === 'halt')
    return 36;
  if (t.amenity === 'shelter' || t.building === 'shelter') return 34;
  if (
    t.amenity === 'doctors' ||
    t.amenity === 'clinic' ||
    t.amenity === 'dentist' ||
    t.healthcare
  ) {
    return 42;
  }
  if (t.amenity === 'kindergarten' || t.amenity === 'school' || t.amenity === 'fire_station') {
    return 44;
  }
  if (t.building) return 40;
  if (t.leisure === 'park' || t.leisure === 'garden') return 38;
  if (t.leisure) return 26;
  if (t.historic) return 28;
  if (t.tourism) return 24;
  if (t.railway === 'abandoned' || t['abandoned:railway'] || t.railway === 'disused')
    return 30;
  if (t.railway || t.landuse === 'railway') return 28;
  if (t.amenity) return 18;
  if (t.landuse) return 12;
  if (t.man_made) return 16;
  return 8;
}

/** Nächster OSM-Ring zum Pin — innen liegend schlägt Distanz. */
export function pickBestFootprint(
  lat: number,
  lng: number,
  rings: Array<{ ring: GeoLatLng[]; tags?: Record<string, string> }>,
  poiName = '',
): GeoLatLng[] | null {
  let best: GeoLatLng[] | null = null;
  let bestScore = -Infinity;
  const wantLarge = wantsLargeFootprint(poiName);
  const wantPlat = wantsPlatform(poiName);
  const wantHut = wantsShelter(poiName);
  const wantCrossing = isMapCrossingPoi(poiName);
  for (const item of rings) {
    const ring = item.ring;
    if (!ring || ring.length < 2) continue;
    const closed = isClosedRing(ring) || ring.length >= 4;
    const poly = closed ? ensureClosed(ring) : ring;
    const c = centroid(poly);
    const dist = haversineM(lat, lng, c.lat, c.lng);
    const inside = poly.length >= 4 && pointInPolygon(lat, lng, poly);
    if (!inside && dist > LOOSE_MATCH_M) continue;
    const area = poly.length >= 4 ? approxPolygonAreaM2(poly) : 40;
    const names = nameOverlap(poiName, item.tags);
    const t = item.tags ?? {};
    if (wantCrossing) {
      if (
        t.amenity === 'kindergarten' ||
        t.amenity === 'school' ||
        t.amenity === 'fire_station'
      ) {
        continue;
      }
      if (t.building && t.railway !== 'station' && !t.tunnel) continue;
    }
    const isPlat =
      t.railway === 'platform' || t.public_transport === 'platform';
    const isHut =
      t.amenity === 'shelter' ||
      t.building === 'shelter' ||
      t.historic === 'yes' ||
      /wartehäuschen|wartehaeuschen/i.test(t.name ?? '');
    let score =
      tagScore(item.tags) +
      names +
      (inside ? 90 : 0) -
      Math.min(dist, 240) * 0.28;
    if (wantPlat && isPlat) score += 90;
    if (wantHut && isHut) score += 90;
    if (wantHut && isPlat) score -= 40;
    if (wantPlat && isHut && !isPlat) score -= 30;
    if (wantCrossing && (t.railway || t.tunnel === 'yes')) score += 80;
    // Nächstes Gebäude in 45 m — auch ohne Namens-Match (Praxis, Kita, …)
    if (!wantCrossing && t.building && dist <= 45) score += 55;
    if (!wantCrossing && inside && t.building) score += 40;
    if (inside) {
      if (wantLarge) score += Math.min(area, 80_000) * 0.00004;
      else score -= Math.min(area, 40_000) * 0.00008;
    }
    if (score > bestScore) {
      bestScore = score;
      best = poly;
    }
  }
  return best;
}

async function loadCache(): Promise<CacheBag> {
  if (memCache) return memCache;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    memCache = raw ? (JSON.parse(raw) as CacheBag) : {};
  } catch {
    memCache = {};
  }
  return memCache;
}

async function saveCache(bag: CacheBag): Promise<void> {
  memCache = bag;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(bag));
  } catch {
    /* quota — ignore */
  }
}

export function footprintFromPack(poi: {
  id?: number;
  polygon_json?: string | null;
}): OsmFootprintRing | null {
  const ring = parsePolygonJson(poi.polygon_json);
  if (!ring || ring.length < 4) return null;
  return ring.map((p) => [p.latitude, p.longitude]);
}

export function packNeedsOsmFootprint(poi: {
  id?: number;
  name?: string;
  polygon_json?: string | null;
  tags_json?: string | null;
}): boolean {
  if (poi.name && isMapCrossingPoi(poi.name)) return false;
  const ring = parsePolygonJson(poi.polygon_json);
  const needsShape = !ring || isAxisAlignedBoxPolygon(ring);
  // Manuelle GPS-Fixes mit echtem Gebäudeumriss nicht überschreiben.
  // Fehlender/Box-Umriss: trotzdem Overpass (sonst bleibt nur der rote Punkt).
  if (!needsShape) {
    const tags = String(poi.tags_json || '').toLowerCase();
    if (
      tags.includes('gps_manual_fix') ||
      tags.includes('gps_entrance') ||
      tags.includes('nav_target')
    ) {
      return false;
    }
    return false;
  }
  return true;
}

async function postOverpass(
  query: string,
  signal: AbortSignal,
): Promise<OverpassGeomEl[]> {
  let lastErr: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const data = (await res.json()) as { elements?: OverpassGeomEl[] };
      return data.elements ?? [];
    } catch (err) {
      lastErr = err;
      if (signal.aborted) break;
    }
  }
  if (__DEV__ && lastErr) {
    console.warn('[osmFootprint] overpass failed', lastErr);
  }
  return [];
}

function aroundBlock(lat: number, lng: number, radiusM: number): string {
  const around = `(around:${radiusM},${lat},${lng})`;
  const near = `(around:${Math.min(55, radiusM)},${lat},${lng})`;
  return [
    // Gebäude zuerst / eng — für Praxis, Kita, Laden auf klarem Haus
    `way${near}["building"];`,
    `relation${near}["building"];`,
    `way${around}["building"];`,
    `way${around}["leisure"];`,
    `way${around}["tourism"];`,
    `way${around}["historic"];`,
    `way${around}["amenity"];`,
    `way${around}["railway"];`,
    `way${around}["public_transport"];`,
    `way${around}["landuse"~"^(railway|recreation_ground|forest|grass|cemetery)$"];`,
    `way${around}["man_made"~"^(shelter|pier|tower)$"];`,
    `way${around}["abandoned:railway"];`,
    `way(around:${PARK_AROUND_M},${lat},${lng})["leisure"~"^(park|garden)$"];`,
  ].join('');
}

function buildAroundQuery(
  pois: Array<{ lat: number; lng: number }>,
): string {
  const parts: string[] = [];
  for (const p of pois) {
    parts.push(aroundBlock(p.lat, p.lng, AROUND_M));
  }
  return `[out:json][timeout:22];(${parts.join('')});out geom;`;
}

const CHUNK = 12;

/**
 * OSM-Umrisse für POIs, deren Pack-Polygon fehlt oder nur eine GPS-Box ist.
 * Treffer werden lokal gecacht (offline beim nächsten Öffnen).
 */
export async function fetchOsmFootprintsForPois(
  pois: Array<{
    id: number;
    name?: string;
    lat: number;
    lng: number;
    polygon_json?: string | null;
    tags_json?: string | null;
  }>,
): Promise<Map<number, OsmFootprintRing>> {
  const out = new Map<number, OsmFootprintRing>();
  const cache = await loadCache();
  const need: typeof pois = [];

  for (const poi of pois) {
    if (!packNeedsOsmFootprint(poi)) {
      const pack = footprintFromPack(poi);
      if (pack) {
        out.set(poi.id, pack);
        continue;
      }
    }
    const cached = cache[String(poi.id)];
    if (cached && cached.length >= 2) {
      out.set(poi.id, cached);
      continue;
    }
    need.push(poi);
  }

  if (!need.length) return out;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    for (let i = 0; i < need.length; i += CHUNK) {
      if (ctrl.signal.aborted) break;
      const slice = need.slice(i, i + CHUNK);
      const elements = await postOverpass(buildAroundQuery(slice), ctrl.signal);
      const rings: Array<{ ring: GeoLatLng[]; tags?: Record<string, string> }> =
        [];
      for (const el of elements) {
        if (el.type !== 'way' && el.type !== 'relation') continue;
        const ring = ringFromGeom(el);
        if (!ring) continue;
        rings.push({ ring, tags: el.tags });
      }
      for (const poi of slice) {
        const best = pickBestFootprint(
          poi.lat,
          poi.lng,
          rings,
          poi.name ?? '',
        );
        if (!best) continue;
        const pairs: OsmFootprintRing = best.map((p) => [
          p.latitude,
          p.longitude,
        ]);
        out.set(poi.id, pairs);
        cache[String(poi.id)] = pairs;
      }
    }
    await saveCache(cache);
  } finally {
    clearTimeout(timer);
  }

  return out;
}
