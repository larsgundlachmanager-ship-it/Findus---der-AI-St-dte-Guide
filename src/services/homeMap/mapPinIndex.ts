/**
 * Schlanker Pin-Index pro installierter Stadt (nicht das volle Pack).
 * Viewport lädt Nachbarstädte aus Cache, ohne SQLite zu tauschen.
 *
 * Sichtbar gleichzeitig: bis MAP_VIEWPORT_PACK_CITY_LIMIT heruntergeladene Packs
 * (Orte / Icons / Gebäude-Umrisse im Ausschnitt) — Rest bleibt nur auf Disk.
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

/** Max. Packs gleichzeitig als Karten-Inhalt im Viewport (Erkunden / Nav). */
export const MAP_VIEWPORT_PACK_CITY_LIMIT = 3;
/** Slot 1: GPS-/Aufenthalts-Stadt bleibt immer (wenn Pack installiert). */
export const MAP_STICKY_PACK_SLOTS = 1;
/** Slots 2–3: Viewport-Städte wandern dynamisch mit (Hamburg→Berlin→…). */
export const MAP_BROWSE_PACK_SLOTS = 2;

/** Pin-Indexes warm im RAM (mehr als Paint-Limit — schneller Stadtwechsel). */
export const MAP_PIN_INDEX_WARM_LIMIT = 8;

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

function viewCenter(view: ViewBox): { lat: number; lng: number } {
  return {
    lat: (view.south + view.north) / 2,
    lng: (view.west + view.east) / 2,
  };
}

function distToViewCenterM(b: CityCoverageBounds, view: ViewBox): number {
  const c = viewCenter(view);
  const midLat = (b.latMin + b.latMax) / 2;
  const midLng = (b.lngMin + b.lngMax) / 2;
  const dLat = (midLat - c.lat) * 111_320;
  const dLng =
    (midLng - c.lng) * 111_320 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
  return Math.hypot(dLat, dLng);
}

/** Stabile negative Overlay-Ids — kollidieren nicht mit SQLite der Aktiv-Stadt. */
export function overlayPinId(cityId: string, poiId: number): number {
  let h = poiId | 0;
  for (let i = 0; i < cityId.length; i += 1) {
    h = (Math.imul(h, 33) + cityId.charCodeAt(i)) | 0;
  }
  return h < 0 ? h : -h - 1;
}

/**
 * Orte/Icons/Umrisse anderer heruntergeladener Packs im Viewport.
 *
 * Modell:
 * - stickyCityId (GPS/Aufenthalt): bleibt immer warm; wenn im Ausschnitt und
 *   ≠ Active-SQLite → mitzeichnen.
 * - bis MAP_BROWSE_PACK_SLOTS weitere Packs folgen dem Viewport dynamisch
 *   (Hamburg→Berlin→Danzig→Amsterdam; ältere wandern raus).
 * - Active-Stadt kommt aus SQLite (buildPlacePayloads), hier nicht doppelt.
 * - Nur vorinstallierte Packs.
 */
export async function loadNeighborPinsInViewport(opts: {
  view: ViewBox;
  activeCityId: string | null;
  /** GPS-Stadt — sticky, wandert nicht weg. */
  stickyCityId?: string | null;
  bufferFactor?: number;
  maxCities?: number;
}): Promise<MapPin[]> {
  const maxCities = Math.max(
    1,
    Math.min(6, opts.maxCities ?? MAP_VIEWPORT_PACK_CITY_LIMIT),
  );
  const active = (opts.activeCityId ?? '').trim().toLowerCase();
  const sticky = (opts.stickyCityId ?? '').trim().toLowerCase() || null;
  const padded = padView(opts.view, opts.bufferFactor ?? 0.35);
  const known = listKnownCityCoverageBounds();
  const { isCityPackCachedOnDevice } = await import('../cityCatalogService');

  const isCached = async (id: string): Promise<boolean> => {
    if (mem.has(id)) return true;
    return isCityPackCachedOnDevice(id);
  };

  // Active (SQLite) belegt einen Paint-Slot, wenn gesetzt.
  const paintBudget = Math.max(0, maxCities - (active ? 1 : 0));
  const paintIds: string[] = [];
  const tryAdd = async (id: string | null | undefined): Promise<void> => {
    const x = (id ?? '').trim().toLowerCase();
    if (!x || x === active || paintIds.includes(x)) return;
    if (paintIds.length >= paintBudget) return;
    if (!(await isCached(x))) return;
    paintIds.push(x);
  };

  // 1) Sticky zuerst, wenn Coverage den Viewport trifft.
  if (sticky && sticky !== active) {
    const stickyBounds = known.find((b) => b.cityId === sticky) ?? null;
    if (stickyBounds && overlaps(stickyBounds, padded)) {
      await tryAdd(sticky);
    } else if (await isCached(sticky)) {
      void loadMapPinIndex(sticky).catch(() => undefined);
    }
  } else if (sticky && (await isCached(sticky))) {
    void loadMapPinIndex(sticky).catch(() => undefined);
  }

  // 2) Viewport-Browse: nächste installierte Packs zum Zentrum.
  const candidates = known
    .filter(
      (b) =>
        b.cityId !== active &&
        !paintIds.includes(b.cityId) &&
        overlaps(b, padded),
    )
    .sort(
      (a, b) => distToViewCenterM(a, padded) - distToViewCenterM(b, padded),
    );

  for (const b of candidates) {
    if (paintIds.length >= paintBudget) break;
    const browseUsed = paintIds.filter((id) => id !== sticky).length;
    if (browseUsed >= MAP_BROWSE_PACK_SLOTS) break;
    await tryAdd(b.cityId);
  }

  const out: MapPin[] = [];
  for (const id of paintIds) {
    const pins = await loadMapPinIndex(id);
    for (const p of pins) {
      if (pinInView(p, padded)) out.push(p);
    }
  }

  retainWarmPinIndexes(
    new Set([
      ...(sticky ? [sticky] : []),
      ...(active ? [active] : []),
      ...paintIds,
    ]),
  );

  return out;
}

/** RAM: Sticky + aktuelle Viewport-Packs behalten; Rest raus wenn über Warm-Limit. */
function retainWarmPinIndexes(keep: Set<string>): void {
  if (mem.size <= MAP_PIN_INDEX_WARM_LIMIT) return;
  for (const id of [...mem.keys()]) {
    if (mem.size <= MAP_PIN_INDEX_WARM_LIMIT) break;
    if (keep.has(id)) continue;
    mem.delete(id);
  }
}

export async function warmNearbyPinIndexes(opts: {
  activeCityId: string | null;
  stickyCityId?: string | null;
  lat: number | null;
  lng: number | null;
}): Promise<void> {
  const lat = opts.lat;
  const lng = opts.lng;
  const sticky = (opts.stickyCityId ?? '').trim().toLowerCase() || null;
  const active = (opts.activeCityId ?? '').trim().toLowerCase() || null;
  const view: ViewBox =
    lat != null && lng != null
      ? {
          south: lat - 0.04,
          north: lat + 0.04,
          west: lng - 0.06,
          east: lng + 0.06,
        }
      : { south: 0, west: 0, north: 0, east: 0 };

  const { isCityPackCachedOnDevice } = await import('../cityCatalogService');
  const ordered: string[] = [];
  const push = (id: string | null) => {
    const x = (id ?? '').trim().toLowerCase();
    if (!x || ordered.includes(x)) return;
    ordered.push(x);
  };
  push(sticky);
  push(active);

  const cities = listKnownCityCoverageBounds()
    .filter((b) => {
      if (ordered.includes(b.cityId)) return false;
      if (lat == null || lng == null) return false;
      return overlaps(b, view);
    })
    .sort((a, b) => distToViewCenterM(a, view) - distToViewCenterM(b, view));

  for (const b of cities) {
    if (ordered.length >= MAP_PIN_INDEX_WARM_LIMIT) break;
    ordered.push(b.cityId);
  }

  for (const id of ordered.slice(0, MAP_PIN_INDEX_WARM_LIMIT)) {
    const cached = await isCityPackCachedOnDevice(id);
    if (!cached) continue;
    await loadMapPinIndex(id);
  }
  retainWarmPinIndexes(
    new Set([
      ...(sticky ? [sticky] : []),
      ...(active ? [active] : []),
      ...ordered.slice(0, MAP_VIEWPORT_PACK_CITY_LIMIT),
    ]),
  );
}
