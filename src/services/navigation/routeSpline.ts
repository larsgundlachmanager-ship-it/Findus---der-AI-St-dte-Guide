/**
 * Dense navigation spline: decode Google polyline → sample ~20 m
 * micro-waypoints for smooth compass needle + landmark tagging.
 */

import { distanceMeters, bearingDegrees } from './bearing';
import type { NavWaypoint } from './navigationTypes';

export const SPLINE_SPACING_M = 20;
/** Consume micro-WP (breadcrumb) when within this distance — compass retargets next. */
export const SPLINE_ADVANCE_M = 7;

/**
 * Pass-by detection: WP is "passed" when distance to current grows while
 * distance to next shrinks (and user is closer to next). Prevents compass
 * hang when GPS skips over a micro-WP.
 */
export function shouldPassMicroWaypoint(opts: {
  distToCurrentM: number;
  distToNextM: number | null;
  prevDistToCurrentM: number | null;
  advanceM?: number;
}): boolean {
  const advanceM = opts.advanceM ?? SPLINE_ADVANCE_M;
  if (opts.distToCurrentM <= advanceM) return true;
  if (opts.distToNextM == null) return false;
  const growing =
    opts.prevDistToCurrentM != null &&
    opts.distToCurrentM > opts.prevDistToCurrentM + 1.2;
  const closerToNext = opts.distToNextM + 2 < opts.distToCurrentM;
  // Within a reasonable corridor of the next crumb
  return (
    growing &&
    closerToNext &&
    opts.distToNextM < Math.max(advanceM * 3.5, 28)
  );
}

export type SplinePoint = {
  lat: number;
  lng: number;
  /** Cumulative distance along path from start (m). */
  alongM: number;
  /** Absolute bearing toward next point (deg), or last segment. */
  outboundBearingDeg: number;
  /** Optional visual anchor visible from previous point. */
  landmark?: string | null;
  /** Maneuver inherited from nearest Directions step. */
  maneuver?: string | null;
  roadName?: string | null;
  cue?: string | null;
  isTurn?: boolean;
};

/**
 * Decode Google encoded polyline → lat/lng path.
 * @see https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const coords: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return coords;
}

function interpolate(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  t: number,
): { lat: number; lng: number } {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

/**
 * Densify a sparse path into ~spacingM samples.
 * Keeps original vertices so turns stay exact.
 */
export function densifyPath(
  path: Array<{ lat: number; lng: number }>,
  spacingM = SPLINE_SPACING_M,
): SplinePoint[] {
  if (path.length === 0) return [];
  if (path.length === 1) {
    return [
      {
        lat: path[0].lat,
        lng: path[0].lng,
        alongM: 0,
        outboundBearingDeg: 0,
      },
    ];
  }

  const out: SplinePoint[] = [];
  let along = 0;
  out.push({
    lat: path[0].lat,
    lng: path[0].lng,
    alongM: 0,
    outboundBearingDeg: bearingDegrees(
      path[0].lat,
      path[0].lng,
      path[1].lat,
      path[1].lng,
    ),
  });

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = distanceMeters(a.lat, a.lng, b.lat, b.lng);
    if (segLen < 0.5) continue;

    const bearing = bearingDegrees(a.lat, a.lng, b.lat, b.lng);
    let consumed = 0;
    while (consumed + spacingM < segLen) {
      consumed += spacingM;
      const t = consumed / segLen;
      const pt = interpolate(a, b, t);
      along += spacingM;
      out.push({
        lat: pt.lat,
        lng: pt.lng,
        alongM: Math.round(along),
        outboundBearingDeg: bearing,
      });
    }
    along += segLen - consumed;
    out.push({
      lat: b.lat,
      lng: b.lng,
      alongM: Math.round(along),
      outboundBearingDeg: bearing,
    });
  }

  // Deduplicate near-identical consecutive points
  const deduped: SplinePoint[] = [];
  for (const p of out) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      distanceMeters(prev.lat, prev.lng, p.lat, p.lng) < 4
    ) {
      deduped[deduped.length - 1] = { ...p, alongM: prev.alongM };
      continue;
    }
    deduped.push(p);
  }
  return deduped;
}

/** Attach maneuver/landmark cues from Directions step waypoints onto nearest spline points. */
export function tagSplineWithManeuvers(
  spline: SplinePoint[],
  maneuvers: NavWaypoint[],
  snapM = 28,
): SplinePoint[] {
  if (!spline.length || !maneuvers.length) return spline;
  const tagged = spline.map((p) => ({ ...p }));
  for (const m of maneuvers) {
    let bestIdx = -1;
    let bestD = snapM;
    for (let i = 0; i < tagged.length; i++) {
      const d = distanceMeters(tagged[i].lat, tagged[i].lng, m.lat, m.lng);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) continue;
    const isTurn = Boolean(
      m.maneuver &&
        !/straight|arrive|continue/i.test(m.maneuver) &&
        /left|right|uturn|u-turn/i.test(m.maneuver),
    );
    tagged[bestIdx] = {
      ...tagged[bestIdx],
      maneuver: m.maneuver ?? tagged[bestIdx].maneuver,
      roadName: m.roadName ?? tagged[bestIdx].roadName,
      landmark: m.landmark ?? tagged[bestIdx].landmark,
      cue: m.cue ?? tagged[bestIdx].cue,
      isTurn: isTurn || tagged[bestIdx].isTurn,
    };
  }
  return tagged;
}

/** Convert spline → NavWaypoints for the compass / coach loop. */
export function splineToNavWaypoints(spline: SplinePoint[]): NavWaypoint[] {
  return spline.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    maneuver: p.maneuver ?? (p.isTurn ? null : 'straight'),
    roadName: p.roadName ?? null,
    landmark: p.landmark ?? null,
    cue: p.cue ?? null,
    instruction: p.landmark
      ? `Ziele auf ${p.landmark}.`
      : null,
    isStation: false,
    splineAlongM: p.alongM,
    visibleLandmark: p.landmark ?? null,
  }));
}

export type PathProjection = {
  /** Index of nearest / next micro-waypoint. */
  index: number;
  distanceToPathM: number;
  alongM: number;
  /** Bearing of path at projection (for wrong-way check). */
  pathBearingDeg: number;
};

/**
 * Project GPS onto spline: find closest segment ahead, return next micro-WP ahead.
 * Always scans forward from currentIndex so Abkürzungen sofort den Fortschritt nachziehen.
 */
export function projectOntoSpline(
  lat: number,
  lng: number,
  spline: SplinePoint[],
  currentIndex = 0,
): PathProjection | null {
  if (!spline.length) return null;

  const floor = Math.max(0, Math.min(currentIndex, spline.length - 1));
  let bestIdx = floor;
  let bestD = distanceMeters(lat, lng, spline[bestIdx].lat, spline[bestIdx].lng);

  // Grobe Vorwärtssuche (Abkürzung / Jump) — nie hinter floor zurück
  for (let i = floor; i < spline.length; i += 5) {
    const d = distanceMeters(lat, lng, spline[i].lat, spline[i].lng);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  // Feinjustierung um den Treffer + kurzes lokales Fenster
  const refineLo = Math.max(floor, bestIdx - 6);
  const refineHi = Math.min(spline.length - 1, bestIdx + 8);
  for (let i = refineLo; i <= refineHi; i++) {
    const d = distanceMeters(lat, lng, spline[i].lat, spline[i].lng);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  // Nahfenster um floor (GPS-Zittern auf der Linie)
  const localHi = Math.min(spline.length - 1, floor + 16);
  for (let i = floor; i <= localHi; i++) {
    const d = distanceMeters(lat, lng, spline[i].lat, spline[i].lng);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }

  // Advance when within SPLINE_ADVANCE_M of current micro-WP, or pass-by
  let nextIdx = bestIdx;
  let prevDist: number | null = null;
  while (nextIdx < spline.length - 1) {
    const dCur = distanceMeters(
      lat,
      lng,
      spline[nextIdx].lat,
      spline[nextIdx].lng,
    );
    const nxt = spline[nextIdx + 1];
    const dNext = nxt
      ? distanceMeters(lat, lng, nxt.lat, nxt.lng)
      : null;
    if (
      !shouldPassMicroWaypoint({
        distToCurrentM: dCur,
        distToNextM: dNext,
        prevDistToCurrentM: prevDist,
        advanceM: SPLINE_ADVANCE_M,
      })
    ) {
      break;
    }
    prevDist = dCur;
    nextIdx += 1;
  }

  const bearingSrc = Math.max(0, nextIdx - 1);
  const pathBearingDeg =
    nextIdx < spline.length
      ? bearingDegrees(
          spline[bearingSrc].lat,
          spline[bearingSrc].lng,
          spline[nextIdx].lat,
          spline[nextIdx].lng,
        )
      : spline[bearingSrc]?.outboundBearingDeg ?? 0;

  return {
    index: nextIdx,
    distanceToPathM: bestD,
    alongM: spline[nextIdx]?.alongM ?? 0,
    pathBearingDeg,
  };
}

export type SplineInterpolation = {
  lat: number;
  lng: number;
  alongM: number;
  /** Bearing of the segment at this point (deg). */
  bearingDeg: number;
  /** Index of the spline point at or before this position. */
  index: number;
};

/**
 * Find a point `alongM` meters from the route start on the densified spline.
 * Used by Smart Arrow look-ahead and map-matching helpers.
 */
export function interpolateSplineAt(
  spline: SplinePoint[],
  alongM: number,
): SplineInterpolation | null {
  if (!spline.length) return null;
  if (spline.length === 1) {
    return {
      lat: spline[0].lat,
      lng: spline[0].lng,
      alongM: spline[0].alongM,
      bearingDeg: spline[0].outboundBearingDeg,
      index: 0,
    };
  }

  const target = Math.max(0, alongM);
  const last = spline[spline.length - 1];
  if (target >= last.alongM) {
    return {
      lat: last.lat,
      lng: last.lng,
      alongM: last.alongM,
      bearingDeg: last.outboundBearingDeg,
      index: spline.length - 1,
    };
  }

  let lo = 0;
  let hi = spline.length - 1;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (spline[mid].alongM <= target) lo = mid;
    else hi = mid;
  }

  const a = spline[lo];
  const b = spline[Math.min(lo + 1, spline.length - 1)];
  const span = b.alongM - a.alongM;
  const t = span > 0.01 ? (target - a.alongM) / span : 0;
  const pt = interpolate(a, b, Math.min(1, Math.max(0, t)));
  return {
    lat: pt.lat,
    lng: pt.lng,
    alongM: target,
    bearingDeg: b.outboundBearingDeg,
    index: lo,
  };
}

/** Build densified spline from encoded polyline + optional maneuver tags. */
export function buildRouteSpline(
  encodedPolyline: string | null | undefined,
  fallbackPath: Array<{ lat: number; lng: number }>,
  maneuvers: NavWaypoint[] = [],
  spacingM = SPLINE_SPACING_M,
): SplinePoint[] {
  const decoded =
    encodedPolyline && encodedPolyline.length > 4
      ? decodePolyline(encodedPolyline)
      : [];
  const path = decoded.length >= 2 ? decoded : fallbackPath;
  if (path.length < 2) return densifyPath(path, spacingM);
  const dense = densifyPath(path, spacingM);
  return tagSplineWithManeuvers(dense, maneuvers);
}
