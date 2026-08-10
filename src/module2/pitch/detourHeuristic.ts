/**
 * Umweg-Schätzer ohne OSRM — Luftlinie + Abstand zur Linie.
 */

import type { PitchLatLng, PitchRouteBrief } from './types';

export const DETOUR_PRIO_BANDS_MIN = [2, 5, 10, 15, 30] as const;

const FOOT_M_PER_MIN = 80;
const BIKE_M_PER_MIN = 220;
const AIR_BUFFER = 1.25;
const SIDE_PENALTY_M = 400;

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function dist(a: PitchLatLng, b: PitchLatLng): number {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

/** Nächster Punkt auf Segment A→B (inkl. Endpunkte). */
export function closestPointOnSegment(
  p: PitchLatLng,
  a: PitchLatLng,
  b: PitchLatLng,
): { point: PitchLatLng; t: number; sideM: number } {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-18) {
    t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const point = { lat: ay + t * dy, lng: ax + t * dx };
  return { point, t, sideM: dist(p, point) };
}

/** Nächster Punkt auf Polyline oder einfacher Linie. */
export function closestOnRoute(
  p: PitchLatLng,
  route: PitchRouteBrief,
): { point: PitchLatLng; sideM: number; progress01: number } {
  const poly = route.polyline;
  if (poly && poly.length >= 2) {
    let bestSide = Infinity;
    let bestPoint = route.start;
    let bestProg = 0;
    let cum = 0;
    const segs: number[] = [0];
    for (let i = 1; i < poly.length; i++) {
      const prev = poly[i - 1]!;
      const cur = poly[i]!;
      cum += haversineMeters(prev[1], prev[0], cur[1], cur[0]);
      segs.push(cum);
    }
    const total = Math.max(1, cum);
    for (let i = 1; i < poly.length; i++) {
      const a = { lat: poly[i - 1]![1], lng: poly[i - 1]![0] };
      const b = { lat: poly[i]![1], lng: poly[i]![0] };
      const hit = closestPointOnSegment(p, a, b);
      if (hit.sideM < bestSide) {
        bestSide = hit.sideM;
        bestPoint = hit.point;
        const segLen = Math.max(1e-6, segs[i]! - segs[i - 1]!);
        bestProg = (segs[i - 1]! + hit.t * segLen) / total;
      }
    }
    return { point: bestPoint, sideM: bestSide, progress01: bestProg };
  }
  const hit = closestPointOnSegment(p, route.start, route.end);
  return { point: hit.point, sideM: hit.sideM, progress01: hit.t };
}

export function extraMetersViaPlace(
  route: PitchRouteBrief,
  place: PitchLatLng,
): number {
  const origin = route.user ?? route.start;
  const direct = dist(origin, route.end);
  const via = dist(origin, place) + dist(place, route.end);
  return Math.max(0, via - direct);
}

export function extraMinApprox(
  extraM: number,
  mode: 'foot' | 'bike' = 'foot',
): number {
  const pace = mode === 'bike' ? BIKE_M_PER_MIN : FOOT_M_PER_MIN;
  return (extraM / pace) * AIR_BUFFER;
}

export function detourPrioFromMin(extraMin: number, sideM = 0): number {
  let prio = 6;
  for (let i = 0; i < DETOUR_PRIO_BANDS_MIN.length; i++) {
    if (extraMin <= DETOUR_PRIO_BANDS_MIN[i]!) {
      prio = i + 1;
      break;
    }
  }
  if (sideM > SIDE_PENALTY_M) prio = Math.min(6, prio + 1);
  return prio;
}

export type DetourScore = {
  extraM: number;
  extraMin: number;
  sideM: number;
  progress01: number;
  prio: number;
};

export function scoreDetourOnRoute(
  place: PitchLatLng,
  route: PitchRouteBrief,
  mode: 'foot' | 'bike' = 'foot',
): DetourScore {
  const on = closestOnRoute(place, route);
  const extraM = extraMetersViaPlace(route, place);
  const extraMin = extraMinApprox(extraM, mode);
  let prio = detourPrioFromMin(extraMin, on.sideM);
  // Hinter Start / hinter Ziel stark bestrafen
  if (on.progress01 < 0.02 || on.progress01 > 0.98) {
    prio = Math.min(6, prio + 1);
  }
  return {
    extraM,
    extraMin,
    sideM: on.sideM,
    progress01: on.progress01,
    prio,
  };
}

export function scoreDetourLandmark(
  place: PitchLatLng,
  landmark: PitchLatLng,
  mode: 'foot' | 'bike' = 'foot',
): DetourScore {
  const extraM = dist(place, landmark);
  const extraMin = extraMinApprox(extraM, mode);
  const prio = detourPrioFromMin(extraMin, 0);
  return {
    extraM,
    extraMin,
    sideM: extraM,
    progress01: 0.5,
    prio,
  };
}

/** here_now Distanzringe (m) → grobe Prio 1..5 */
export const HERE_NOW_RINGS_M = [150, 400, 800, 1200, 2000] as const;

export function hereNowPrio(distM: number): number {
  for (let i = 0; i < HERE_NOW_RINGS_M.length; i++) {
    if (distM <= HERE_NOW_RINGS_M[i]!) return i + 1;
  }
  return 6;
}
