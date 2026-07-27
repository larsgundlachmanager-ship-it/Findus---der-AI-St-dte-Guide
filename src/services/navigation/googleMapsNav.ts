/**
 * Google Maps Anreicherung für freihändige Navigation:
 * Directions (Gehweg), Places Nearby (sichtbare Orte),
 * Street View Metadata (+ optional Bild für Gemini-Beschreibung).
 */

import { env } from '../../config/env';
import type { NavWaypoint } from './navigationTypes';

const PLACES_NEARBY =
  'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
const DIRECTIONS = 'https://maps.googleapis.com/maps/api/directions/json';
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';
const SV_META = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const SV_STATIC = 'https://maps.googleapis.com/maps/api/streetview';

const FETCH_MS = 6_000;

/** Visuell nützliche Place-Typen — Nearby filtert heuristisch über Score. */
const _LANDMARK_TYPE_HINT =
  'pharmacy|bakery|cafe|church|park|school|supermarket|store';
void _LANDMARK_TYPE_HINT;
export type PlaceLandmark = {
  name: string;
  types: string[];
  lat: number;
  lng: number;
  distanceM: number;
};

export type DirectionsStep = {
  lat: number;
  lng: number;
  maneuver: string | null;
  /** Straßenname / Kurztext aus html_instructions (ohne Tags). */
  instruction: string;
  roadName: string | null;
  distanceM: number;
};

function mapsKey(): string {
  return (
    env.googleMapsApiKey?.() ||
    env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
    ''
  ).trim();
}

export function hasGoogleMapsNavKey(): boolean {
  const k = mapsKey();
  return k.length > 20 && !k.includes('your-');
}

async function fetchJson(
  url: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<div[^>]*>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRoadName(instruction: string): string | null {
  const m = instruction.match(
    /\b(?:auf|in|onto|on)\s+(?:die\s+|den\s+|das\s+)?([A-ZÄÖÜ][\wÄÖÜäöüß.\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß.\-]+){0,3})/u,
  );
  if (m?.[1] && m[1].length >= 3) return m[1].trim();
  const street = instruction.match(
    /\b([A-ZÄÖÜ][\wÄÖÜäöüß.\-]*(?:straße|strasse|weg|allee|platz|gasse|damm))\b/iu,
  );
  return street?.[1]?.trim() ?? null;
}

function normalizeManeuver(
  raw: string | null | undefined,
  instruction: string,
): string | null {
  if (raw?.trim()) return raw.trim().toLowerCase();
  const t = instruction.toLowerCase();
  if (/scharf\s+links|sharp left/.test(t)) return 'turn-sharp-left';
  if (/scharf\s+rechts|sharp right/.test(t)) return 'turn-sharp-right';
  if (/leicht\s+links|slight left|halb links/.test(t)) return 'turn-slight-left';
  if (/leicht\s+rechts|slight right|halb rechts/.test(t))
    return 'turn-slight-right';
  if (/\blinks\b|turn left/.test(t)) return 'turn-left';
  if (/\brechts\b|turn right/.test(t)) return 'turn-right';
  if (/geradeaus|continue|weiter/.test(t)) return 'straight';
  if (/ziel|destination|ankunft/.test(t)) return 'arrive';
  return null;
}

/** Google Directions travel modes — niemals driving/Autoverkehr. */
export type PedestrianTravelMode = 'walking' | 'bicycling' | 'transit';

function parseDirectionsSteps(
  data: Record<string, unknown>,
): DirectionsStep[] | null {
  if (data.status !== 'OK') return null;
  const routes = data.routes as Array<{
    legs?: Array<{
      steps?: Array<{
        html_instructions?: string;
        maneuver?: string;
        distance?: { value?: number };
        end_location?: { lat?: number; lng?: number };
        travel_mode?: string;
      }>;
    }>;
  }>;
  const legs = routes?.[0]?.legs ?? [];
  const out: DirectionsStep[] = [];
  for (const leg of legs) {
    for (const s of leg.steps ?? []) {
      const lat = s.end_location?.lat;
      const lng = s.end_location?.lng;
      if (lat == null || lng == null) continue;
      const instruction = stripHtml(s.html_instructions ?? '');
      out.push({
        lat,
        lng,
        maneuver: normalizeManeuver(s.maneuver, instruction),
        instruction,
        roadName: extractRoadName(instruction),
        distanceM: Math.round(s.distance?.value ?? 0),
      });
    }
  }
  return out.length ? out : null;
}

/**
 * Google Directions — nur walking / bicycling / transit (nie driving).
 */
export async function fetchRouteDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: PedestrianTravelMode = 'walking',
): Promise<DirectionsStep[] | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const travelMode: PedestrianTravelMode =
    mode === 'bicycling' || mode === 'transit' ? mode : 'walking';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(DIRECTIONS);
    u.searchParams.set('origin', `${origin.lat},${origin.lng}`);
    u.searchParams.set('destination', `${destination.lat},${destination.lng}`);
    u.searchParams.set('mode', travelMode);
    u.searchParams.set('language', 'de');
    u.searchParams.set('units', 'metric');
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    if (!data) return null;
    const steps = parseDirectionsSteps(data);
    if (steps) return steps;
    // Transit/Bike oft ohne Route → Fuß-Fallback (nie Auto)
    if (travelMode !== 'walking') {
      const u2 = new URL(DIRECTIONS);
      u2.searchParams.set('origin', `${origin.lat},${origin.lng}`);
      u2.searchParams.set(
        'destination',
        `${destination.lat},${destination.lng}`,
      );
      u2.searchParams.set('mode', 'walking');
      u2.searchParams.set('language', 'de');
      u2.searchParams.set('units', 'metric');
      u2.searchParams.set('key', mapsKey());
      const data2 = await fetchJson(u2.toString(), ctrl.signal);
      if (data2) return parseDirectionsSteps(data2);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Alias: Fußweg-Route (Default). */
export async function fetchWalkingDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<DirectionsStep[] | null> {
  return fetchRouteDirections(origin, destination, 'walking');
}

export type GeocodeResult = {
  lat: number;
  lng: number;
  label: string;
};

/**
 * Ort online auflösen: Google Geocode → Places Find → Nominatim → Expo.
 * Bias optional (aktueller Standort / Stadt).
 */
export async function geocodePlaceName(
  query: string,
  opts?: {
    biasLat?: number;
    biasLng?: number;
    cityHint?: string | null;
  },
): Promise<GeocodeResult | null> {
  const q = query.replace(/\s+/g, ' ').trim();
  if (q.length < 2) return null;
  const withCity =
    opts?.cityHint &&
    !q.toLowerCase().includes(opts.cityHint.toLowerCase())
      ? `${q}, ${opts.cityHint}`
      : q;

  const fromGoogle = await geocodeViaGoogle(withCity, opts);
  if (fromGoogle) return fromGoogle;

  const fromPlaces = await findPlaceViaGoogle(withCity, opts);
  if (fromPlaces) return fromPlaces;

  const fromNominatim = await geocodeViaNominatim(withCity);
  if (fromNominatim) return fromNominatim;

  try {
    const Location = await import('expo-location');
    const hits = await Location.geocodeAsync(withCity);
    const first = hits?.[0];
    if (
      first &&
      Number.isFinite(first.latitude) &&
      Number.isFinite(first.longitude)
    ) {
      return {
        lat: first.latitude,
        lng: first.longitude,
        label: q,
      };
    }
  } catch {
    // Expo Geocode optional
  }
  return null;
}

async function geocodeViaGoogle(
  address: string,
  opts?: { biasLat?: number; biasLng?: number },
): Promise<GeocodeResult | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(GEOCODE);
    u.searchParams.set('address', address);
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    if (
      opts?.biasLat != null &&
      opts?.biasLng != null &&
      Number.isFinite(opts.biasLat) &&
      Number.isFinite(opts.biasLng)
    ) {
      u.searchParams.set(
        'bounds',
        `${opts.biasLat - 0.35},${opts.biasLng - 0.35}|${opts.biasLat + 0.35},${opts.biasLng + 0.35}`,
      );
    }
    const data = await fetchJson(u.toString(), ctrl.signal);
    const results = (data?.results as Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>) ?? [];
    const hit = results[0];
    const lat = hit?.geometry?.location?.lat;
    const lng = hit?.geometry?.location?.lng;
    if (lat == null || lng == null) return null;
    return {
      lat,
      lng,
      label: (hit.formatted_address ?? address).trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function findPlaceViaGoogle(
  input: string,
  opts?: { biasLat?: number; biasLng?: number },
): Promise<GeocodeResult | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(
      'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
    );
    u.searchParams.set('input', input);
    u.searchParams.set('inputtype', 'textquery');
    u.searchParams.set('fields', 'geometry,name,formatted_address');
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    if (
      opts?.biasLat != null &&
      opts?.biasLng != null &&
      Number.isFinite(opts.biasLat) &&
      Number.isFinite(opts.biasLng)
    ) {
      u.searchParams.set(
        'locationbias',
        `circle:40000@${opts.biasLat},${opts.biasLng}`,
      );
    }
    const data = await fetchJson(u.toString(), ctrl.signal);
    const candidates = (data?.candidates as Array<{
      name?: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>) ?? [];
    const hit = candidates[0];
    const lat = hit?.geometry?.location?.lat;
    const lng = hit?.geometry?.location?.lng;
    if (lat == null || lng == null) return null;
    return {
      lat,
      lng,
      label: (hit.name ?? hit.formatted_address ?? input).trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeViaNominatim(
  query: string,
): Promise<GeocodeResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'json');
    u.searchParams.set('limit', '1');
    u.searchParams.set('addressdetails', '0');
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;
    const hit = rows[0];
    const lat = hit?.lat != null ? Number(hit.lat) : NaN;
    const lng = hit?.lon != null ? Number(hit.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      label: (hit.display_name ?? query).trim(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sichtbare Orte in der Nähe (Apotheke, Bäckerei, Park …).
 */
export async function fetchNearbyPlaceLandmarks(
  lat: number,
  lng: number,
  radiusM = 55,
): Promise<PlaceLandmark[]> {
  if (!hasGoogleMapsNavKey()) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(PLACES_NEARBY);
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('radius', String(Math.max(25, Math.min(radiusM, 90))));
    u.searchParams.set('type', 'point_of_interest');
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    // type=point_of_interest alone is broad; also try without type filter via keyword
    const data = await fetchJson(u.toString(), ctrl.signal);
    let results =
      (data?.results as Array<{
        name?: string;
        types?: string[];
        geometry?: { location?: { lat?: number; lng?: number } };
        business_status?: string;
      }>) ?? [];

    if (results.length < 2) {
      const u2 = new URL(PLACES_NEARBY);
      u2.searchParams.set('location', `${lat},${lng}`);
      u2.searchParams.set('radius', String(radiusM));
      u2.searchParams.set('keyword', 'geschäft laden café restaurant');
      u2.searchParams.set('language', 'de');
      u2.searchParams.set('key', mapsKey());
      const data2 = await fetchJson(u2.toString(), ctrl.signal);
      results = (data2?.results as typeof results) ?? results;
    }

    const out: PlaceLandmark[] = [];
    for (const r of results) {
      if (r.business_status === 'CLOSED_PERMANENTLY') continue;
      const plat = r.geometry?.location?.lat;
      const plng = r.geometry?.location?.lng;
      const name = (r.name ?? '').trim();
      if (!name || plat == null || plng == null) continue;
      const types = r.types ?? [];
      const distanceM = haversine(lat, lng, plat, plng);
      if (distanceM > radiusM + 15) continue;
      out.push({ name, types, lat: plat, lng: plng, distanceM });
    }
    out.sort((a, b) => {
      const as = landmarkScore(a.types);
      const bs = landmarkScore(b.types);
      if (as !== bs) return bs - as;
      return a.distanceM - b.distanceM;
    });
    return out.slice(0, 4);
  } finally {
    clearTimeout(timer);
  }
}

function landmarkScore(types: string[]): number {
  let s = 0;
  const blob = types.join(' ');
  if (/pharmacy|drugstore|bakery|cafe|church|park|school|post_office/.test(blob))
    s += 5;
  if (/supermarket|convenience_store|restaurant|florist|hair_care/.test(blob))
    s += 3;
  if (/store|point_of_interest|establishment/.test(blob)) s += 1;
  if (/route|political|locality/.test(blob)) s -= 3;
  return s;
}

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function reverseGeocodeStreet(
  lat: number,
  lng: number,
): Promise<string | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(GEOCODE);
    u.searchParams.set('latlng', `${lat},${lng}`);
    u.searchParams.set('language', 'de');
    u.searchParams.set('result_type', 'route');
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    const results = (data?.results as Array<{
      address_components?: Array<{ long_name?: string; types?: string[] }>;
      formatted_address?: string;
    }>) ?? [];
    for (const r of results) {
      const route = r.address_components?.find((c) =>
        c.types?.includes('route'),
      );
      if (route?.long_name) return route.long_name;
    }
    const first = results[0]?.formatted_address;
    if (first) {
      const part = first.split(',')[0]?.trim();
      if (part && part.length >= 3) return part;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function streetViewAvailable(
  lat: number,
  lng: number,
): Promise<boolean> {
  if (!hasGoogleMapsNavKey()) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4_000);
  try {
    const u = new URL(SV_META);
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    return data?.status === 'OK';
  } finally {
    clearTimeout(timer);
  }
}

/** Street-View-Static als Base64 (für Gemini Vision). */
export async function fetchStreetViewImageBase64(
  lat: number,
  lng: number,
  headingDeg: number,
): Promise<string | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(SV_STATIC);
    u.searchParams.set('size', '640x640');
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('heading', String(Math.round(headingDeg)));
    u.searchParams.set('pitch', '5');
    u.searchParams.set('fov', '85');
    u.searchParams.set('source', 'outdoor');
    u.searchParams.set('key', mapsKey());
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 800) return null;
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    // btoa available in RN hermes
    return typeof btoa === 'function'
      ? btoa(binary)
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Directions-Schritte → NavWaypoints mit Maneuver/Straßenname.
 */
export function directionsToWaypoints(steps: DirectionsStep[]): NavWaypoint[] {
  return steps.map((s) => ({
    lat: s.lat,
    lng: s.lng,
    maneuver: s.maneuver,
    roadName: s.roadName,
    instruction: s.instruction,
    cue: null,
    landmark: null,
  }));
}
