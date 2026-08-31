/**
 * OSRM/Directions für die restlichen Tour-Beine — nicht Luftlinie auf der Karte.
 */

import {
  fetchRouteDirectionsResult,
  type PedestrianTravelMode,
} from './googleMapsNav';
import { decodePolyline } from './routeSpline';
import { notifyNavRouteGeometryChanged } from './navRouteRev';
import { resolveActiveTravelMode } from './travelModeContext';

export type AheadCoord = {
  lat: number;
  lng: number;
  role?: string | null;
  path?: AheadCoord[] | null;
  vehicleMode?: string | null;
};

function seedPath(a: AheadCoord, b: AheadCoord): AheadCoord[] | null {
  const fromB = Array.isArray(b.path) && b.path.length >= 3 ? b.path : null;
  if (fromB) return fromB;
  const fromA = Array.isArray(a.path) && a.path.length >= 3 ? a.path : null;
  if (fromA) return fromA;
  return null;
}

function isTransitRole(role: string | null | undefined): boolean {
  return role === 'alight' || role === 'board';
}

function isRailMode(mode: string | null | undefined): boolean {
  const m = (mode || '').toUpperCase();
  return m === 'RAIL' || m === 'SUBWAY' || m === 'TRAM' || m === 'TRANSIT';
}

function isBusMode(mode: string | null | undefined): boolean {
  return (mode || '').toUpperCase() === 'BUS';
}

const cache = new Map<string, AheadCoord[]>();
const inflight = new Set<string>();
const failedAt = new Map<string, number>();
const FAIL_RETRY_MS = 20_000;

function roundKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function aheadLegKey(
  a: AheadCoord,
  b: AheadCoord,
): string {
  return `${roundKey(a.lat, a.lng)}>${roundKey(b.lat, b.lng)}`;
}

export function peekTourAheadLeg(
  a: AheadCoord,
  b: AheadCoord,
): AheadCoord[] | null {
  return cache.get(aheadLegKey(a, b)) ?? seedPath(a, b);
}

function coordsFromResult(
  result: Awaited<ReturnType<typeof fetchRouteDirectionsResult>>,
): AheadCoord[] {
  if (!result) return [];
  if (result.overviewPolyline) {
    const pts = decodePolyline(result.overviewPolyline);
    if (pts.length >= 2) return pts;
  }
  if (result.pathPoints && result.pathPoints.length >= 2) {
    return result.pathPoints.map((p) => ({ lat: p.lat, lng: p.lng }));
  }
  return [];
}

function travelMode(): PedestrianTravelMode {
  try {
    return resolveActiveTravelMode().mode === 'bike' ? 'bicycling' : 'walking';
  } catch {
    return 'walking';
  }
}

async function fetchLeg(a: AheadCoord, b: AheadCoord): Promise<void> {
  const key = aheadLegKey(a, b);
  if (cache.has(key) || inflight.has(key)) return;
  const failed = failedAt.get(key);
  if (failed && Date.now() - failed < FAIL_RETRY_MS) return;
  inflight.add(key);
  try {
    const result = await fetchRouteDirectionsResult(a, b, travelMode());
    const coords = coordsFromResult(result);
    if (coords.length >= 2) {
      cache.set(key, coords);
      failedAt.delete(key);
      notifyNavRouteGeometryChanged();
    } else {
      failedAt.set(key, Date.now());
    }
  } catch {
    failedAt.set(key, Date.now());
  } finally {
    inflight.delete(key);
  }
}

async function fetchRailLeg(a: AheadCoord, b: AheadCoord): Promise<void> {
  const key = aheadLegKey(a, b);
  if (cache.has(key) || inflight.has(key)) return;
  const failed = failedAt.get(key);
  if (failed && Date.now() - failed < FAIL_RETRY_MS) return;
  inflight.add(key);
  try {
    const { fetchOsmRailPath } = await import('../transit/osmTransitGeom');
    const coords = await fetchOsmRailPath(a, b);
    if (coords.length >= 3) {
      cache.set(key, coords);
      failedAt.delete(key);
      notifyNavRouteGeometryChanged();
    } else {
      failedAt.set(key, Date.now());
    }
  } catch {
    failedAt.set(key, Date.now());
  } finally {
    inflight.delete(key);
  }
}

/** Restliche Stopps als Paare — holt echte Fuß-/Radrouten im Hintergrund. */
export function ensureTourAheadRoutes(stops: AheadCoord[]): void {
  if (stops.length < 2) return;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (!a || !b) continue;
    if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;
    const key = aheadLegKey(a, b);
    const seeded = seedPath(a, b);
    if (seeded && seeded.length >= 3) {
      cache.set(key, seeded);
      continue;
    }
    const destWalk =
      b.role === 'dest' || b.role === 'walk' || b.role === 'transfer';
    if (destWalk) {
      void fetchLeg(a, b);
      continue;
    }
    const mode = b.vehicleMode || a.vehicleMode;
    if (isBusMode(mode)) {
      void fetchLeg(a, b);
      continue;
    }
    if (isTransitRole(b.role) || isRailMode(mode)) {
      void fetchRailLeg(a, b);
      continue;
    }
    void fetchLeg(a, b);
  }
}

export function clearTourAheadRouteCache(): void {
  cache.clear();
  inflight.clear();
  failedAt.clear();
}
