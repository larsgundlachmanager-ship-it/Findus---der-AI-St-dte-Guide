/**
 * Regional fallback DE (~6 MB) / EU (~12 MB) — tile lazy load ±50 km.
 */

import * as FileSystem from 'expo-file-system';
import { useRegionalFallbackStore } from '../../store/useRegionalFallbackStore';
import type { GeoJsonFc } from './cityMapExtractGeojson';

export type RegionalTier = 'none' | 'de' | 'eu';

export type RegionalTileIndex = {
  v: number;
  tier: RegionalTier;
  tileDeg: number;
  tiles: Array<{
    id: string;
    west: number;
    south: number;
    east: number;
    north: number;
    file: string;
  }>;
};

export type RegionalFallbackSnap = {
  tier: RegionalTier;
  centerLat: number;
  centerLng: number;
  geojson: GeoJsonFc;
  atMs: number;
};

const DOC = FileSystem.documentDirectory;
const MAPS_DIR = DOC ? `${DOC}maps/` : null;
const LOAD_RADIUS_M = 50_000;
const RELOAD_M = 30_000;

let activeSnap: RegionalFallbackSnap | null = null;
let loadInflight: Promise<RegionalFallbackSnap | null> | null = null;

function mapsPath(rel: string): string | null {
  if (!MAPS_DIR) return null;
  return `${MAPS_DIR}${rel}`;
}

export function tierForLatLng(lat: number, lng: number): RegionalTier {
  const inDe = lng > 5.5 && lng < 15.4 && lat > 47.2 && lat < 55.2;
  if (inDe) return 'de';
  const inEu = lng > -12 && lng < 32 && lat > 35 && lat < 72;
  if (inEu) return 'eu';
  return 'none';
}

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * 111_320 * Math.max(0.2, cos);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function tileIntersectsRadius(
  tile: RegionalTileIndex['tiles'][0],
  lat: number,
  lng: number,
  radiusM: number,
): boolean {
  const dLat = radiusM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = radiusM / (111_320 * Math.max(0.2, cos));
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;
  return !(
    tile.east < west ||
    tile.west > east ||
    tile.north < south ||
    tile.south > north
  );
}

export async function loadRegionalTileIndex(
  tier: RegionalTier,
): Promise<RegionalTileIndex | null> {
  const p = mapsPath(`${tier}/index.json`);
  if (!p) return null;
  try {
    const info = await FileSystem.getInfoAsync(p);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(p);
    return JSON.parse(raw) as RegionalTileIndex;
  } catch {
    return null;
  }
}

async function mergeTiles(
  tier: RegionalTier,
  lat: number,
  lng: number,
): Promise<GeoJsonFc | null> {
  const index = await loadRegionalTileIndex(tier);
  if (!index?.tiles?.length) return null;
  const hits = index.tiles.filter((t) =>
    tileIntersectsRadius(t, lat, lng, LOAD_RADIUS_M),
  );
  if (!hits.length) return null;
  const features: GeoJsonFc['features'] = [];
  for (const tile of hits.slice(0, 4)) {
    const p = mapsPath(`${tier}/${tile.file}`);
    if (!p) continue;
    try {
      const info = await FileSystem.getInfoAsync(p);
      if (!info.exists) continue;
      const raw = await FileSystem.readAsStringAsync(p);
      const fc = JSON.parse(raw) as GeoJsonFc;
      if (Array.isArray(fc?.features)) features.push(...fc.features);
    } catch {
      /* skip tile */
    }
  }
  if (!features.length) return null;
  return { type: 'FeatureCollection', features };
}

export async function ensureRegionalFallback(
  lat: number,
  lng: number,
): Promise<RegionalFallbackSnap | null> {
  const tier = tierForLatLng(lat, lng);
  if (tier === 'none') {
    activeSnap = null;
    useRegionalFallbackStore.getState().setSnap(null);
    return null;
  }
  if (
    activeSnap &&
    activeSnap.tier === tier &&
    metersBetween(
      { lat: activeSnap.centerLat, lng: activeSnap.centerLng },
      { lat, lng },
    ) < RELOAD_M
  ) {
    return activeSnap;
  }
  if (loadInflight) return loadInflight;
  loadInflight = (async () => {
    try {
      const geojson = await mergeTiles(tier, lat, lng);
      if (!geojson) return null;
      activeSnap = {
        tier,
        centerLat: lat,
        centerLng: lng,
        geojson,
        atMs: Date.now(),
      };
      useRegionalFallbackStore.getState().setSnap(activeSnap);
      return activeSnap;
    } finally {
      loadInflight = null;
    }
  })();
  return loadInflight;
}

export function peekRegionalFallback(): RegionalFallbackSnap | null {
  return activeSnap;
}

export async function prefetchRegionalFallbackForGps(
  lat: number,
  lng: number,
): Promise<void> {
  void import('./regionalFallbackPrefetch')
    .then((m) => m.syncRegionalFallbackTilesForGps(lat, lng))
    .then(() => ensureRegionalFallback(lat, lng))
    .catch(() => undefined);
}
