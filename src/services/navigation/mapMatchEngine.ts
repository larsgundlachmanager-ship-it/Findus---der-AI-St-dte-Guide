/**
 * Map-matching engine — projects GPS onto the densified route spline.
 * Runs silently in the background; replaces crude nearest-waypoint matching.
 */

import { distanceMeters } from './bearing';
import type { NavWaypoint } from './navigationTypes';
import {
  projectOntoSpline,
  shouldPassMicroWaypoint,
  SPLINE_ADVANCE_M,
  type PathProjection,
  type SplinePoint,
} from './routeSpline';
import { waypointsToSpline } from './smartArrow';

export type MapMatchState = {
  projectionIndex: number;
  alongM: number;
  distanceToPathM: number;
  pathBearingDeg: number;
  spline: SplinePoint[];
};

let projectionIndex = 0;
let prevDistToCurrentWpM: number | null = null;
let cachedSpline: SplinePoint[] = [];

export function resetMapMatchEngine(): void {
  projectionIndex = 0;
  prevDistToCurrentWpM = null;
  cachedSpline = [];
}

export function initMapMatchEngine(waypoints: NavWaypoint[]): void {
  cachedSpline = waypointsToSpline(waypoints);
  projectionIndex = 0;
  prevDistToCurrentWpM = null;
}

export function getMapMatchSpline(): SplinePoint[] {
  return cachedSpline;
}

/**
 * Project user position onto route; advance breadcrumb index when passed.
 */
export function tickMapMatch(opts: {
  lat: number;
  lng: number;
  waypoints: NavWaypoint[];
  waypointIndex: number;
  advanceM?: number;
}): {
  projection: PathProjection | null;
  waypointIndex: number;
  distanceToPathM: number | null;
} {
  const { lat, lng, waypoints } = opts;
  let wpIndex = opts.waypointIndex;

  if (!cachedSpline.length && waypoints.length) {
    cachedSpline = waypointsToSpline(waypoints);
  }

  const projection = cachedSpline.length
    ? projectOntoSpline(lat, lng, cachedSpline, projectionIndex)
    : null;

  if (projection) {
    projectionIndex = projection.index;
  }

  const advanceM = opts.advanceM ?? SPLINE_ADVANCE_M;
  if (waypoints.length > 0) {
    while (wpIndex < waypoints.length) {
      const wp = waypoints[wpIndex];
      const dCur = distanceMeters(lat, lng, wp.lat, wp.lng);
      const nextWp = wpIndex + 1 < waypoints.length ? waypoints[wpIndex + 1] : null;
      const dNext = nextWp
        ? distanceMeters(lat, lng, nextWp.lat, nextWp.lng)
        : null;
      if (
        shouldPassMicroWaypoint({
          distToCurrentM: dCur,
          distToNextM: dNext,
          prevDistToCurrentM: prevDistToCurrentWpM,
          advanceM,
        })
      ) {
        wpIndex += 1;
        prevDistToCurrentWpM = null;
      } else {
        prevDistToCurrentWpM = dCur;
        break;
      }
    }
  }

  // Abkürzung: Breadcrumb an Projection-Along koppeln (nie hinter dem User)
  if (projection && waypoints.length > 0) {
    const along = projection.alongM;
    while (wpIndex < waypoints.length - 1) {
      const nextAlong = waypoints[wpIndex + 1]?.splineAlongM;
      if (typeof nextAlong !== 'number' || nextAlong > along + 10) break;
      wpIndex += 1;
      prevDistToCurrentWpM = null;
    }
  }

  return {
    projection,
    waypointIndex: wpIndex,
    distanceToPathM: projection?.distanceToPathM ?? null,
  };
}

/** True if user has passed a turn waypoint without taking it (missed junction). */
export function detectMissedTurn(opts: {
  lat: number;
  lng: number;
  waypoints: NavWaypoint[];
  waypointIndex: number;
  distanceToPathM: number | null;
}): { missed: boolean; turnIndex: number; backtrackM: number } {
  const { waypoints, waypointIndex, distanceToPathM } = opts;
  if (distanceToPathM == null || distanceToPathM < 15) {
    return { missed: false, turnIndex: -1, backtrackM: 0 };
  }

  for (let i = Math.max(0, waypointIndex - 3); i < waypointIndex; i++) {
    const wp = waypoints[i];
    if (!wp?.maneuver) continue;
    const m = wp.maneuver.toLowerCase();
    if (!/left|right|uturn|u-turn|fork|roundabout/.test(m)) continue;
    const d = distanceMeters(opts.lat, opts.lng, wp.lat, wp.lng);
    if (d > 18 && d < 55) {
      return {
        missed: true,
        turnIndex: i,
        backtrackM: Math.max(8, Math.round(d / 5) * 5),
      };
    }
  }
  return { missed: false, turnIndex: -1, backtrackM: 0 };
}

export function getProjectionIndex(): number {
  return projectionIndex;
}
