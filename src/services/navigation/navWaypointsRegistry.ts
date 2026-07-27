import type { NavWaypoint } from './navigationTypes';

/** spot_key → baked nav waypoints (air-line fallback if empty). */
const waypointsBySpotKey = new Map<string, NavWaypoint[]>();

export function setNavWaypointsForSpot(
  spotKey: string,
  waypoints: NavWaypoint[],
): void {
  const key = spotKey.trim();
  if (!key) return;
  if (!waypoints.length) {
    waypointsBySpotKey.delete(key);
    return;
  }
  waypointsBySpotKey.set(
    key,
    waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
  );
}

export function getNavWaypointsForSpot(spotKey: string | null | undefined): NavWaypoint[] {
  if (!spotKey) return [];
  return waypointsBySpotKey.get(spotKey.trim()) ?? [];
}

export function clearNavWaypointsRegistry(): void {
  waypointsBySpotKey.clear();
}

export function registerNavWaypointsBulk(
  entries: Array<{ spotKey: string; waypoints: NavWaypoint[] }>,
): void {
  for (const e of entries) {
    setNavWaypointsForSpot(e.spotKey, e.waypoints);
  }
}
