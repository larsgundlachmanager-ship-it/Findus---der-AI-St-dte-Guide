/**
 * Smart Arrow — look-ahead bearing target for smooth compass on curved streets.
 * Decouples visual arrow from micro-waypoint breadcrumb snapping.
 */

import {
  bearingDegrees,
  distanceMeters,
  relativeBearingDeg,
  shortestAngleDelta,
} from './bearing';
import type { NavMode, NavWaypoint, TransportMode } from './navigationTypes';
import {
  interpolateSplineAt,
  type SplinePoint,
} from './routeSpline';
import { isTurnManeuver } from './navPredictiveCue';

export const ARROW_LOOKAHEAD_WALK_M = 25;
export const ARROW_LOOKAHEAD_BIKE_M = 45;
/** Ignore only tiny relative-bearing chatter (was 8° — felt sticky). */
export const ARROW_MIN_SMOOTH_DEG = 2;
/** Relative-bearing EMA — higher = needle tracks heading faster. */
export const ARROW_EMA_ALPHA = 0.5;
/** Clamp look-ahead this far before a sharp turn. */
export const ARROW_TURN_CLAMP_M = 8;

export type SmartArrowInput = {
  userLat: number;
  userLng: number;
  headingDeg: number;
  mode: NavMode;
  transportMode: TransportMode;
  waypoints: NavWaypoint[];
  waypointIndex: number;
  projectionIndex: number;
  alongM: number;
  spline: SplinePoint[];
  destination: { lat: number; lng: number; name: string };
};

export type SmartArrowResult = {
  lat: number;
  lng: number;
  name: string;
  bearingRelDeg: number;
  distanceToTargetM: number;
  pathBearingDeg: number;
};

let smoothedBearingRelDeg: number | null = null;

export function resetSmartArrow(): void {
  smoothedBearingRelDeg = null;
}

function lookAheadM(transportMode: TransportMode): number {
  return transportMode === 'bicycle'
    ? ARROW_LOOKAHEAD_BIKE_M
    : ARROW_LOOKAHEAD_WALK_M;
}

/** Next significant turn along-route from projection index. */
export function nextTurnAlongM(
  waypoints: NavWaypoint[],
  fromIndex: number,
): number | null {
  for (let i = fromIndex; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (!wp || !isTurnManeuver(wp.maneuver)) continue;
    if (typeof wp.splineAlongM === 'number') return wp.splineAlongM;
  }
  return null;
}

/** Meter along route until next Smart-Arrow turn knotenpunkt. */
export function distanceAlongRouteToNextTurnM(
  waypoints: NavWaypoint[],
  projectionIndex: number,
  alongM: number,
): number | null {
  const turnAlongM = nextTurnAlongM(waypoints, projectionIndex);
  if (turnAlongM == null) return null;
  return Math.max(0, turnAlongM - alongM);
}

function smoothRelativeBearing(rawRel: number): number {
  if (smoothedBearingRelDeg == null) {
    smoothedBearingRelDeg = rawRel;
    return rawRel;
  }
  const delta = shortestAngleDelta(smoothedBearingRelDeg, rawRel);
  if (Math.abs(delta) < ARROW_MIN_SMOOTH_DEG) {
    return smoothedBearingRelDeg;
  }
  smoothedBearingRelDeg =
    smoothedBearingRelDeg + ARROW_EMA_ALPHA * delta;
  return smoothedBearingRelDeg;
}

/**
 * Compute compass arrow target using look-ahead spline interpolation + EMA smoothing.
 */
export function computeSmartArrow(input: SmartArrowInput): SmartArrowResult {
  const {
    userLat,
    userLng,
    headingDeg,
    mode,
    transportMode,
    waypoints,
    waypointIndex,
    projectionIndex,
    alongM,
    spline,
    destination,
  } = input;

  if (mode === 'close_range' || waypoints.length === 0) {
    const abs = bearingDegrees(userLat, userLng, destination.lat, destination.lng);
    const rel = smoothRelativeBearing(relativeBearingDeg(headingDeg, abs));
    return {
      lat: destination.lat,
      lng: destination.lng,
      name: destination.name,
      bearingRelDeg: rel,
      distanceToTargetM: distanceMeters(
        userLat,
        userLng,
        destination.lat,
        destination.lng,
      ),
      pathBearingDeg: abs,
    };
  }

  const aheadM = lookAheadM(transportMode);
  let targetAlongM = alongM + aheadM;

  const turnAlongM = nextTurnAlongM(waypoints, projectionIndex);
  if (turnAlongM != null && turnAlongM - alongM < aheadM) {
    const wp = waypoints.find((w) => w.splineAlongM === turnAlongM);
    const prevIdx = Math.max(0, projectionIndex - 1);
    const prev = waypoints[prevIdx];
    const cur = waypoints[projectionIndex] ?? wp;
    let turnAngle = 0;
    if (prev && cur) {
      const b1 = bearingDegrees(prev.lat, prev.lng, cur.lat, cur.lng);
      const b2 = bearingDegrees(cur.lat, cur.lng, wp?.lat ?? cur.lat, wp?.lng ?? cur.lng);
      turnAngle = Math.abs(shortestAngleDelta(b1, b2));
    }
    if (turnAngle > 45) {
      targetAlongM = Math.min(targetAlongM, turnAlongM - ARROW_TURN_CLAMP_M);
    }
  }

  const interpolated = interpolateSplineAt(spline, targetAlongM);
  let targetLat: number;
  let targetLng: number;
  let pathBearingDeg: number;
  let name: string;

  if (interpolated) {
    targetLat = interpolated.lat;
    targetLng = interpolated.lng;
    pathBearingDeg = interpolated.bearingDeg;
    const wp =
      waypoints[Math.min(waypointIndex, waypoints.length - 1)];
    name =
      waypointIndex < waypoints.length - 1
        ? wp?.stationName?.trim() || wp?.landmark?.trim() || destination.name
        : destination.name;
  } else {
    const wp = waypoints[Math.min(waypointIndex, waypoints.length - 1)];
    targetLat = wp?.lat ?? destination.lat;
    targetLng = wp?.lng ?? destination.lng;
    pathBearingDeg = bearingDegrees(userLat, userLng, targetLat, targetLng);
    name =
      wp?.stationName?.trim() || wp?.landmark?.trim() || destination.name;
  }

  const absBearing = bearingDegrees(userLat, userLng, targetLat, targetLng);
  const rawRel = relativeBearingDeg(headingDeg, absBearing);

  return {
    lat: targetLat,
    lng: targetLng,
    name,
    bearingRelDeg: smoothRelativeBearing(rawRel),
    distanceToTargetM: distanceMeters(userLat, userLng, targetLat, targetLng),
    pathBearingDeg,
  };
}

/** Rebuild spline points from nav waypoints (when full polyline not stored). */
export function waypointsToSpline(waypoints: NavWaypoint[]): SplinePoint[] {
  return waypoints.map((wp, i) => ({
    lat: wp.lat,
    lng: wp.lng,
    alongM: wp.splineAlongM ?? i * 20,
    outboundBearingDeg:
      i < waypoints.length - 1
        ? bearingDegrees(
            wp.lat,
            wp.lng,
            waypoints[i + 1].lat,
            waypoints[i + 1].lng,
          )
        : 0,
    landmark: wp.landmark,
    maneuver: wp.maneuver,
    roadName: wp.roadName,
    cue: wp.cue,
    isTurn: isTurnManeuver(wp.maneuver),
  }));
}
