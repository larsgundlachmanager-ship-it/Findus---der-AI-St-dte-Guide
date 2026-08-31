/**
 * Offline-Kartenextract der gewählten Stadt (GeoJSON-ähnlich, lokal).
 * Datei: staedte/<id>.map.json — Download mit dem Pack.
 */

import * as FileSystem from 'expo-file-system';
import { env } from '../../config/env';
import { isRegionPackCityId } from '../discovery/cityCoverageBounds';
import {
  isNativeMapParseAvailable,
  parseMapExtractFileNative,
} from 'findus-map-native';

export type CityMapExtractRoad = {
  k: 0 | 1 | 2;
  n?: string;
  c: Array<[number, number]>;
};

export type CityMapExtractGraph = {
  nodes: Array<{ i: string; a: number; o: number }>;
  edges: Array<{ a: string; b: string; w: number; k?: string }>;
};

export type CityMapExtract = {
  v: number;
  cityId: string;
  bbox: { south: number; west: number; north: number; east: number };
  roads: CityMapExtractRoad[];
  buildings: Array<Array<[number, number]>>;
  water: Array<Array<[number, number]>>;
  parks: Array<Array<[number, number]>>;
  woods: Array<Array<[number, number]>>;
  land?: Array<Array<[number, number]>>;
  rails: Array<Array<[number, number]>>;
  housenumbers: Array<{ lat: number; lng: number; n: string; s?: string }>;
  graph: CityMapExtractGraph;
};

const DOC = FileSystem.documentDirectory;
const DIR = DOC ? `${DOC}cities/` : null;

const mem = new Map<string, CityMapExtract>();
const prefetchInFlight = new Map<string, Promise<void>>();
/** Normale Städte ~0.5–12 MB; Mega-Regionen nur per Display-Snap + Clip. */
const MAX_EXTRACT_BYTES = 28_000_000;
/** Region-Packs: enger Clip (Phase 6a), nie Full-Parse in Map. */
const REGION_CLIP_RADIUS_M = 3_000;

function localPath(cityId: string): string | null {
  if (!DIR) return null;
  return `${DIR}${cityId.toLowerCase()}.map.json`;
}

export type DisplayExtractSnap = {
  cityId: string;
  lat: number;
  lng: number;
  atMs: number;
  extract: CityMapExtract;
};

let displayMem: DisplayExtractSnap | null = null;
/** Letzte Display-Snaps pro Stadt — Sofort-Wechsel beim Pan ohne erneutes Parse. */
const displayMemByCity = new Map<string, DisplayExtractSnap>();
const DISPLAY_MEM_CAP = 8;
let persistDisplayTimer: ReturnType<typeof setTimeout> | null = null;

function displayPath(cityId: string): string | null {
  if (!DIR) return null;
  return `${DIR}${cityId.toLowerCase()}.map.display.json`;
}

export function peekCityMapExtract(
  cityId: string | null | undefined,
): CityMapExtract | null {
  if (!cityId) return null;
  return mem.get(cityId.toLowerCase()) ?? null;
}

export function peekDisplayExtract(
  cityId: string | null | undefined,
): DisplayExtractSnap | null {
  if (!cityId) return null;
  const id = cityId.toLowerCase();
  if (displayMem?.cityId === id) return displayMem;
  return displayMemByCity.get(id) ?? null;
}

export function rememberDisplayExtract(snap: DisplayExtractSnap): void {
  const id = snap.cityId.toLowerCase();
  displayMem = snap;
  displayMemByCity.set(id, snap);
  if (displayMemByCity.size > DISPLAY_MEM_CAP) {
    let drop: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [k, v] of displayMemByCity) {
      if (k === id) continue;
      if (v.atMs < oldest) {
        oldest = v.atMs;
        drop = k;
      }
    }
    if (drop) displayMemByCity.delete(drop);
  }
  if (persistDisplayTimer) clearTimeout(persistDisplayTimer);
  persistDisplayTimer = setTimeout(() => {
    persistDisplayTimer = null;
    void writeDisplayExtractFile(snap);
  }, 600);
}

async function writeDisplayExtractFile(snap: DisplayExtractSnap): Promise<void> {
  const p = displayPath(snap.cityId);
  if (!p || !DIR) return;
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(
      p,
      JSON.stringify({
        cityId: snap.cityId,
        lat: snap.lat,
        lng: snap.lng,
        atMs: snap.atMs,
        extract: snap.extract,
      }),
    );
  } catch {
    /* Disk voll / iOS sandbox */
  }
}

export async function hydrateDisplayExtract(
  cityId: string | null | undefined,
): Promise<DisplayExtractSnap | null> {
  if (!cityId) return null;
  const id = cityId.toLowerCase();
  if (displayMem?.cityId === id) return displayMem;
  const p = displayPath(id);
  if (!p) return null;
  try {
    const info = await FileSystem.getInfoAsync(p);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(p);
    const j = JSON.parse(raw) as {
      lat?: unknown;
      lng?: unknown;
      atMs?: unknown;
      extract?: unknown;
    };
    const lat = typeof j.lat === 'number' ? j.lat : Number(j.lat);
    const lng = typeof j.lng === 'number' ? j.lng : Number(j.lng);
    const parsed = coerceExtract(j.extract, id);
    if (!parsed || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    displayMem = {
      cityId: id,
      lat,
      lng,
      atMs: typeof j.atMs === 'number' ? j.atMs : Date.now(),
      extract: parsed,
    };
    displayMemByCity.set(id, displayMem);
    return displayMem;
  } catch {
    return null;
  }
}

export function evictCityMapExtract(cityId: string): void {
  const id = cityId.trim().toLowerCase();
  mem.delete(id);
  prefetchInFlight.delete(id);
  displayMemByCity.delete(id);
  if (displayMem?.cityId === id) displayMem = null;
}

export async function deleteCityMapExtractFile(cityId: string): Promise<void> {
  evictCityMapExtract(cityId);
  const p = localPath(cityId);
  const d = displayPath(cityId);
  for (const path of [p, d]) {
    if (!path) continue;
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      /* soft */
    }
  }
}

function supabaseMapUrl(cityId: string): string | null {
  const base = (env.supabaseUrl() || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/storage/v1/object/public/staedte/${encodeURIComponent(
    `${cityId.toLowerCase()}.map.json`,
  )}`;
}

function coerceExtract(value: unknown, cityId: string): CityMapExtract | null {
  if (typeof value === 'string') return parseExtract(value, cityId);
  if (!value || typeof value !== 'object') return null;
  const j = value as CityMapExtract;
  if (!Array.isArray(j.roads)) return null;
  j.cityId = j.cityId || cityId;
  j.graph = j.graph || { nodes: [], edges: [] };
  j.buildings = j.buildings || [];
  j.water = j.water || [];
  j.parks = j.parks || [];
  j.woods = j.woods || [];
  j.rails = j.rails || [];
  j.housenumbers = j.housenumbers || [];
  return j;
}

function parseExtract(raw: string, cityId: string): CityMapExtract | null {
  try {
    return coerceExtract(JSON.parse(raw), cityId);
  } catch {
    return null;
  }
}

async function readAndParseExtractFile(
  absPath: string,
  cityId: string,
): Promise<CityMapExtract | null> {
  if (isNativeMapParseAvailable()) {
    const raw = await parseMapExtractFileNative(absPath);
    if (raw) return parseExtract(raw, cityId);
  }
  try {
    const raw = await FileSystem.readAsStringAsync(absPath);
    return parseExtract(raw, cityId);
  } catch {
    return null;
  }
}

export async function buildAndPersistDisplaySnap(
  cityId: string,
  full: CityMapExtract,
  lat: number,
  lng: number,
  radiusM?: number,
): Promise<CityMapExtract> {
  const clipped = await prepareExtractForDisplayAsync(
    full,
    lat,
    lng,
    cityId,
    radiusM,
  );
  rememberDisplayExtract({
    cityId: cityId.toLowerCase(),
    lat,
    lng,
    atMs: Date.now(),
    extract: clipped,
  });
  return clipped;
}

/** Prefetch Offline-Karte nach Pack-Install — ohne sofortigen Riesen-Parse. */
let idleExtractTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleIdleCityMapExtract(cityId: string): void {
  const id = cityId.trim().toLowerCase();
  if (!id) return;
  if (idleExtractTimer) {
    clearTimeout(idleExtractTimer);
    idleExtractTimer = null;
  }
  // Download *.map.json im Idle — Parse erst wenn Viewport die Stadt braucht.
  idleExtractTimer = setTimeout(() => {
    idleExtractTimer = null;
    void (async () => {
      try {
        const { invalidateLocalMapIndex } = await import('./mapExtractLoader');
        invalidateLocalMapIndex();
        await prefetchCityMapExtract(id);
      } catch {
        /* soft */
      }
    })();
  }, 2_500);
}

const parseInFlight = new Map<string, Promise<CityMapExtract | null>>();

export async function loadCachedCityMapExtract(
  cityId: string | null | undefined,
): Promise<CityMapExtract | null> {
  if (!cityId) return null;
  const id = cityId.toLowerCase();
  const hit = mem.get(id);
  if (hit) return hit;
  const pending = parseInFlight.get(id);
  if (pending) return pending;
  const p = localPath(id);
  if (!p) return null;
  const job = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(p);
      if (!info.exists) return null;
      const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
      if (size > MAX_EXTRACT_BYTES && !isRegionPackCityId(id)) {
        try {
          await FileSystem.deleteAsync(p, { idempotent: true });
        } catch {
          /* leftover London mega-extract */
        }
        return null;
      }
      if (size > MAX_EXTRACT_BYTES && isRegionPackCityId(id)) {
        const snap = await hydrateDisplayExtract(id);
        if (snap?.extract) {
          mem.set(id, snap.extract);
          return snap.extract;
        }
        return null;
      }
      const parsed = await readAndParseExtractFile(p, id);
      if (parsed) mem.set(id, parsed);
      return parsed;
    } catch {
      return null;
    } finally {
      parseInFlight.delete(id);
    }
  })();
  parseInFlight.set(id, job);
  return job;
}

export async function prefetchCityMapExtract(
  cityId: string | null | undefined,
): Promise<void> {
  if (!cityId) return;
  const id = cityId.toLowerCase();
  if (mem.has(id)) return;
  const dest = localPath(id);
  const url = supabaseMapUrl(id);
  if (!dest || !url || !DIR) return;

  const existing = prefetchInFlight.get(id);
  if (existing) {
    await existing;
    return;
  }

  const job = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(dest);
      if (info.exists) return;
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
      const tmp = `${DIR}_tmp_map_${Date.now()}.json`;
      const res = await FileSystem.downloadAsync(url, tmp);
      if (res.status < 200 || res.status >= 300) {
        try {
          await FileSystem.deleteAsync(tmp, { idempotent: true });
        } catch {
          /* ignore */
        }
        return;
      }
      const tmpInfo = await FileSystem.getInfoAsync(tmp);
      const tmpSize =
        'size' in tmpInfo && typeof tmpInfo.size === 'number' ? tmpInfo.size : 0;
      if (tmpSize > MAX_EXTRACT_BYTES) {
        try {
          await FileSystem.deleteAsync(tmp, { idempotent: true });
        } catch {
          /* too big */
        }
        return;
      }
      try {
        await FileSystem.moveAsync({ from: tmp, to: dest });
      } catch {
        try {
          const raw = await FileSystem.readAsStringAsync(tmp);
          await FileSystem.writeAsStringAsync(dest, raw);
        } catch {
          /* ignore */
        }
        try {
          await FileSystem.deleteAsync(tmp, { idempotent: true });
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* offline / 404 */
    }
  })();

  prefetchInFlight.set(id, job);
  try {
    await job;
  } finally {
    prefetchInFlight.delete(id);
  }
}

export async function ensureCityMapExtract(
  cityId: string | null | undefined,
): Promise<CityMapExtract | null> {
  if (!cityId) return null;
  const id = cityId.toLowerCase();
  const cached = await loadCachedCityMapExtract(id);
  if (cached) return cached;
  await prefetchCityMapExtract(id);
  return loadCachedCityMapExtract(id);
}

export function clearCityMapExtractMem(): void {
  mem.clear();
  displayMem = null;
}

const EMPTY_GRAPH: CityMapExtractGraph = { nodes: [], edges: [] };

function ringTouchesBox(
  ring: Array<[number, number]> | undefined,
  south: number,
  north: number,
  west: number,
  east: number,
): boolean {
  if (!ring || ring.length < 1) return false;
  for (const p of ring) {
    const lat = p[0];
    const lng = p[1];
    if (lat >= south && lat <= north && lng >= west && lng <= east) return true;
  }
  return false;
}

/** Erster sichtbarer Ausschnitt um GPS (~1 km). */
export const DISPLAY_BOOT_RADIUS_M = 1_200;
/**
 * Idle-Ausschnitt: ~10 km — gleiches Detail wie Offline-Umland-Pack
 * (Gebäude+Straßen). Überlappende Städte: ein Extract via Viewport-Switch.
 */
export const DISPLAY_WIDE_RADIUS_M = 10_000;

/**
 * Volles Extract wenn klein genug; sonst Clip um GPS (WebView-Schutz —
 * 3–13 MB JSON + 10k Gebäude killt sonst Android/MapLibre).
 */
export function prepareExtractForDisplay(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  cityId?: string | null,
  radiusOverrideM?: number,
): CityMapExtract {
  const id = (cityId || extract.cityId || '').toLowerCase();
  const region = isRegionPackCityId(id);
  const n =
    (extract.roads?.length ?? 0) +
    (extract.buildings?.length ?? 0) +
    (extract.water?.length ?? 0) +
    (extract.parks?.length ?? 0);
  if (n <= 4000 && !region && radiusOverrideM == null) {
    return { ...extract, graph: EMPTY_GRAPH };
  }
  const radiusM =
    radiusOverrideM ??
    (region ? REGION_CLIP_RADIUS_M : DISPLAY_WIDE_RADIUS_M);
  const maxBuildings = region
    ? 4_000
    : radiusM <= 1_500
      ? 2_500
      : radiusM <= 10_000
        ? 8_000
        : 10_000;
  return clipCityMapExtractForDisplay(extract, lat, lng, radiusM, maxBuildings);
}

export function clipCityMapExtractForDisplay(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  radiusM = 5200,
  maxBuildings = 8_000,
): CityMapExtract {
  const dLat = radiusM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = radiusM / (111_320 * Math.max(0.2, cos));
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;
  const hit = (ring?: Array<[number, number]>) =>
    ringTouchesBox(ring, south, north, west, east);
  const maxRoads =
    radiusM <= 1_500 ? 2_500 : radiusM <= 10_000 ? 5_500 : 9_000;
  return {
    v: extract.v,
    cityId: extract.cityId,
    bbox: { south, west, north, east },
    roads: extract.roads.filter((r) => hit(r.c)).slice(0, maxRoads),
    buildings: extract.buildings.filter(hit).slice(0, maxBuildings),
    water: extract.water.filter(hit),
    parks: extract.parks.filter(hit),
    woods: extract.woods.filter(hit),
    land: (extract.land || []).filter(hit).slice(0, 80),
    rails: extract.rails.filter(hit),
    housenumbers: extract.housenumbers
      .filter(
        (n) =>
          n.lat >= south &&
          n.lat <= north &&
          n.lng >= west &&
          n.lng <= east,
      )
      .slice(0, 2_400),
    graph: EMPTY_GRAPH,
  };
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wie prepareExtractForDisplay, aber mit Yields — Mic/Settings bleiben tippbar.
 */
export async function prepareExtractForDisplayAsync(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  cityId?: string | null,
  radiusOverrideM?: number,
): Promise<CityMapExtract> {
  const id = (cityId || extract.cityId || '').toLowerCase();
  const region = isRegionPackCityId(id);
  const n =
    (extract.roads?.length ?? 0) +
    (extract.buildings?.length ?? 0) +
    (extract.water?.length ?? 0) +
    (extract.parks?.length ?? 0);
  if (n <= 4000 && !region && radiusOverrideM == null) {
    return { ...extract, graph: EMPTY_GRAPH };
  }
  const radiusM =
    radiusOverrideM ??
    (region ? REGION_CLIP_RADIUS_M : DISPLAY_WIDE_RADIUS_M);
  const maxBuildings = region
    ? 4_000
    : radiusM <= 1_500
      ? 2_500
      : radiusM <= 10_000
        ? 8_000
        : 10_000;
  return clipCityMapExtractForDisplayAsync(
    extract,
    lat,
    lng,
    radiusM,
    maxBuildings,
  );
}

export async function clipCityMapExtractForDisplayAsync(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  radiusM = 5200,
  maxBuildings = 8_000,
): Promise<CityMapExtract> {
  const dLat = radiusM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = radiusM / (111_320 * Math.max(0.2, cos));
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;
  const hit = (ring?: Array<[number, number]>) =>
    ringTouchesBox(ring, south, north, west, east);
  const maxRoads =
    radiusM <= 1_500 ? 2_500 : radiusM <= 10_000 ? 5_500 : 9_000;

  const roads = extract.roads.filter((r) => hit(r.c)).slice(0, maxRoads);
  await yieldToMainThread();

  const buildings: typeof extract.buildings = [];
  const srcB = extract.buildings;
  const CHUNK = 2_500;
  for (let i = 0; i < srcB.length && buildings.length < maxBuildings; i += CHUNK) {
    const end = Math.min(i + CHUNK, srcB.length);
    for (let j = i; j < end && buildings.length < maxBuildings; j += 1) {
      const b = srcB[j]!;
      if (hit(b)) buildings.push(b);
    }
    if (i + CHUNK < srcB.length && buildings.length < maxBuildings) {
      await yieldToMainThread();
    }
  }

  const water = extract.water.filter(hit);
  await yieldToMainThread();
  const parks = extract.parks.filter(hit);
  const woods = extract.woods.filter(hit);
  const land = (extract.land || []).filter(hit).slice(0, 80);
  const rails = extract.rails.filter(hit);
  const housenumbers = extract.housenumbers
    .filter(
      (n) =>
        n.lat >= south &&
        n.lat <= north &&
        n.lng >= west &&
        n.lng <= east,
    )
    .slice(0, 2_400);

  return {
    v: extract.v,
    cityId: extract.cityId,
    bbox: { south, west, north, east },
    roads,
    buildings,
    water,
    parks,
    woods,
    land,
    rails,
    housenumbers,
    graph: EMPTY_GRAPH,
  };
}
