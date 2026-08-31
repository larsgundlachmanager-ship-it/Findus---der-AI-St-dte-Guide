import { haversineMeters } from '../geo/haversine';

/** Absolute bearing from A → B in degrees [0, 360), 0 = north, 90 = east. */
export function bearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/** Shortest signed delta from a → b in degrees (−180, 180]. */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  let d = ((toDeg - fromDeg + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Relative bearing: 0 = target straight ahead, positive = turn right.
 * `headingDeg` is device heading (0 = north).
 */
export function relativeBearingDeg(
  headingDeg: number,
  targetBearingDeg: number,
): number {
  return shortestAngleDelta(headingDeg, targetBearingDeg);
}

export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return haversineMeters(lat1, lng1, lat2, lng2);
}
