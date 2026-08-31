/**
 * Schlanker Pin-Index pro installierter Stadt (nicht das volle Pack).
 * Viewport lädt Nachbarstädte aus Cache, ohne SQLite zu tauschen.
 */

import * as FileSystem from 'expo-file-system';
import {
  listKnownCityCoverageBounds,
  type CityCoverageBounds,
} from '../discovery/cityCoverageBounds';
import {
  isAxisAlignedBoxPolygon,
  parsePolygonJson,
} from '../geo/polygon';

type PinSource = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  kind?: string | null;
  category?: string | null;
  radius_meters?: number;
  polygon_json?: string | null;
  tags_json?: string | null;
};

export type MapPin = {
  id: number;
  cityId: string;
  name: string;
  lat: number;
  lng: number;
  kind: string;
  category: string | null;
  radiusM: number;
  story: 0 | 1;
  /** Modul-1 würde auslösen (aus Pack-Tags, ohne Live-Prefs). */
  liked: 0 | 1;
  ring?: Array<[number, number]> | null;
};

const DOC = FileSystem.documentDirectory;
const DIR = DOC ? `${DOC}cities/` : null;
const mem = new Map<string, MapPin[]>();

function pathFor(cityId: string): string | null {
  if (!DIR) return null;
  return `${DIR}${cityId.toLowerCase()}.pins.json`;
}

export function evictMapPinIndex(cityId: string): void {
  mem.delete(cityId.trim().toLowerCase());
}

export async function deleteMapPinIndexFile(cityId: string): Promise<void> {
  evictMapPinIndex(cityId);
  const p = pathFor(cityId);
  if (!p) return;
  try {
    await FileSystem.deleteAsync(p, { idempotent: true });
  } catch {
    /* soft */
  }
}

function isStoryKind(kind: string | null | undefined): boolean {
  const k = kind ?? 'legacy';
  return k !== 'approach' && k !== 'sub' && k !== 'directory';
}

/** Schneller Liked-Hint aus Pack-Tags (kein Profil-Gate). */
function isLikedPinSource(p: PinSource): boolean {
  const tags = String(p.tags_json ?? '').toLowerCase();
  if (!tags) return false;
  if (tags.includes('directory') || tags.includes('amenity_skip')) return false;
  return (
    tags.includes('module1') ||
    tags.includes('"modul1"') ||
    tags.includes('tier1') ||
    tags.includes('tier2') ||
    tags.includes('must_have')
  );
}

function slimPinRing(
  ring: Array<[number, number]> | null,
): Array<[number, number]> | null {
  if (!ring || ring.length < 3) return null;
  if (ring.length <= 24) return ring;
  const step = Math.max(1, Math.ceil(ring.length / 20));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]!);
  const last = ring[ring.length - 1];
  const head = out[0];
  if (!head) return ring.slice(0, 24);
  if (last && (last[0] !== head[0] || last[1] !== head[1])) out.push(last);
  return out;
}

function ringFromPinSource(p: PinSource): Array<[number, number]> | null {
  const poly = parsePolygonJson(p.polygon_json);
  if (!poly || poly.length < 3) return null;
  const lats = poly.map((x) => x.latitude);
  const lngs = poly.map((x) => x.longitude);
  const dLat = Math.max(...lats) - Math.min(...lats);
  const dLng = Math.max(...lngs) - Math.min(...lngs);
  const approxM = Math.hypot(dLat * 111_320, dLng * 111_320 * 0.6);
  if (approxM > 350 && poly.length <= 6) return null;
  if (isAxisAlignedBoxPolygon(poly) && approxM > 90) return null;
  return slimPinRing(
    poly.map((x) => [x.latitude, x.longitude] as [number, number]),
  );
}

export function pinsFromRemotePois(
  cityId: string,
  pois: PinSource[],
): MapPin[] {
  const id = cityId.trim().toLowerCase();
  const out: MapPin[] = [];
  for (const p of pois) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const kind = p.kind ?? 'legacy';
    if (kind === 'approach' || kind === 'sub') continue;
    out.push({
      id: p.id,
      cityId: id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      kind,
      category: p.category ?? null,
      radiusM: Math.max(18, Math.min(80, p.radius_meters || 30)),
      story: isStoryKind(kind) ? 1 : 0,
      liked: isLikedPinSource(p) ? 1 : 0,
      ring: ringFromPinSource(p),
    });
  }
  return out;
}

export function peekMapPinIndex(cityId: string): MapPin[] | null {
  const hit = mem.get(cityId.trim().toLowerCase());
  return hit ?? null;
}

export async function writeMapPinIndex(
  cityId: string,
  pois: PinSource[],
): Promise<void> {
  const id = cityId.trim().toLowerCase();
  const pins = pinsFromRemotePois(id, pois);
  mem.set(id, pins);
  await persistPinIndex(id, pins);
}

/** Einzelne Pins mergen (neue User-Orte), ohne den Rest zu löschen. */
export async function upsertMapPins(
  cityId: string,
  pois: PinSource[],
): Promise<void> {
  const id = cityId.trim().toLowerCase();
  const incoming = pinsFromRemotePois(id, pois);
  if (!incoming.length) return;
  const existing = mem.get(id) ?? (await loadMapPinIndex(id));
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const pin of incoming) byId.set(pin.id, pin);
  const merged = [...byId.values()];
  mem.set(id, merged);
  await persistPinIndex(id, merged);
}

async function persistPinIndex(id: string, pins: MapPin[]): Promise<void> {
  const p = pathFor(id);
  if (!p || !DIR) return;
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    }
    await FileSystem.writeAsStringAsync(p, JSON.stringify(pins), {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    /* soft */
  }
}

export async function loadMapPinIndex(cityId: string): Promise<MapPin[]> {
  const id = cityId.trim().toLowerCase();
  const hit = mem.get(id);
  if (hit) return hit;
  const p = pathFor(id);
  if (p) {
    try {
      const info = await FileSystem.getInfoAsync(p);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(p);
        const parsed = JSON.parse(raw) as MapPin[];
        if (Array.isArray(parsed)) {
          const normalized = parsed.map((pin) => ({
            ...pin,
            liked: pin.liked === 1 ? 1 : 0,
            story: pin.story === 1 ? 1 : 0,
          }));
          mem.set(id, normalized);
          return normalized;
        }
      }
    } catch {
      /* rebuild from pack */
    }
  }
  const rebuilt = await rebuildPinIndexFromCachedPack(id);
  return rebuilt;
}

async function rebuildPinIndexFromCachedPack(cityId: string): Promise<MapPin[]> {
  try {
    const { loadCityPackCachedOrRemote } = await import('../cityCatalogService');
    const { mapCityPackToRemote } = await import('../cityPack');
    const pack = await loadCityPackCachedOrRemote(cityId);
    const mapped = mapCityPackToRemote(pack);
    await writeMapPinIndex(cityId, mapped.pois);
    try {
      const { listLearnedPoisForCity } = await import('../../db/learnedPoiOverlay');
      const learned = await listLearnedPoisForCity(cityId);
      if (learned.length) await upsertMapPins(cityId, learned);
    } catch {
      /* soft */
    }
    return mem.get(cityId) ?? [];
  } catch {
    mem.set(cityId, []);
    return [];
  }
}

type ViewBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

function padView(view: ViewBox, factor: number): ViewBox {
  const dLat = Math.max(0.004, (view.north - view.south) * factor);
  const dLng = Math.max(0.006, (view.east - view.west) * factor);
  return {
    south: view.south - dLat,
    north: view.north + dLat,
    west: view.west - dLng,
    east: view.east + dLng,
  };
}

function overlaps(b: CityCoverageBounds, view: ViewBox): boolean {
  return (
    b.latMin <= view.north &&
    b.latMax >= view.south &&
    b.lngMin <= view.east &&
    b.lngMax >= view.west
  );
}

function pinInView(p: MapPin, view: ViewBox): boolean {
  return (
    p.lat >= view.south &&
    p.lat <= view.north &&
    p.lng >= view.west &&
    p.lng <= view.east
  );
}

/** Stabile negative Overlay-Ids — kollidieren nicht mit SQLite der Aktiv-Stadt. */
export function overlayPinId(cityId: string, poiId: number): number {
  let h = poiId | 0;
  for (let i = 0; i < cityId.length; i += 1) {
    h = (Math.imul(h, 33) + cityId.charCodeAt(i)) | 0;
  }
  return h < 0 ? h : -h - 1;
}

export async function loadNeighborPinsInViewport(opts: {
  view: ViewBox;
  activeCityId: string | null;
  bufferFactor?: number;
}): Promise<MapPin[]> {
  const active = (opts.activeCityId ?? '').trim().toLowerCase();
  const padded = padView(opts.view, opts.bufferFactor ?? 0.35);
  const cities = listKnownCityCoverageBounds().filter(
    (b) => b.cityId !== active && overlaps(b, padded),
  );
  const { isCityPackCachedOnDevice } = await import('../cityCatalogService');
  const out: MapPin[] = [];
  for (const b of cities) {
    const cached = await isCityPackCachedOnDevice(b.cityId);
    if (!cached && !mem.has(b.cityId)) continue;
    const pins = await loadMapPinIndex(b.cityId);
    for (const p of pins) {
      if (pinInView(p, padded)) out.push(p);
    }
  }
  return out;
}

export async function warmNearbyPinIndexes(opts: {
  activeCityId: string | null;
  lat: number | null;
  lng: number | null;
}): Promise<void> {
  const lat = opts.lat;
  const lng = opts.lng;
  const view: ViewBox =
    lat != null && lng != null
      ? {
          south: lat - 0.04,
          north: lat + 0.04,
          west: lng - 0.06,
          east: lng + 0.06,
        }
      : { south: 0, west: 0, north: 0, east: 0 };
  const cities = listKnownCityCoverageBounds().filter((b) => {
    if (b.cityId === (opts.activeCityId ?? '').toLowerCase()) return true;
    if (lat == null || lng == null) return false;
    return overlaps(b, view);
  });
  const { isCityPackCachedOnDevice } = await import('../cityCatalogService');
  for (const b of cities.slice(0, 8)) {
    const cached = await isCityPackCachedOnDevice(b.cityId);
    if (!cached) continue;
    await loadMapPinIndex(b.cityId);
  }
}
