/**
 * Stadt-Fläche für Stempelkarte: BBox (+ optional Polygon) pro cityId.
 * Coverage-% = erkundet innerhalb dieser Stadt — nicht der gesamten Reise.
 */

import * as FileSystem from 'expo-file-system';
import { getCachedUserProfile } from '../userProfileService';

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
};

const PATH = `${FileSystem.documentDirectory}findus-city-coverage-bounds.json`;

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
    // Gemeindegebiet grob inkl. Feldmark / Bahnhof
    latMin: 53.655,
    latMax: 53.705,
    lngMin: 9.72,
    lngMax: 9.81,
  },
  pinneberg: {
    name: 'Pinneberg',
    latMin: 53.62,
    latMax: 53.68,
    lngMin: 9.75,
    lngMax: 9.85,
  },
  /** Timmendorfer Strand (Ostsee) — falls Profil/Spuren dort */
  timmendorfer_strand: {
    name: 'Timmendorfer Strand',
    latMin: 53.98,
    latMax: 54.02,
    lngMin: 10.74,
    lngMax: 10.82,
  },
};

let cache: Record<string, CityCoverageBounds> = {};
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as {
      byId?: Record<string, CityCoverageBounds>;
    };
    if (parsed.byId) cache = parsed.byId;
  } catch {
    cache = {};
  }
}

function persist(): void {
  void FileSystem.writeAsStringAsync(
    PATH,
    JSON.stringify({ byId: cache, savedAt: Date.now() }),
  ).catch(() => {});
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

export function getBuiltinCityBounds(cityId: string): CityCoverageBounds | null {
  const id = cityId.trim().toLowerCase();
  const b = BUILTIN[id];
  if (!b) return null;
  return { ...b, cityId: id, source: 'builtin' };
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
  const bounds: CityCoverageBounds = {
    cityId: id,
    name: opts.name ?? id,
    latMin: opts.latMin,
    latMax: opts.latMax,
    lngMin: opts.lngMin,
    lngMax: opts.lngMax,
    polygon: opts.polygon?.length ? opts.polygon : undefined,
    source: 'pack',
  };
  // Don't overwrite a richer nominatim polygon unless pack also has polygon
  const existing = cache[id];
  if (
    existing?.source === 'nominatim' &&
    existing.polygon?.length &&
    !bounds.polygon?.length
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

/**
 * Nominatim: Verwaltungsgrenze als BBox (+ Polygon falls vorhanden).
 * Einmalig cachen — kein Dauer-Polling.
 */
export async function fetchAndCacheCityBoundsFromNominatim(opts: {
  cityId: string;
  displayName: string;
  countryCode?: string;
}): Promise<CityCoverageBounds | null> {
  await hydrate();
  const id = opts.cityId.trim().toLowerCase();
  if (cache[id]?.source === 'nominatim' && cache[id]!.polygon?.length) {
    return cache[id]!;
  }
  const builtin = getBuiltinCityBounds(id);
  // Builtin reicht oft — trotzdem optional Polygon nachziehen
  try {
    const q = encodeURIComponent(
      `${opts.displayName}${opts.countryCode ? `, ${opts.countryCode}` : ', Germany'}`,
    );
    const url =
      `https://nominatim.openstreetmap.org/search?q=${q}` +
      `&format=json&limit=1&polygon_geojson=1&addressdetails=0`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FindusTravelCompanion/1.0 (stempelkarte coverage)',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return builtin;
    const arr = (await res.json()) as Array<{
      boundingbox?: [string, string, string, string];
      geojson?: {
        type?: string;
        coordinates?: unknown;
      };
      display_name?: string;
    }>;
    const hit = arr[0];
    if (!hit?.boundingbox || hit.boundingbox.length < 4) return builtin;

    const latMin = Number(hit.boundingbox[0]);
    const latMax = Number(hit.boundingbox[1]);
    const lngMin = Number(hit.boundingbox[2]);
    const lngMax = Number(hit.boundingbox[3]);
    if (![latMin, latMax, lngMin, lngMax].every(Number.isFinite)) {
      return builtin;
    }

    let polygon: Array<[number, number]> | undefined;
    const gj = hit.geojson;
    if (gj?.type === 'Polygon' && Array.isArray(gj.coordinates)) {
      const ring = (gj.coordinates as number[][][])[0];
      if (ring?.length) {
        polygon = ring
          .filter((c) => c.length >= 2)
          .map((c) => [c[1]!, c[0]!] as [number, number]);
      }
    } else if (gj?.type === 'MultiPolygon' && Array.isArray(gj.coordinates)) {
      const ring = (gj.coordinates as number[][][][])[0]?.[0];
      if (ring?.length) {
        polygon = ring
          .filter((c) => c.length >= 2)
          .map((c) => [c[1]!, c[0]!] as [number, number]);
      }
    }

    // BBox aus Polygon als Rechteck-Overlay wenn kein Polygon
    if (!polygon?.length) {
      polygon = [
        [latMin, lngMin],
        [latMin, lngMax],
        [latMax, lngMax],
        [latMax, lngMin],
        [latMin, lngMin],
      ];
    }

    const bounds: CityCoverageBounds = {
      cityId: id,
      name: opts.displayName,
      latMin,
      latMax,
      lngMin,
      lngMax,
      polygon,
      source: 'nominatim',
    };
    cache[id] = bounds;
    persist();
    return bounds;
  } catch {
    return builtin;
  }
}

/** App-Start / Passport-Open: Bounds für aktive Stadt sicherstellen. */
export async function ensureActiveCityCoverageBounds(): Promise<CityCoverageBounds | null> {
  await hydrate();
  const profile = getCachedUserProfile();
  const cityId = (profile?.cityId ?? '').trim().toLowerCase();
  if (!cityId) return null;
  const existing = resolveCityCoverageBoundsSync(cityId);
  if (existing?.source === 'nominatim' || existing?.source === 'builtin' || existing?.source === 'pack') {
    // Builtin/Pack: einmal Nominatim im Hintergrund für Polygon
    if (
      (existing.source === 'builtin' || existing.source === 'pack') &&
      !existing.polygon?.length
    ) {
      void fetchAndCacheCityBoundsFromNominatim({
        cityId,
        displayName: profile?.cityName || existing.name,
        countryCode: 'de',
      });
    }
    return existing;
  }
  const name = profile?.cityName || cityId;
  const fetched = await fetchAndCacheCityBoundsFromNominatim({
    cityId,
    displayName: name,
    countryCode: 'de',
  });
  if (fetched) return fetched;
  if (
    profile &&
    Number.isFinite(Number((profile as { lat?: number }).lat)) === false
  ) {
    /* soft */
  }
  return null;
}
