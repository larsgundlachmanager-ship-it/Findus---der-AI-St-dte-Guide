/**
 * Snapshot der aktiven Nav-Route — nach Auto-Reroute wiederherstellbar.
 */

import type { NavWaypoint } from './navigationTypes';
import type { PedestrianTravelMode } from './googleMapsNav';

export type NavRouteSnapshot = {
  waypoints: NavWaypoint[];
  stations: NavWaypoint[];
  dest: {
    poiId: number;
    name: string;
    lat: number;
    lng: number;
  };
  navTotalDistanceM: number | null;
  navEtaMin: number | null;
  waypointIndex: number;
  travelMode: PedestrianTravelMode | null;
  savedAtMs: number;
};

let snapshot: NavRouteSnapshot | null = null;

export function saveNavRouteSnapshot(next: NavRouteSnapshot): void {
  if (!next.waypoints.length) return;
  snapshot = {
    ...next,
    waypoints: next.waypoints.slice(),
    stations: next.stations.slice(),
    savedAtMs: Date.now(),
  };
}

export function peekNavRouteSnapshot(): NavRouteSnapshot | null {
  return snapshot;
}

export function takeNavRouteSnapshot(): NavRouteSnapshot | null {
  const s = snapshot;
  snapshot = null;
  return s;
}

export function clearNavRouteSnapshot(): void {
  snapshot = null;
}

export function hasNavRouteSnapshot(): boolean {
  return snapshot != null && snapshot.waypoints.length >= 2;
}
