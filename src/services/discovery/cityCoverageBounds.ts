/**
 * Stadt-Fläche für Stempelkarte: BBox (+ optional Polygon) pro cityId.
 * Coverage-% = erkundet innerhalb dieser Stadt — nicht der gesamten Reise.
 */

import * as FileSystem from 'expo-file-system';
import { getCachedUserProfile } from '../userProfileService';
import { dedupeRing } from '../geo/smoothCityBoundary';
import { nominatimLocaleForCity, isBerlinCityPackId } from './nominatimCityLocale';
import { approxPolygonAreaM2, pointInPolygon } from '../geo/polygon';

export type CityCoverageBounds = {
  cityId: string;
  name: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  /** Optional grobes Polygon [lat,lng][] für Karten-Overlay */
  polygon?: Array<[number, number]>;
  source: 'builtin' | 'nominatim' | 'pack_estimate' | 'pack';
  /** Boundary-Revision — ältere Caches werden neu von OSM geholt */
  smoothRev?: number;
};

const PATH = `${FileSystem.documentDirectory}findus-city-coverage-bounds.json`;
const BOUNDARY_SMOOTH_REV = 5;
/** Unter dieser Punktzahl = grobe Pack-Schätzung → Nominatim/OSM nachziehen. */
const MIN_BOUNDARY_DETAIL_POINTS = 80;

/** OSM-Ring säubern ohne Form zu verändern (kein Chaikin). */
function dedupeBoundaryRing(
  ring: Array<[number, number]>,
  maxPoints = 4000,
): Array<[number, number]> {
  let cur = dedupeRing(ring, 5e-7);
  if (cur.length > maxPoints) {
    // Gleichmäßig ausdünnen — nur wenn extrem groß (Performance).
    const slim: Array<[number, number]> = [];
    const lastIdx = cur.length - 1;
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.round((i * lastIdx) / (maxPoints - 1));
      const p = cur[idx]!;
      const prev = slim[slim.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) slim.push(p);
    }
    cur = slim;
  }
  return cur;
}

/** Bekannte Städte — manuell kalibriert. */
const BUILTIN: Record<string, Omit<CityCoverageBounds, 'cityId' | 'source'>> = {
  wangerooge: {
    name: 'Wangerooge',
    latMin: 53.772,
    latMax: 53.805,
    lngMin: 7.84,
    lngMax: 7.935,
  },
  prisdorf: {
    name: 'Prisdorf',
    // OSM-Admin-BBox — eng, sonst frisst Prisdorf Pinneberg/Tornesch-Mitte
    latMin: 53.6628,
    latMax: 53.6969,
    lngMin: 9.745,
    lngMax: 9.7797,
  },
  pinneberg: {
    name: 'Pinneberg',
    latMin: 53.6086,
    latMax: 53.6839,
    lngMin: 9.7636,
    lngMax: 9.8286,
  },
  tornesch: {
    name: 'Tornesch',
    latMin: 53.6728,
    latMax: 53.7246,
    lngMin: 9.6952,
    lngMax: 9.7815,
  },
  appen: {
    name: 'Appen',
    latMin: 53.645,
    latMax: 53.675,
    lngMin: 9.72,
    lngMax: 9.77,
  },
  uetersen: {
    name: 'Uetersen',
    latMin: 53.67,
    latMax: 53.71,
    lngMin: 9.64,
    lngMax: 9.70,
  },
  rellingen: {
    name: 'Rellingen',
    latMin: 53.64,
    latMax: 53.67,
    lngMin: 9.80,
    lngMax: 9.86,
  },
  laboe: {
    name: 'Laboe',
    latMin: 54.385,
    latMax: 54.42,
    lngMin: 10.20,
    lngMax: 10.25,
  },
  hamburg: {
    name: 'Hamburg',
    latMin: 53.38,
    latMax: 53.75,
    lngMin: 9.70,
    lngMax: 10.35,
  },
  luebeck: {
    name: 'Lübeck',
    latMin: 53.80,
    latMax: 53.95,
    lngMin: 10.55,
    lngMax: 10.90,
  },
  /** Timmendorfer Strand (Ostsee) — falls Profil/Spuren dort */
  timmendorfer_strand: {
    name: 'Timmendorfer Strand',
    latMin: 53.98,
    latMax: 54.02,
    lngMin: 10.74,
    lngMax: 10.82,
  },
  london: {
    name: 'London',
    latMin: 51.38,
    latMax: 51.58,
    lngMin: -0.36,
    lngMax: 0.05,
  },
};

let cache: Record<string, CityCoverageBounds> = {};
let hydrated = false;

/** Nominatim: max. 1 Request/s, gleiche cityId nicht parallel. */
const NOMINATIM_GAP_MS = 1100;
let nominatimGate: Promise<void> = Promise.resolve();
const inflightNominatim = new Map<string, Promise<CityCoverageBounds | null>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withNominatimGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimGate.then(fn, fn);
  nominatimGate = run.then(
    () => sleep(NOMINATIM_GAP_MS),
    () => sleep(NOMINATIM_GAP_MS),
  ).then(() => undefined);
  return run;
}

/** BBox-Rechteck (4 Ecken) — keine echte Gemeindegrenze. */
export function isAxisAlignedBboxRing(
  poly: Array<[number, number]> | null | undefined,
): boolean {
  if (!poly || poly.length < 4) return false;
  const pts: Array<[number, number]> = [];
  for (const [lat, lng] of poly) {
    const prev = pts[pts.length - 1];
    if (!prev || prev[0] !== lat || prev[1] !== lng) pts.push([lat, lng]);
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (
    pts.length >= 2 &&
    first &&
    last &&
    first[0] === last[0] &&
    first[1] === last[1]
  ) {
    pts.pop();
  }
  if (pts.length !== 4) return false;
  const latSet = new Set(pts.map((p) => Math.round(p[0] * 1e5) / 1e5));
  const lngSet = new Set(pts.map((p) => Math.round(p[1] * 1e5) / 1e5));
  return latSet.size === 2 && lngSet.size === 2;
}

/** Echte Verwaltungsgrenze (OSM), kein Schätz-Rechteck. */
export function hasRealCityBoundaryPolygon(
  poly: Array<[number, number]> | null | undefined,
): boolean {
  if (!poly || poly.length < 6) return false;
  if (isAxisAlignedBboxRing(poly)) return false;
  const uniq = new Set(poly.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`));
  return uniq.size >= 5;
}

/** Genug Detail für Rubbelkarte (Google/OSM-ähnliche Gemeindegrenze). */
export function hasDetailedCityBoundaryPolygon(
  poly: Array<[number, number]> | null | undefined,
): boolean {
  return (
    hasRealCityBoundaryPolygon(poly) &&
    (poly?.length ?? 0) >= MIN_BOUNDARY_DETAIL_POINTS
  );
}

export function needsCityBoundaryFetch(
  bounds: CityCoverageBounds | null | undefined,
): boolean {
  if (!bounds) return true;
  if (!hasRealCityBoundaryPolygon(bounds.polygon)) return true;
  if (!hasDetailedCityBoundaryPolygon(bounds.polygon)) return true;
  if ((bounds.smoothRev ?? 0) < BOUNDARY_SMOOTH_REV) return true;
  if (isBerlinCityPackId(bounds.cityId)) {
    const dLat = bounds.latMax - bounds.latMin;
    const dLng = bounds.lngMax - bounds.lngMin;
    // Land Berlin ist ~0.34° × 0.67° — Mini-Treffer von „Berlin Zentral“ neu holen.
    if (dLat < 0.22 || dLng < 0.35) return true;
  }
  return false;
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as {
      byId?: Record<string, CityCoverageBounds>;
    };
    // Merge: In-Memory (z. B. frisch aus Pack) schlägt Disk — sonst Race
    // registerCoverageBoundsFromPack → hydrate überschreibt neue Städte.
    if (parsed.byId) cache = { ...parsed.byId, ...cache };
  } catch {
    /* keep in-memory cache */
  }
}

function persist(): void {
  void FileSystem.writeAsStringAsync(
    PATH,
    JSON.stringify({ byId: cache, savedAt: Date.now() }),
  ).catch(() => {});
}

export async function hydrateCityCoverageBounds(): Promise<void> {
  await hydrate();
}

export function pointInCityBounds(
  lat: number,
  lng: number,
  b: CityCoverageBounds,
): boolean {
  return (
    lat >= b.latMin &&
    lat <= b.latMax &&
    lng >= b.lngMin &&
    lng <= b.lngMax
  );
}

function coverageRingToGeo(poly: Array<[number, number]>) {
  return poly.map(([latitude, longitude]) => ({ latitude, longitude }));
}

/** Verwaltungsgrenze wenn da, sonst BBox. */
export function cityContainsPoint(
  lat: number,
  lng: number,
  b: CityCoverageBounds,
): boolean {
  if (hasRealCityBoundaryPolygon(b.polygon) && b.polygon) {
    return pointInPolygon(lat, lng, coverageRingToGeo(b.polygon));
  }
  return pointInCityBounds(lat, lng, b);
}

function cityCoverageArea(b: CityCoverageBounds): number {
  if (hasRealCityBoundaryPolygon(b.polygon) && b.polygon) {
    return approxPolygonAreaM2(coverageRingToGeo(b.polygon));
  }
  return Math.max(1e-12, (b.latMax - b.latMin) * (b.lngMax - b.lngMin));
}

/**
 * Ein Punkt → eine Stadt. Hamburg-BBox darf Prisdorf/Pinneberg/Tornesch
 * nicht mit einfärben.
 */
export function smallestCityIdContainingPoint(
  lat: number,
  lng: number,
  cities: CityCoverageBounds[],
): string | null {
  const hits = cities.filter((b) => cityContainsPoint(lat, lng, b));
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const d = cityCoverageArea(a) - cityCoverageArea(b);
    if (d !== 0) return d;
    return a.cityId.localeCompare(b.cityId);
  });
  return hits[0]?.cityId ?? null;
}

export function getBuiltinCityBounds(cityId: string): CityCoverageBounds | null {
  const id = cityId.trim().toLowerCase();
  const b = BUILTIN[id];
  if (!b) return null;
  return { ...b, cityId: id, source: 'builtin' };
}

/** Alle bekannten Coverage-Bounds (Cache + Builtin) für Region-LOD. */
export function listKnownCityCoverageBounds(): CityCoverageBounds[] {
  void hydrate();
  const byId = new Map<string, CityCoverageBounds>();
  for (const id of Object.keys(BUILTIN)) {
    const b = getBuiltinCityBounds(id);
    if (b) byId.set(id, b);
  }
  for (const [id, b] of Object.entries(cache)) {
    byId.set(id, b);
  }
  return [...byId.values()];
}

/**
 * Sync: Disk-Cache (inkl. Pack) → Builtin → null.
 */
export function resolveCityCoverageBoundsSync(
  cityId?: string | null,
): CityCoverageBounds | null {
  void hydrate();
  const id = (cityId ?? getCachedUserProfile()?.cityId ?? '')
    .trim()
    .toLowerCase();
  if (!id) return null;
  if (cache[id]) return cache[id]!;
  const builtin = getBuiltinCityBounds(id);
  if (builtin) return builtin;
  return null;
}

/**
 * Aus Stadt-Pack `_coverage` beim Install registrieren.
 * Pack schlägt Builtin, wird von Nominatim-Polygon ggf. später verfeinert.
 */
export function registerCoverageBoundsFromPack(opts: {
  cityId: string;
  name?: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  polygon?: Array<[number, number]>;
}): CityCoverageBounds | null {
  const id = opts.cityId.trim().toLowerCase();
  if (!id) return null;
  if (
    ![opts.latMin, opts.latMax, opts.lngMin, opts.lngMax].every(Number.isFinite)
  ) {
    return null;
  }
  if (opts.latMin >= opts.latMax || opts.lngMin >= opts.lngMax) return null;

  void hydrate();
  const poly = hasRealCityBoundaryPolygon(opts.polygon)
    ? opts.polygon
    : undefined;
  const bounds: CityCoverageBounds = {
    cityId: id,
    name: opts.name ?? id,
    latMin: opts.latMin,
    latMax: opts.latMax,
    lngMin: opts.lngMin,
    lngMax: opts.lngMax,
    polygon: poly,
    source: 'pack',
    // Nur detaillierte Pack-Grenze gilt als fertig — sonst Nominatim nachziehen.
    ...(hasDetailedCityBoundaryPolygon(poly)
      ? { smoothRev: BOUNDARY_SMOOTH_REV }
      : { smoothRev: 0 }),
  };
  const existing = cache[id];
  // Reichere/längere Grenze behalten (nie 11-Punkt-Pack über OSM-Relation legen).
  if (
    hasDetailedCityBoundaryPolygon(existing?.polygon) &&
    (!hasDetailedCityBoundaryPolygon(bounds.polygon) ||
      (existing!.polygon!.length >= (bounds.polygon?.length ?? 0)))
  ) {
    return existing!;
  }
  if (
    existing?.source === 'nominatim' &&
    hasRealCityBoundaryPolygon(existing.polygon) &&
    !hasRealCityBoundaryPolygon(bounds.polygon)
  ) {
    return existing;
  }
  cache[id] = bounds;
  persist();
  return bounds;
}

/** Pack-Zentrum → grobe Schätz-BBox (~3 km Radius). */
export function estimateBoundsFromCenter(opts: {
  cityId: string;
  name?: string;
  lat: number;
  lng: number;
  /** Halbe Kantenlänge in Grad (~0.027 ≈ 3 km) */
  halfSpanDeg?: number;
}): CityCoverageBounds {
  const half = opts.halfSpanDeg ?? 0.028;
  const cos = Math.max(0.2, Math.cos((opts.lat * Math.PI) / 180));
  return {
    cityId: opts.cityId.toLowerCase(),
    name: opts.name ?? opts.cityId,
    latMin: opts.lat - half,
    latMax: opts.lat + half,
    lngMin: opts.lng - half / cos,
    lngMax: opts.lng + half / cos,
    source: 'pack_estimate',
  };
}

export {
  ringForCityOverview,
  viewBoxFromCoverageBounds,
} from './cityCoverageFit';

type NominatimHit = {
  boundingbox?: [string, string, string, string];
  geojson?: {
    type?: string;
    coordinates?: unknown;
  };
  display_name?: string;
  class?: string;
  type?: string;
  osm_type?: string;
};

function ringToLatLng(ring: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(ring) || ring.length < 6) return undefined;
  const out: Array<[number, number]> = [];
  for (const c of ring) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([lat, lng]);
  }
  return out.length >= 6 ? out : undefined;
}

function extractAdminPolygon(
  gj: NominatimHit['geojson'],
): Array<[number, number]> | undefined {
  if (!gj?.type || !Array.isArray(gj.coordinates)) return undefined;
  if (gj.type === 'Polygon') {
    return ringToLatLng((gj.coordinates as unknown[])[0]);
  }
  if (gj.type === 'MultiPolygon') {
    const polys = gj.coordinates as unknown[][];
    let best: Array<[number, number]> | undefined;
    for (const poly of polys) {
      const ring = ringToLatLng(Array.isArray(poly) ? poly[0] : null);
      if (!ring) continue;
      if (!best || ring.length > best.length) best = ring;
    }
    return best;
  }
  return undefined;
}

function scoreNominatimHit(hit: NominatimHit): number {
  let score = 0;
  const osm = (hit.osm_type ?? '').toLowerCase();
  if (osm === 'r' || osm === 'relation') score += 50;
  if (hit.class === 'boundary') score += 40;
  if (hit.type === 'administrative' || hit.type === 'political') score += 30;
  const poly = extractAdminPolygon(hit.geojson);
  if (poly && hasRealCityBoundaryPolygon(poly)) {
    score += 20 + Math.min(40, Math.floor(poly.length / 15));
  }
  return score;
}

function pickNominatimHit(hits: NominatimHit[]): NominatimHit | null {
  let best: NominatimHit | null = null;
  let bestScore = -1;
  for (const hit of hits) {
    const poly = extractAdminPolygon(hit.geojson);
    if (!hasRealCityBoundaryPolygon(poly)) continue;
    const score = scoreNominatimHit(hit);
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return best;
}

async function fetchNominatimAdminBounds(opts: {
  cityId: string;
  displayName: string;
  countryCode?: string;
}): Promise<CityCoverageBounds | null> {
  const builtin = getBuiltinCityBounds(opts.cityId);
  const countrycodes = (opts.countryCode || 'de').toLowerCase().slice(0, 2);
  try {
    const q = encodeURIComponent(opts.displayName);
    const url =
      `https://nominatim.openstreetmap.org/search?q=${q}` +
      // threshold=0 → volle OSM-Admin-Relation (wie Google/OSM-Grenze), kein „ungefähr“.
      `&format=json&limit=5&polygon_geojson=1&polygon_threshold=0` +
      `&addressdetails=0&countrycodes=${countrycodes}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FindusTravelCompanion/1.0 (stempelkarte coverage)',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return builtin;
    const arr = (await res.json()) as NominatimHit[];
    const hit = pickNominatimHit(Array.isArray(arr) ? arr : []);
    if (!hit?.boundingbox || hit.boundingbox.length < 4) {
      const fallback = builtin ?? cache[opts.cityId] ?? null;
      if (fallback) {
        cache[opts.cityId] = {
          ...fallback,
          source: 'nominatim',
          polygon: hasRealCityBoundaryPolygon(fallback.polygon)
            ? fallback.polygon
            : undefined,
        };
        persist();
        return cache[opts.cityId]!;
      }
      return null;
    }

    const latMin = Number(hit.boundingbox[0]);
    const latMax = Number(hit.boundingbox[1]);
    const lngMin = Number(hit.boundingbox[2]);
    const lngMax = Number(hit.boundingbox[3]);
    if (![latMin, latMax, lngMin, lngMax].every(Number.isFinite)) {
      return builtin;
    }

    const rawPoly = extractAdminPolygon(hit.geojson);
    // Kein Chaikin — OSM-Admin-Kante exakt behalten (nur Doppelpunkte weg).
    const cleaned = hasRealCityBoundaryPolygon(rawPoly)
      ? dedupeBoundaryRing(rawPoly as Array<[number, number]>, 4000)
      : null;
    const polygon = hasRealCityBoundaryPolygon(cleaned)
      ? cleaned
      : undefined;
    const bounds: CityCoverageBounds = {
      cityId: opts.cityId,
      name: opts.displayName,
      latMin,
      latMax,
      lngMin,
      lngMax,
      polygon,
      source: 'nominatim',
      smoothRev: BOUNDARY_SMOOTH_REV,
    };
    cache[opts.cityId] = bounds;
    persist();
    return bounds;
  } catch {
    return builtin;
  }
}

/**
 * Nominatim: Verwaltungsgrenze als BBox (+ echtes OSM-Polygon).
 * Kein BBox-Rechteck als Fake-Grenze. Einmalig cachen — kein Dauer-Polling.
 */
export async function fetchAndCacheCityBoundsFromNominatim(opts: {
  cityId: string;
  displayName: string;
  countryCode?: string;
}): Promise<CityCoverageBounds | null> {
  await hydrate();
  const id = opts.cityId.trim().toLowerCase();
  const cached = cache[id];
  if (cached && !needsCityBoundaryFetch(cached)) return cached;

  const existing = inflightNominatim.get(id);
  if (existing) return existing;

  const job = withNominatimGate(() =>
    fetchNominatimAdminBounds({
      cityId: id,
      displayName: opts.displayName,
      countryCode: opts.countryCode,
    }),
  );
  inflightNominatim.set(id, job);
  try {
    return await job;
  } finally {
    inflightNominatim.delete(id);
  }
}

/** App-Start / Passport-Open: Bounds für aktive Stadt sicherstellen. */
export async function ensureActiveCityCoverageBounds(): Promise<CityCoverageBounds | null> {
  await hydrate();
  const profile = getCachedUserProfile();
  const cityId = (profile?.cityId ?? '').trim().toLowerCase();
  if (!cityId) return null;
  const existing = resolveCityCoverageBoundsSync(cityId);
  if (hasRealCityBoundaryPolygon(existing?.polygon)) {
    return existing;
  }
  const locale = nominatimLocaleForKnownCity(
    cityId,
    profile?.cityName || existing?.name,
    existing,
  );
  if (existing) {
    void fetchAndCacheCityBoundsFromNominatim({
      cityId,
      displayName: locale.displayName,
      countryCode: locale.countryCode,
    });
    return existing;
  }
  const fetched = await fetchAndCacheCityBoundsFromNominatim({
    cityId,
    displayName: locale.displayName,
    countryCode: locale.countryCode,
  });
  if (fetched) return fetched;
  return null;
}

function cityCenter(b: CityCoverageBounds): { lat: number; lng: number } {
  return {
    lat: (b.latMin + b.latMax) / 2,
    lng: (b.lngMin + b.lngMax) / 2,
  };
}

function nominatimLocaleForKnownCity(
  cityId: string,
  name?: string | null,
  bounds?: CityCoverageBounds | null,
): ReturnType<typeof nominatimLocaleForCity> {
  const c = bounds ? cityCenter(bounds) : null;
  return nominatimLocaleForCity({
    cityId,
    name: name || bounds?.name || cityId,
    lat: c?.lat,
    lng: c?.lng,
  });
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (b.lat - a.lat) * 111.32;
  const dLng =
    (b.lng - a.lng) * 111.32 * Math.cos(((a.lat + b.lat) * 0.5 * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Umland-/Regions-Packs — keine eigene Gemeindegrenze auf der Rubbelkarte. */
export function isRegionPackCityId(cityId: string): boolean {
  const id = cityId.trim().toLowerCase();
  return id.includes('umland') || id.endsWith('-region');
}

export type HomeMapCatalogCity = {
  id: string;
  name?: string;
  lat?: number | null;
  lng?: number | null;
  latMin?: number | null;
  latMax?: number | null;
  lngMin?: number | null;
  lngMax?: number | null;
  /** OSM-Gemeindegrenze aus Index/Pack — ohne Nominatim-Warten */
  polygon?: Array<[number, number]> | null;
};

/** Katalog-Anker anlegen, damit Nominatim die Pack-Städte finden kann. */
export function seedCatalogCityAnchors(
  cities: readonly HomeMapCatalogCity[],
): void {
  void hydrate();
  for (const city of cities) {
    const id = city.id.trim().toLowerCase();
    if (!id || isRegionPackCityId(id)) continue;
    if (hasDetailedCityBoundaryPolygon(cache[id]?.polygon)) continue;

    const poly = hasRealCityBoundaryPolygon(city.polygon ?? undefined)
      ? (city.polygon as Array<[number, number]>)
      : undefined;
    const hasBbox = [city.latMin, city.latMax, city.lngMin, city.lngMax].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    );
    if (poly && hasBbox) {
      // Dünne Pack-Polygone speichern, aber smoothRev=0 → OSM-Detail nachziehen.
      cache[id] = {
        cityId: id,
        name: city.name || id,
        latMin: city.latMin as number,
        latMax: city.latMax as number,
        lngMin: city.lngMin as number,
        lngMax: city.lngMax as number,
        polygon: poly,
        source: 'pack',
        smoothRev: hasDetailedCityBoundaryPolygon(poly)
          ? BOUNDARY_SMOOTH_REV
          : 0,
      };
      continue;
    }

    if (cache[id] || getBuiltinCityBounds(id)) continue;
    if (
      typeof city.lat !== 'number' ||
      typeof city.lng !== 'number' ||
      !Number.isFinite(city.lat) ||
      !Number.isFinite(city.lng)
    ) {
      continue;
    }
    cache[id] = estimateBoundsFromCenter({
      cityId: id,
      name: city.name || id,
      lat: city.lat,
      lng: city.lng,
    });
  }
}

/**
 * Homescreen: OSM-Gemeindegrenzen für alle Pack-Städte laden (Rubbelkarte).
 * Keine BBox-Quadrate, keine Nachbargemeinden ohne Datensatz.
 */
export async function ensureHomeMapCityBoundaries(opts: {
  activeCityId?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Max. Nominatim-Requests in diesem Lauf */
  maxFetch?: number;
  /** Nur noch Sortierung: nähere Pack-Städte zuerst */
  radiusKm?: number;
  catalogCities?: readonly HomeMapCatalogCity[];
  onProgress?: () => void;
}): Promise<CityCoverageBounds[]> {
  await hydrate();
  const activeId = (opts.activeCityId ?? '').trim().toLowerCase();
  const maxFetch = opts.maxFetch ?? 16;
  if (opts.catalogCities?.length) seedCatalogCityAnchors(opts.catalogCities);

  const catalogIds = new Set(
    (opts.catalogCities ?? [])
      .map((c) => c.id.trim().toLowerCase())
      .filter((id) => id && !isRegionPackCityId(id)),
  );
  if (activeId && !isRegionPackCityId(activeId)) catalogIds.add(activeId);

  const anchor = (() => {
    if (
      typeof opts.lat === 'number' &&
      typeof opts.lng === 'number' &&
      Number.isFinite(opts.lat) &&
      Number.isFinite(opts.lng)
    ) {
      return { lat: opts.lat, lng: opts.lng };
    }
    const active = resolveCityCoverageBoundsSync(activeId);
    if (active) return cityCenter(active);
    try {
      const { peekLastMapGps } = require('../location/lastKnownMapGps') as {
        peekLastMapGps: () => { lat: number; lng: number } | null;
      };
      const last = peekLastMapGps();
      if (last && Number.isFinite(last.lat) && Number.isFinite(last.lng)) {
        return { lat: last.lat, lng: last.lng };
      }
    } catch {
      /* soft */
    }
    return { lat: 0, lng: 0 };
  })();

  if (activeId && !isRegionPackCityId(activeId)) {
    const cur = resolveCityCoverageBoundsSync(activeId);
    if (needsCityBoundaryFetch(cur)) {
      const locale = nominatimLocaleForKnownCity(
        activeId,
        cur?.name || activeId,
        cur,
      );
      await fetchAndCacheCityBoundsFromNominatim({
        cityId: activeId,
        displayName: locale.displayName,
        countryCode: locale.countryCode,
      });
      opts.onProgress?.();
    }
  }

  const ranked = listKnownCityCoverageBounds()
    .filter((b) => catalogIds.has(b.cityId))
    .filter((b) => !isRegionPackCityId(b.cityId))
    .map((b) => ({
      b,
      dist: haversineKm(anchor, cityCenter(b)),
    }))
    .sort((a, b) => {
      if (a.b.cityId === activeId) return -1;
      if (b.b.cityId === activeId) return 1;
      const aBer = isBerlinCityPackId(a.b.cityId) ? 0 : 1;
      const bBer = isBerlinCityPackId(b.b.cityId) ? 0 : 1;
      if (aBer !== bBer) return aBer - bBer;
      return a.dist - b.dist;
    });

  let fetched = 0;
  for (const { b } of ranked) {
    if (fetched >= maxFetch) break;
    if (!needsCityBoundaryFetch(b)) continue;
    const locale = nominatimLocaleForKnownCity(b.cityId, b.name, b);
    await fetchAndCacheCityBoundsFromNominatim({
      cityId: b.cityId,
      displayName: locale.displayName,
      countryCode: locale.countryCode,
    });
    fetched += 1;
    opts.onProgress?.();
  }

  return listKnownCityCoverageBounds();
}

/**
 * Rubbelkarte: alle Pack-Städte mit echter Gemeindegrenze.
 */
export function selectHomeMapCities(opts: {
  activeCityId?: string | null;
  lat?: number | null;
  lng?: number | null;
  maxCities?: number;
  radiusKm?: number;
  alwaysIncludeIds?: readonly string[];
  catalogIds?: readonly string[];
}): CityCoverageBounds[] {
  const activeId = (opts.activeCityId ?? '').trim().toLowerCase();
  const catalog = new Set(
    (opts.catalogIds ?? [])
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id && !isRegionPackCityId(id)),
  );
  if (activeId && !isRegionPackCityId(activeId)) catalog.add(activeId);
  const always = new Set(
    (opts.alwaysIncludeIds ?? [])
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id && (catalog.size === 0 || catalog.has(id))),
  );

  const out: CityCoverageBounds[] = [];
  for (const b of listKnownCityCoverageBounds()) {
    if (isRegionPackCityId(b.cityId)) continue;
    if (!catalog.has(b.cityId)) continue;
    if (!hasRealCityBoundaryPolygon(b.polygon)) continue;
    out.push(b);
  }

  out.sort((a, b) => {
    if (a.cityId === activeId) return -1;
    if (b.cityId === activeId) return 1;
    const aPin = always.has(a.cityId);
    const bPin = always.has(b.cityId);
    if (aPin !== bPin) return aPin ? -1 : 1;
    return a.name.localeCompare(b.name, 'de');
  });

  const cap = opts.maxCities ?? 180;
  if (out.length <= cap) return out;
  const must = out.filter((b) => always.has(b.cityId) || b.cityId === activeId);
  const rest = out.filter((b) => !always.has(b.cityId) && b.cityId !== activeId);
  return [...must, ...rest.slice(0, Math.max(0, cap - must.length))];
}
