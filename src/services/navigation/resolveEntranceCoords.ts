/**
 * Google Places — Ort finden + Main Entrance Koordinaten.
 * Online: immer Google. Offline: Caller nutzt Cache/Pack.
 */

import { env } from '../../config/env';
import { hasGoogleMapsNavKey, geocodePlaceName } from './googleMapsNav';
import { isDeviceOffline } from './networkState';
import {
  getCachedPlaceFacts,
  putCachedPlaceFacts,
} from './placesFactCache';

export type EntranceResolveResult = {
  name: string;
  lat: number;
  lng: number;
  placeId: string | null;
  usedEntrance: boolean;
  via: 'google_entrance' | 'google_place' | 'geocode' | 'none';
};

function mapsKey(): string {
  return env.googleMapsApiKey();
}

const FETCH_MS = 10_000;

async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

async function findPlaceId(
  input: string,
  bias?: { lat: number; lng: number },
): Promise<{ placeId: string; name: string; lat: number; lng: number } | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(
      'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
    );
    u.searchParams.set('input', input);
    u.searchParams.set('inputtype', 'textquery');
    u.searchParams.set(
      'fields',
      'place_id,geometry,name,formatted_address',
    );
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    if (bias) {
      u.searchParams.set(
        'locationbias',
        `circle:25000@${bias.lat},${bias.lng}`,
      );
    }
    const data = await fetchJson(u.toString(), ctrl.signal);
    const candidates = (data?.candidates as Array<{
      place_id?: string;
      name?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>) ?? [];
    const hit = candidates[0];
    const lat = hit?.geometry?.location?.lat;
    const lng = hit?.geometry?.location?.lng;
    const placeId = hit?.place_id;
    if (lat == null || lng == null || !placeId) return null;
    return {
      placeId,
      name: (hit.name ?? input).trim(),
      lat,
      lng,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Place Details → entrance / main entrance wenn vorhanden.
 * Google liefert teils `entrance` in address_components / geometry;
 * zuverlässiger: Places Details mit `geometry` + optional Nearby entrances.
 */
async function fetchMainEntrance(
  placeId: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    // Details
    const u = new URL(
      'https://maps.googleapis.com/maps/api/place/details/json',
    );
    u.searchParams.set('place_id', placeId);
    u.searchParams.set(
      'fields',
      'geometry,name,address_component,entrance',
    );
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    const result = data?.result as {
      geometry?: {
        location?: { lat?: number; lng?: number };
        entrances?: Array<{ location?: { latitude?: number; longitude?: number } }>;
      };
      entrance?: Array<{ location?: { latitude?: number; longitude?: number } }>;
    } | undefined;

    // Newer Places may expose entrance array
    const entrances =
      result?.entrance ??
      result?.geometry?.entrances ??
      [];
    for (const e of entrances) {
      const lat = e.location?.latitude;
      const lng = e.location?.longitude;
      if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }

    // Fallback: geometry location (building centroid)
    const lat = result?.geometry?.location?.lat;
    const lng = result?.geometry?.location?.lng;
    if (lat != null && lng != null) return { lat, lng };
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ort suchen → Main Entrance wenn möglich → Nav-Koordinaten.
 * Online: Cache zuerst, sonst Google (Ergebnis dauerhaft cachen).
 * Offline: lokaler Places-Cache.
 */
export async function resolveDestinationWithEntrance(opts: {
  name: string;
  biasLat?: number | null;
  biasLng?: number | null;
}): Promise<EntranceResolveResult> {
  const offline = await isDeviceOffline();

  const cached = await getCachedPlaceFacts(opts.name);
  if (
    cached &&
    Number.isFinite(cached.lat) &&
    Number.isFinite(cached.lng) &&
    Math.abs(cached.lat) > 0.01
  ) {
    return {
      name: cached.name || opts.name,
      lat: cached.lat,
      lng: cached.lng,
      placeId: cached.placeId,
      usedEntrance: cached.usedEntrance,
      via: (cached.via as EntranceResolveResult['via']) || 'google_place',
    };
  }

  if (offline || !hasGoogleMapsNavKey()) {
    return {
      name: opts.name,
      lat: 0,
      lng: 0,
      placeId: null,
      usedEntrance: false,
      via: 'none',
    };
  }

  const bias =
    opts.biasLat != null && opts.biasLng != null
      ? { lat: opts.biasLat, lng: opts.biasLng }
      : undefined;

  const place = await findPlaceId(opts.name, bias);
  if (!place) {
    const geo = await geocodePlaceName(opts.name, {
      biasLat: bias?.lat,
      biasLng: bias?.lng,
    });
    if (!geo) {
      return {
        name: opts.name,
        lat: 0,
        lng: 0,
        placeId: null,
        usedEntrance: false,
        via: 'none',
      };
    }
    const result: EntranceResolveResult = {
      name: geo.label || opts.name,
      lat: geo.lat,
      lng: geo.lng,
      placeId: null,
      usedEntrance: false,
      via: 'geocode',
    };
    void putCachedPlaceFacts({
      name: result.name,
      placeId: null,
      lat: result.lat,
      lng: result.lng,
      usedEntrance: false,
      via: result.via,
    });
    return result;
  }

  const entrance = await fetchMainEntrance(place.placeId);
  let result: EntranceResolveResult;
  if (
    entrance &&
    (Math.abs(entrance.lat - place.lat) > 0.00001 ||
      Math.abs(entrance.lng - place.lng) > 0.00001)
  ) {
    result = {
      name: place.name,
      lat: entrance.lat,
      lng: entrance.lng,
      placeId: place.placeId,
      usedEntrance: true,
      via: 'google_entrance',
    };
  } else {
    result = {
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      placeId: place.placeId,
      usedEntrance: false,
      via: 'google_place',
    };
  }

  void putCachedPlaceFacts({
    name: result.name,
    placeId: result.placeId,
    lat: result.lat,
    lng: result.lng,
    usedEntrance: result.usedEntrance,
    via: result.via,
  });
  return result;
}
