/**
 * Tour-Folgeben: echte Fuß-/Gleis-Pfade im Hintergrund cachen.
 * Seed aus Journey-Geometrie; sonst FOSSGIS-Fuß / OSM-Rail.
 * Cap + Clear bei Nav-Ende → 8h-Sessions bleiben fresh.
 */

import { fetchRouteDirectionsResult } from './googleMapsNav';
import { notifyNavRouteGeometryChanged } from './navRouteRev';

export type AheadCoord = {
  lat: number;
  lng: number;
  role?: string | null;
  path?: AheadCoord[] | null;
  vehicleMode?: string | null;
};

const CACHE_MAX = 32;
const FAIL_TTL_MS = 45_000;

const cache = new Map<string, AheadCoord[]>();
const failedAt = new Map<string, number>();
const inflight = new Set<string>();

function legKey(a: AheadCoord, b: AheadCoord): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(a.lat)},${r(a.lng)}>${r(b.lat)},${r(b.lng)}`;
}

function seedPath(a: AheadCoord, b: AheadCoord): AheadCoord[] | null {
  const fromB = Array.isArray(b.path) && b.path.length >= 2 ? b.path : null;
  if (fromB) return fromB;
  const fromA = Array.isArray(a.path) && a.path.length >= 2 ? a.path : null;
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

function evictOldestIfNeeded(): void {
  while (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

function putCache(key: string, coords: AheadCoord[]): void {
  if (cache.has(key)) cache.delete(key);
  evictOldestIfNeeded();
  cache.set(key, coords);
}

export function peekTourAheadLeg(
  a: AheadCoord,
  b: AheadCoord,
): AheadCoord[] | null {
  const hit = cache.get(legKey(a, b));
  return hit && hit.length >= 2 ? hit : null;
}

async function fetchLeg(a: AheadCoord, b: AheadCoord): Promise<void> {
  const key = legKey(a, b);
  if (inflight.has(key) || cache.has(key)) return;
  const fail = failedAt.get(key);
  if (fail != null && Date.now() - fail < FAIL_TTL_MS) return;
  inflight.add(key);
  try {
    const result = await fetchRouteDirectionsResult(a, b, 'walking');
    const pts = result?.pathPoints;
    if (Array.isArray(pts) && pts.length >= 2) {
      const coords = pts.map((p) => ({ lat: p.lat, lng: p.lng }));
      putCache(key, coords);
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
  const key = legKey(a, b);
  if (inflight.has(key) || cache.has(key)) return;
  const fail = failedAt.get(key);
  if (fail != null && Date.now() - fail < FAIL_TTL_MS) return;
  inflight.add(key);
  try {
    const { fetchOsmRailPath } = require('../transit/osmTransitGeom') as {
      fetchOsmRailPath: (
        from: { lat: number; lng: number },
        to: { lat: number; lng: number },
      ) => Promise<Array<{ lat: number; lng: number }>>;
    };
    const pts = await fetchOsmRailPath(a, b);
    if (Array.isArray(pts) && pts.length >= 3) {
      putCache(
        key,
        pts.map((p) => ({ lat: p.lat, lng: p.lng })),
      );
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

/** Restliche Stopps als Paare — holt echte Fuß-/Gleisrouten im Hintergrund. */
export function ensureTourAheadRoutes(stops: AheadCoord[]): void {
  if (!Array.isArray(stops) || stops.length < 2) return;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    const key = legKey(a, b);
    if (cache.has(key) || inflight.has(key)) continue;

    const seeded = seedPath(a, b);
    if (seeded && seeded.length >= 3) {
      putCache(key, seeded);
      continue;
    }

    const destWalk =
      b.role === 'dest' || b.role === 'walk' || b.role === 'transfer';
    if (destWalk) {
      void fetchLeg(a, b);
      continue;
    }

    if (isTransitRole(b.role) || isRailMode(b.vehicleMode)) {
      if (isBusMode(b.vehicleMode)) {
        // SEV/Bus: Straße, nicht Gleis.
        void fetchLeg(a, b);
      } else {
        void fetchRailLeg(a, b);
      }
      continue;
    }

    void fetchLeg(a, b);
  }
}

export function clearLookAheadRouteCache(): void {
  cache.clear();
  inflight.clear();
  failedAt.clear();
}

/** Test/Diagnose — Cache-Größe nach Caps. */
export function lookAheadRouteCacheSize(): number {
  return cache.size;
}
