/**
 * Sidewalk / user-side alignment for micro-waypoints.
 * Offsets arrow target toward the side the user is walking on.
 */

import { bearingDegrees, distanceMeters, shortestAngleDelta } from '../bearing';
import type { NavWaypoint } from '../navigationTypes';
import { SPLINE_SPACING_M } from '../routeSpline';

export const SIDEWALK_OFFSET_M = 3.5;
export const MIN_ACCURACY_M = 18;
export const MIN_ROAD_WIDTH_HINT_M = 8;

function offsetLatLng(
  lat: number,
  lng: number,
  bearingDeg: number,
  meters: number,
): { lat: number; lng: number } {
  const R = 6_371_000;
  const br = (bearingDeg * Math.PI) / 180;
  const dR = meters / R;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) +
      Math.cos(lat1) * Math.sin(dR) * Math.cos(br),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(dR) * Math.cos(lat1),
      Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: ((lng2 * 180) / Math.PI + 540) % 360 - 180 };
}

/**
 * Signed lateral offset: positive = user is to the right of path direction.
 */
export function lateralOffsetM(opts: {
  userLat: number;
  userLng: number;
  pathLat: number;
  pathLng: number;
  pathBearingDeg: number;
}): number {
  const toUser = bearingDegrees(
    opts.pathLat,
    opts.pathLng,
    opts.userLat,
    opts.userLng,
  );
  const rel = shortestAngleDelta(opts.pathBearingDeg, toUser);
  const dist = distanceMeters(
    opts.pathLat,
    opts.pathLng,
    opts.userLat,
    opts.userLng,
  );
  // Approximate cross-track: sin(rel) * dist
  return Math.sin((rel * Math.PI) / 180) * dist;
}

/**
 * Densify with tighter spacing near turns + optional side offset for arrow targets.
 */
export function alignWaypointsForUserSide(opts: {
  waypoints: NavWaypoint[];
  userLat: number;
  userLng: number;
  gpsAccuracyM?: number | null;
  fromIndex?: number;
}): NavWaypoint[] {
  const wps = opts.waypoints;
  if (wps.length < 2) return wps;
  const acc = opts.gpsAccuracyM ?? 25;
  if (acc > MIN_ACCURACY_M) return wps;

  const from = Math.max(0, opts.fromIndex ?? 0);
  const i0 = Math.min(from, wps.length - 2);
  const a = wps[i0];
  const b = wps[i0 + 1];
  const pathBearing = bearingDegrees(a.lat, a.lng, b.lat, b.lng);
  const lateral = lateralOffsetM({
    userLat: opts.userLat,
    userLng: opts.userLng,
    pathLat: a.lat,
    pathLng: a.lng,
    pathBearingDeg: pathBearing,
  });

  // Need clear side preference
  if (Math.abs(lateral) < 1.2) return wps;
  if (Math.abs(lateral) > 14) return wps; // likely off-route / canyon

  const sideSign = lateral > 0 ? 1 : -1;
  const offsetBearing = (pathBearing + sideSign * 90 + 360) % 360;
  const offsetM = Math.min(SIDEWALK_OFFSET_M, Math.abs(lateral) * 0.65);

  return wps.map((wp, idx) => {
    // Only nudge upcoming points within ~120 m window
    if (idx < from || idx > from + Math.ceil(120 / SPLINE_SPACING_M)) return wp;
    const nudged = offsetLatLng(wp.lat, wp.lng, offsetBearing, offsetM);
    return {
      ...wp,
      // Keep original lat/lng for map-match; expose arrow target via meta fields if present
      arrowLat: nudged.lat,
      arrowLng: nudged.lng,
    } as NavWaypoint & { arrowLat: number; arrowLng: number };
  });
}

/**
 * Prefer denser spacing in the last 40 m before a turn (caller rebuilds spline).
 */
export function spacingForSegmentM(opts: {
  metersToNextTurn: number | null;
}): number {
  if (
    opts.metersToNextTurn != null &&
    opts.metersToNextTurn >= 0 &&
    opts.metersToNextTurn <= 40
  ) {
    return 8;
  }
  return SPLINE_SPACING_M;
}

export function arrowTargetFromWaypoint(wp: NavWaypoint): {
  lat: number;
  lng: number;
} {
  const anyWp = wp as NavWaypoint & { arrowLat?: number; arrowLng?: number };
  if (
    typeof anyWp.arrowLat === 'number' &&
    typeof anyWp.arrowLng === 'number'
  ) {
    return { lat: anyWp.arrowLat, lng: anyWp.arrowLng };
  }
  return { lat: wp.lat, lng: wp.lng };
}
