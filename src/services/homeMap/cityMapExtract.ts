/**
 * Offline-Kartenextract der gewÃ¤hlten Stadt (GeoJSON-Ã¤hnlich, lokal).
 * Datei: staedte/<id>.map.json â€” Download mit dem Pack.
 */

import * as FileSystem from 'expo-file-system';
import { env } from '../../config/env';
import { isRegionPackCityId } from '../discovery/cityCoverageBounds';
import {
  isNativeMapParseAvailable,
  parseMapExtractFileNative,
} from 'findus-map-native';
import { mapExtractCapsForRadius } from './mapDeviceTier';
import { isMapExtractRoadsSane } from './mapExtractSanity';
import { noteMapDataWarm } from './mapDataCache';

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
/** Volle Parses â€” klein halten (Display-Snaps haben eigenes Cap). */
const MEM_CAP = 4;

function putCityMapExtractMem(id: string, extract: CityMapExtract): void {
  const key = id.toLowerCase();
  if (mem.has(key)) mem.delete(key);
  while (mem.size >= MEM_CAP) {
    const oldest = mem.keys().next().value;
    if (oldest == null) break;
    mem.delete(oldest);
  }
  mem.set(key, extract);
}
const prefetchInFlight = new Map<string, Promise<void>>();
/** Voll-Parse/JS-Mem-Grenze â€” darÃ¼ber nur Display-Snap/Clip, Datei behalten. */
const MAX_EXTRACT_BYTES = 28_000_000;
/** Download-Cap (Amsterdam ~39 MB) â€” Clip auf GerÃ¤t, kein silent Delete. */
const MAX_DOWNLOAD_BYTES = 48_000_000;
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
/** Letzte Display-Snaps pro Stadt â€” Sofort-Wechsel beim Pan ohne erneutes Parse. */
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
  if (!isMapExtractRoadsSane(snap.extract)) {
    if (__DEV__) {
      console.warn('[map-extract] skip corrupt display snap', snap.cityId);
    }
    return;
  }
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
  }, 400);
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

/** App â†’ Hintergrund/Kill: Display-Snap sofort auf Disk â€” Cold-Start ohne Neu-Parse. */
export async function flushDisplayExtractNow(): Promise<void> {
  if (persistDisplayTimer) {
    clearTimeout(persistDisplayTimer);
    persistDisplayTimer = null;
  }
  const snap = displayMem;
  if (!snap) return;
  await writeDisplayExtractFile(snap);
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
    if (!isMapExtractRoadsSane(parsed)) {
      try {
        await FileSystem.deleteAsync(p, { idempotent: true });
      } catch {
        /* soft */
      }
      return null;
    }
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

/** Prefetch Offline-Karte nach Pack-Install â€” ohne sofortigen Riesen-Parse.
 * Vector/Protomaps: no-op (keine *.map.json mehr). */
let idleExtractTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleIdleCityMapExtract(cityId: string): void {
  try {
    const { isVectorBasemapEnabled } = require('./mapTileConfig') as {
      isVectorBasemapEnabled: () => boolean;
    };
    if (isVectorBasemapEnabled()) return;
  } catch {
    /* soft â€” Legacy weiter */
  }
  const id = cityId.trim().toLowerCase();
  if (!id) return;
  if (idleExtractTimer) {
    clearTimeout(idleExtractTimer);
    idleExtractTimer = null;
  }
  // Download *.map.json im Idle â€” Parse erst wenn Viewport die Stadt braucht.
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
      // Mega-Stadt (Amsterdam) / Region: nie still lÃ¶schen â€” Display-Snap oder Clip.
      if (size > MAX_EXTRACT_BYTES) {
        const snap = await hydrateDisplayExtract(id);
        if (snap?.extract) {
          putCityMapExtractMem(id, snap.extract);
          return snap.extract;
        }
        const parsedHuge = await readAndParseExtractFile(p, id);
        if (!parsedHuge) return null;
        const midLat =
          (parsedHuge.bbox.south + parsedHuge.bbox.north) / 2;
        const midLng =
          (parsedHuge.bbox.west + parsedHuge.bbox.east) / 2;
        const clipped = await buildAndPersistDisplaySnap(
          id,
          parsedHuge,
          midLat,
          midLng,
          DISPLAY_BOOT_RADIUS_M,
        );
        putCityMapExtractMem(id, clipped);
        return clipped;
      }
      const parsed = await readAndParseExtractFile(p, id);
      if (parsed) putCityMapExtractMem(id, parsed);
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
      if (info.exists) {
        noteMapDataWarm(id);
        return;
      }
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
      if (tmpSize > MAX_DOWNLOAD_BYTES) {
        try {
          await FileSystem.deleteAsync(tmp, { idempotent: true });
        } catch {
          /* too big even for clip-on-device */
        }
        return;
      }
      // > MAX_EXTRACT_BYTES ok â€” loadCached clippt zu Display-Snap.
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
      noteMapDataWarm(id);
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
  displayMemByCity.clear();
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

/**
 * Cap nicht â€žerste N im Bboxâ€œ â€” sonst fehlen alle GebÃ¤ude um GPS
 * (OSM-Reihenfolge oft SW-first â†’ leere Street-View).
 */
function pickNearestBuildings(
  buildings: CityMapExtract['buildings'],
  lat: number,
  lng: number,
  hit: (ring?: Array<[number, number]>) => boolean,
  maxBuildings: number,
): CityMapExtract['buildings'] {
  const inBox = buildings.filter(hit);
  if (inBox.length <= maxBuildings) return inBox;
  const scored = inBox.map((ring) => {
    const p = ring[0];
    const dLat = p ? p[0] - lat : 99;
    const dLng = p ? p[1] - lng : 99;
    return { ring, d2: dLat * dLat + dLng * dLng };
  });
  scored.sort((a, b) => a.d2 - b.d2);
  const out: CityMapExtract['buildings'] = [];
  for (let i = 0; i < maxBuildings; i += 1) {
    out.push(scored[i]!.ring);
  }
  return out;
}

/**
 * StraÃŸen: Major behalten, dann nÃ¤chste Streets zum GPS â€” sonst leeres StraÃŸennetz
 * in der Dorfmitte bei Umland-Cap.
 */
function pickRoadsForDisplay(
  roads: CityMapExtract['roads'],
  lat: number,
  lng: number,
  hit: (ring?: Array<[number, number]>) => boolean,
  maxRoads: number,
): CityMapExtract['roads'] {
  const inBox = roads.filter((r) => hit(r.c));
  if (inBox.length <= maxRoads) return inBox;
  const majors: typeof inBox = [];
  const rest: typeof inBox = [];
  for (const r of inBox) {
    if ((r.k ?? 1) === 0) majors.push(r);
    else rest.push(r);
  }
  const scored = rest.map((r) => {
    const p = r.c?.[0];
    const dLat = p ? p[0] - lat : 99;
    const dLng = p ? p[1] - lng : 99;
    // Streets (k=1) vor Pfaden (k=2)
    const kindBias = (r.k ?? 1) === 1 ? 0 : 1;
    return { r, kindBias, d2: dLat * dLat + dLng * dLng };
  });
  scored.sort((a, b) => a.kindBias - b.kindBias || a.d2 - b.d2);
  const out = majors.slice();
  const remain = Math.max(0, maxRoads - out.length);
  for (let i = 0; i < remain && i < scored.length; i += 1) {
    out.push(scored[i]!.r);
  }
  return out;
}

/** Erster sichtbarer Ausschnitt um GPS (~5 km) â€” Splash-Kern. */
export const DISPLAY_BOOT_RADIUS_M = 5_000;
/**
 * Stadt-Release: ~10 km â€” gleiches Detail wie Offline-Umland-Pack
 * (GebÃ¤ude+StraÃŸen). Ãœberlappende StÃ¤dte: ein Extract via Viewport-Switch.
 */
export const DISPLAY_WIDE_RADIUS_M = 10_000;

/**
 * Volles Extract wenn klein genug; sonst Clip um GPS (WebView-Schutz â€”
 * 3â€“13 MB JSON + 10k GebÃ¤ude killt sonst Android/MapLibre).
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
  const caps = mapExtractCapsForRadius(radiusM);
  const maxBuildings = region ? 4_000 : caps.maxBuildings;
  return clipCityMapExtractForDisplay(
    extract,
    lat,
    lng,
    radiusM,
    maxBuildings,
    caps.maxRoads,
  );
}

export function clipCityMapExtractForDisplay(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  radiusM = 5200,
  maxBuildings?: number,
  maxRoads?: number,
): CityMapExtract {
  const caps = mapExtractCapsForRadius(radiusM);
  const capBuildings = maxBuildings ?? caps.maxBuildings;
  const capRoads = maxRoads ?? caps.maxRoads;
  const dLat = radiusM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = radiusM / (111_320 * Math.max(0.2, cos));
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;
  const hit = (ring?: Array<[number, number]>) =>
    ringTouchesBox(ring, south, north, west, east);
  // Cap bewusst unter 5500 â€” pickRoads wechselt Inhalt bei jedem Reclip;
  // zu viele Features â†’ MapLibre ShapeSource-Sturm â†’ Kamera-Snap.
  return {
    v: extract.v,
    cityId: extract.cityId,
    bbox: { south, west, north, east },
    roads: pickRoadsForDisplay(extract.roads, lat, lng, hit, capRoads),
    buildings: pickNearestBuildings(
      extract.buildings,
      lat,
      lng,
      hit,
      capBuildings,
    ),
    water: extract.water.filter(hit),
    parks: extract.parks.filter(hit),
    woods: extract.woods.filter(hit),
    land: (extract.land || []).filter(hit).slice(0, 80),
    rails: extract.rails.filter(hit),
    // Keine Hausnummern auf der Karte â€” Adress-Nav lÃ¤uft Ã¼ber Geocode/Suche.
    housenumbers: [],
    graph: EMPTY_GRAPH,
  };
}

function roadMergeKey(r: CityMapExtractRoad): string {
  const c = r.c;
  if (!c?.length) return `${r.k}:${r.n || ''}:empty`;
  const a = c[0]!;
  const b = c[c.length - 1]!;
  return `${r.k}:${r.n || ''}:${a[0].toFixed(5)},${a[1].toFixed(5)}:${b[0].toFixed(5)},${b[1].toFixed(5)}:${c.length}`;
}

function ringMergeKey(ring: Array<[number, number]>): string {
  if (!ring?.length) return '';
  const a = ring[0]!;
  return `${ring.length}:${a[0].toFixed(5)},${a[1].toFixed(5)}`;
}

function mergePolyRings(
  a: Array<Array<[number, number]>>,
  b: Array<Array<[number, number]>>,
  cap: number,
): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  const seen = new Set<string>();
  for (const ring of [...a, ...b]) {
    const k = ringMergeKey(ring);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(ring);
    if (out.length >= cap) break;
  }
  return out;
}

/** Stadtwechsel: neue Stadt dazu, alte Nachbar-Geometrie behalten (Prisdorf + Pinneberg). */
export function mergeCityMapExtracts(
  prev: CityMapExtract,
  next: CityMapExtract,
  primaryCityId: string,
): CityMapExtract {
  const roads: CityMapExtractRoad[] = [];
  const roadSeen = new Set<string>();
  for (const r of [...(prev.roads || []), ...(next.roads || [])]) {
    const k = roadMergeKey(r);
    if (roadSeen.has(k)) continue;
    roadSeen.add(k);
    roads.push(r);
  }
  const buildings: Array<Array<[number, number]>> = [];
  const bSeen = new Set<string>();
  for (const ring of [...(prev.buildings || []), ...(next.buildings || [])]) {
    const k = ringMergeKey(ring);
    if (!k || bSeen.has(k)) continue;
    bSeen.add(k);
    buildings.push(ring);
    if (buildings.length >= 3_600) break;
  }
  const pb = prev.bbox;
  const nb = next.bbox;
  return {
    v: Math.max(prev.v, next.v),
    cityId: primaryCityId.toLowerCase(),
    bbox: {
      south: Math.min(pb.south, nb.south),
      west: Math.min(pb.west, nb.west),
      north: Math.max(pb.north, nb.north),
      east: Math.max(pb.east, nb.east),
    },
    roads: roads.slice(0, 5_500),
    buildings,
    water: mergePolyRings(prev.water || [], next.water || [], 120),
    parks: mergePolyRings(prev.parks || [], next.parks || [], 120),
    woods: mergePolyRings(prev.woods || [], next.woods || [], 80),
    land: mergePolyRings(prev.land || [], next.land || [], 100),
    rails: mergePolyRings(prev.rails || [], next.rails || [], 80),
    housenumbers: [],
    graph: EMPTY_GRAPH,
  };
}

/** Gebäude-Hit-Test Chunk — klein halten, damit Mic/Chrome atmen. */
export const EXTRACT_BUILDING_CLIP_CHUNK = 800;
/** Scoring/Sort Chunk für pickNearestBuildingsAsync. */
export const EXTRACT_BUILDING_SCORE_CHUNK = 600;

function chromeBusyNow(): boolean {
  try {
    const {
      isVoiceLaneBusy,
      isOverlayBusy,
    } = require('../boot/interactiveBootGate') as {
      isVoiceLaneBusy: () => boolean;
      isOverlayBusy: () => boolean;
    };
    return isVoiceLaneBusy() || isOverlayBusy();
  } catch {
    return false;
  }
}

/**
 * Main-Thread-Yield. Bei Mic/Chrome länger warten — Gebäude-Clip hinter Lane C/B.
 */
function yieldToMainThread(preferChrome = false): Promise<void> {
  const ms = preferChrome && chromeBusyNow() ? 32 : 0;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wie pickNearestBuildings, aber Scoring in Chunks + Yields (kein Sync-Spike auf 10k).
 */
async function pickNearestBuildingsAsync(
  buildings: CityMapExtract['buildings'],
  lat: number,
  lng: number,
  maxBuildings: number,
): Promise<CityMapExtract['buildings']> {
  if (buildings.length <= maxBuildings) return buildings;
  const scored: Array<{ ring: CityMapExtract['buildings'][number]; d2: number }> =
    [];
  const CHUNK = EXTRACT_BUILDING_SCORE_CHUNK;
  for (let i = 0; i < buildings.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, buildings.length);
    for (let j = i; j < end; j += 1) {
      const ring = buildings[j]!;
      const p = ring[0];
      const dLat = p ? p[0] - lat : 99;
      const dLng = p ? p[1] - lng : 99;
      scored.push({ ring, d2: dLat * dLat + dLng * dLng });
    }
    if (end < buildings.length) {
      await yieldToMainThread(true);
    }
  }
  scored.sort((a, b) => a.d2 - b.d2);
  await yieldToMainThread(true);
  const out: CityMapExtract['buildings'] = [];
  for (let i = 0; i < maxBuildings; i += 1) {
    out.push(scored[i]!.ring);
  }
  return out;
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
  const caps = mapExtractCapsForRadius(radiusM);
  const maxBuildings = region ? 4_000 : caps.maxBuildings;
  return clipCityMapExtractForDisplayAsync(
    extract,
    lat,
    lng,
    radiusM,
    maxBuildings,
    caps.maxRoads,
  );
}

export async function clipCityMapExtractForDisplayAsync(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  radiusM = 5200,
  maxBuildings?: number,
  maxRoads?: number,
): Promise<CityMapExtract> {
  const caps = mapExtractCapsForRadius(radiusM);
  const capBuildings = maxBuildings ?? caps.maxBuildings;
  const capRoads = maxRoads ?? caps.maxRoads;
  const dLat = radiusM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = radiusM / (111_320 * Math.max(0.2, cos));
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;
  const hit = (ring?: Array<[number, number]>) =>
    ringTouchesBox(ring, south, north, west, east);

  // Straßen zuerst — Chrome bleibt frei; Gebäude bewusst danach.
  const roads = pickRoadsForDisplay(extract.roads, lat, lng, hit, capRoads);
  await yieldToMainThread(true);

  // Gebäude-Hit-Test gestückelt; bei Mic/Chrome extra Pause.
  const inBox: typeof extract.buildings = [];
  const srcB = extract.buildings;
  const CHUNK = EXTRACT_BUILDING_CLIP_CHUNK;
  for (let i = 0; i < srcB.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, srcB.length);
    for (let j = i; j < end; j += 1) {
      const b = srcB[j]!;
      if (hit(b)) inBox.push(b);
    }
    if (end < srcB.length) {
      await yieldToMainThread(true);
    }
  }
  const buildings = await pickNearestBuildingsAsync(
    inBox,
    lat,
    lng,
    capBuildings,
  );

  const water = extract.water.filter(hit);
  await yieldToMainThread(true);
  const parks = extract.parks.filter(hit);  const woods = extract.woods.filter(hit);
  const land = (extract.land || []).filter(hit).slice(0, 80);
  const rails = extract.rails.filter(hit);
  // Keine Hausnummern im Display-Clip â€” Karte bleibt leicht; Adress-Nav = Geocode.
  const housenumbers: CityMapExtract['housenumbers'] = [];

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
