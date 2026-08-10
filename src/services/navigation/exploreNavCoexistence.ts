/**
 * Modul 1 ↔ Modul 3 coexistence.
 * Explore stories may run while navigating — but pause silently when a
 * relevant audio turn cue lies within the next N meters of route.
 */

import { distanceMeters } from './bearing';
import type { NavWaypoint } from './navigationTypes';

/** Story must finish before user focuses on the turn. */
export const EXPLORE_NAV_TURN_PRIORITY_M = 50;
/** Zu Fuß: Modul 1 mute nahe Abbiege-Knoten. */
export const EXPLORE_NAV_MUTE_FOOT_M = 30;
/** Fahrrad: Modul 1 mute nahe Abbiege-Knoten. */
export const EXPLORE_NAV_MUTE_BIKE_M = 70;

/**
 * Maneuver that would produce a spoken Abbiegehinweis (not straight/arrive).
 */
export function isRelevantAudioTurnWaypoint(wp: NavWaypoint | null | undefined): boolean {
  if (!wp) return false;
  const m = (wp.maneuver ?? '').toLowerCase();
  if (!m) return false;
  if (/straight|arrive|continue|ramp-straight|fork-straight/.test(m)) {
    return false;
  }
  return /left|right|uturn|u-turn|roundabout|fork|ramp|keep/.test(m);
}

/**
 * Path distance (m) from user → next relevant turn waypoint along the spline.
 * Prefers splineAlongM when present; otherwise sums consecutive segments.
 */
export function distanceAlongRouteToNextAudioTurnM(
  waypoints: NavWaypoint[],
  fromIndex: number,
  userLat: number,
  userLng: number,
): number | null {
  if (!waypoints.length) return null;
  const start = Math.max(0, Math.min(fromIndex, waypoints.length - 1));

  let turnIdx = -1;
  for (let i = start; i < waypoints.length; i++) {
    if (isRelevantAudioTurnWaypoint(waypoints[i])) {
      turnIdx = i;
      break;
    }
  }
  if (turnIdx < 0) return null;

  const startWp = waypoints[start]!;
  const turnWp = waypoints[turnIdx]!;
  const toStart = distanceMeters(userLat, userLng, startWp.lat, startWp.lng);

  const startAlong = startWp.splineAlongM;
  const turnAlong = turnWp.splineAlongM;
  if (
    typeof startAlong === 'number' &&
    typeof turnAlong === 'number' &&
    Number.isFinite(startAlong) &&
    Number.isFinite(turnAlong)
  ) {
    return Math.max(0, toStart + (turnAlong - startAlong));
  }

  if (turnIdx === start) return toStart;

  let along = toStart;
  for (let i = start; i < turnIdx; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    along += distanceMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return along;
}

export function shouldPauseExploreForNavTurn(opts: {
  navActive: boolean;
  waypoints: NavWaypoint[];
  waypointIndex: number;
  userLat: number | null;
  userLng: number | null;
  withinM?: number;
}): boolean {
  if (!opts.navActive) return false;
  if (opts.userLat == null || opts.userLng == null) return false;
  if (!opts.waypoints.length) return false;

  const withinM = opts.withinM ?? EXPLORE_NAV_TURN_PRIORITY_M;
  const d = distanceAlongRouteToNextAudioTurnM(
    opts.waypoints,
    opts.waypointIndex,
    opts.userLat,
    opts.userLng,
  );
  return d != null && d <= withinM;
}
