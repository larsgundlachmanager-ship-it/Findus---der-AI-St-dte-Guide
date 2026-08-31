/**
 * Geometrie für ÖPNV-Beine: Bahn folgt MOTIS-Polyline (Präzision 6) oder Stationen.
 * Niemals Fuß-OSRM auf das Schienenbein.
 */

import type { JourneyLeg } from './journeyPlanner';

export type PathCoord = { lat: number; lng: number };

function valid(lat: number | null | undefined, lng: number | null | undefined): PathCoord | null {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function haversineM(a: PathCoord, b: PathCoord): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Google-Polyline mit wählbarer Präzision (MOTIS v2/v5 = 6, Maps/OSRM = 5). */
export function decodePolylineFactor(
  encoded: string,
  factor: number,
): PathCoord[] {
  const coords: PathCoord[] = [];
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
    const p = valid(lat / factor, lng / factor);
    if (p) coords.push(p);
  }
  return coords;
}

function pathFitsAnchors(
  pts: PathCoord[],
  from: PathCoord | null,
  to: PathCoord | null,
): boolean {
  if (pts.length < 3) return false;
  const start = pts[0]!;
  const end = pts[pts.length - 1]!;
  if (from && haversineM(start, from) > 4000) return false;
  if (to && haversineM(end, to) > 4000) return false;
  return true;
}

function anchorScore(
  pts: PathCoord[],
  from: PathCoord | null,
  to: PathCoord | null,
): number {
  const start = pts[0]!;
  const end = pts[pts.length - 1]!;
  const dFrom = from ? haversineM(start, from) : 0;
  const dTo = to ? haversineM(end, to) : 0;
  return dFrom + dTo - Math.min(80, pts.length);
}

export function decodeMotisPolyline(
  raw: string | null | undefined,
  precision: number | null | undefined,
  from?: PathCoord | null,
  to?: PathCoord | null,
): PathCoord[] {
  const s = String(raw ?? '').trim();
  if (s.length < 8) return [];
  const tried = new Set<number>();
  const order: number[] = [];
  if (precision === 5 || precision === 6 || precision === 7) {
    order.push(10 ** precision);
  }
  order.push(1e6, 1e5, 1e7);
  let best: PathCoord[] = [];
  let bestScore = Infinity;
  for (const factor of order) {
    if (tried.has(factor)) continue;
    tried.add(factor);
    try {
      const pts = decodePolylineFactor(s, factor);
      if (!pathFitsAnchors(pts, from ?? null, to ?? null)) continue;
      const score = anchorScore(pts, from ?? null, to ?? null);
      if (score < bestScore) {
        bestScore = score;
        best = pts;
      }
    } catch {
      /* next factor */
    }
  }
  return best;
}

export type MotisGeometry = {
  points: string;
  precision: number | null;
};

/** MOTIS / OTP: encoded polyline auf dem Leg inkl. Präzision. */
export function encodedPathFromMotisLeg(leg: {
  legGeometry?: { points?: string; precision?: number } | null;
  polyline?: string | null;
  steps?: Array<{ polyline?: { points?: string; precision?: number } | string }>;
}): MotisGeometry | null {
  const g = leg.legGeometry?.points?.trim();
  if (g && g.length >= 8) {
    return {
      points: g,
      precision: typeof leg.legGeometry?.precision === 'number'
        ? leg.legGeometry.precision
        : null,
    };
  }
  const p = leg.polyline?.trim();
  if (p && p.length >= 8) return { points: p, precision: null };
  for (const step of leg.steps ?? []) {
    if (typeof step.polyline === 'string' && step.polyline.trim().length >= 8) {
      return { points: step.polyline.trim(), precision: null };
    }
    if (
      step.polyline &&
      typeof step.polyline === 'object' &&
      step.polyline.points &&
      step.polyline.points.trim().length >= 8
    ) {
      return {
        points: step.polyline.points.trim(),
        precision:
          typeof step.polyline.precision === 'number'
            ? step.polyline.precision
            : null,
      };
    }
  }
  return null;
}

/** Stationenkette (Einstieg → Zwischenhalte → Ausstieg). */
export function stationChainFromLeg(leg: JourneyLeg): PathCoord[] {
  const out: PathCoord[] = [];
  const from = valid(leg.fromLat, leg.fromLng);
  if (from) out.push(from);
  for (const s of leg.intermediateStops ?? []) {
    const c = valid(s.lat, s.lng);
    if (!c) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.lat - c.lat) < 1e-5 && Math.abs(last.lng - c.lng) < 1e-5) {
      continue;
    }
    out.push(c);
  }
  const to = valid(leg.toLat, leg.toLng);
  if (to) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.lat - to.lat) > 1e-5 || Math.abs(last.lng - to.lng) > 1e-5) {
      out.push(to);
    }
  }
  return out;
}

export function pathFromJourneyLeg(leg: JourneyLeg): PathCoord[] {
  if (Array.isArray(leg.path) && leg.path.length >= 3) {
    return leg.path.filter(
      (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
  }
  const from = valid(leg.fromLat, leg.fromLng);
  const to = valid(leg.toLat, leg.toLng);
  const decoded = decodeMotisPolyline(
    leg.pathEncoded,
    leg.pathPrecision ?? null,
    from,
    to,
  );
  if (decoded.length >= 3) return decoded;
  const chain = stationChainFromLeg(leg);
  return chain.length >= 3 ? chain : [];
}

export function isTransitJourneyMode(mode: JourneyLeg['mode']): boolean {
  return mode !== 'WALK' && mode !== 'BIKE';
}

export function isRailLikeMode(mode: JourneyLeg['mode']): boolean {
  return (
    mode === 'RAIL' ||
    mode === 'SUBWAY' ||
    mode === 'TRAM' ||
    mode === 'TRANSIT'
  );
}

export function isRoadTransitMode(mode: JourneyLeg['mode']): boolean {
  return mode === 'BUS';
}
