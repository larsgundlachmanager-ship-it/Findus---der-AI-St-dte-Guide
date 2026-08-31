import type { GeoLatLng } from '../../types/poiGeo';

/** Ray-casting point-in-polygon (inkl. Rand ≈ innen). */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: GeoLatLng[],
): boolean {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].latitude;
    const xi = polygon[i].longitude;
    const yj = polygon[j].latitude;
    const xj = polygon[j].longitude;

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Ungefähre Polygonfläche in m² (equirectangular). */
export function approxPolygonAreaM2(polygon: GeoLatLng[]): number {
  if (!polygon || polygon.length < 3) return Number.POSITIVE_INFINITY;
  const lat0 = polygon.reduce((s, p) => s + p.latitude, 0) / polygon.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude * mPerDegLng;
    const yi = polygon[i].latitude * mPerDegLat;
    const xj = polygon[j].longitude * mPerDegLng;
    const yj = polygon[j].latitude * mPerDegLat;
    area += xj * yi - xi * yj;
  }
  return Math.abs(area / 2);
}

export function parsePolygonJson(
  raw: string | null | undefined,
): GeoLatLng[] | null {
  const rings = parsePolygonRings(raw);
  const first = rings[0];
  return first && first.length >= 3 ? first : null;
}

export function serializePolygon(polygon: GeoLatLng[]): string {
  return JSON.stringify(polygon);
}

export type PolygonJson =
  | GeoLatLng[]
  | { type: 'MultiPolygon'; rings: GeoLatLng[][] };

export function serializePolygonRings(rings: GeoLatLng[][]): string {
  const clean = rings.filter((r) => r.length >= 2);
  if (clean.length <= 1) return serializePolygon(clean[0] ?? []);
  return JSON.stringify({ type: 'MultiPolygon', rings: clean });
}

function ringFromUnknown(raw: unknown): GeoLatLng[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out: GeoLatLng[] = [];
  for (const p of raw) {
    if (
      p &&
      typeof p === 'object' &&
      typeof (p as GeoLatLng).latitude === 'number' &&
      typeof (p as GeoLatLng).longitude === 'number'
    ) {
      out.push({
        latitude: (p as GeoLatLng).latitude,
        longitude: (p as GeoLatLng).longitude,
      });
    } else if (
      p &&
      typeof p === 'object' &&
      typeof (p as { lat?: number }).lat === 'number' &&
      typeof (p as { lng?: number }).lng === 'number'
    ) {
      out.push({
        latitude: (p as { lat: number }).lat,
        longitude: (p as { lng: number }).lng,
      });
    } else if (
      Array.isArray(p) &&
      typeof p[0] === 'number' &&
      typeof p[1] === 'number'
    ) {
      out.push({ latitude: p[0], longitude: p[1] });
    }
  }
  return out.length >= 2 ? out : null;
}

/** Alle Ringe (Gebäude + Bahnsteige). */
export function parsePolygonRings(
  raw: string | null | undefined,
): GeoLatLng[][] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { type?: string }).type === 'MultiPolygon' &&
      Array.isArray((parsed as { rings?: unknown }).rings)
    ) {
      return ((parsed as { rings: unknown[] }).rings)
        .map(ringFromUnknown)
        .filter((r): r is GeoLatLng[] => !!r);
    }
    const one = ringFromUnknown(parsed);
    return one ? [one] : [];
  } catch {
    return [];
  }
}

/** Pack-Fallback: 4 Ecken = Achsen-Box, kein OSM-Gebäudeumriss. */
export function isAxisAlignedBoxPolygon(polygon: GeoLatLng[]): boolean {
  if (!polygon || polygon.length < 4 || polygon.length > 6) return false;
  const lats = new Set<string>();
  const lngs = new Set<string>();
  for (const p of polygon) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) {
      return false;
    }
    lats.add(p.latitude.toFixed(6));
    lngs.add(p.longitude.toFixed(6));
  }
  return lats.size === 2 && lngs.size === 2;
}

export function polygonToLatLngPairs(
  polygon: GeoLatLng[],
): Array<[number, number]> {
  return polygon.map((p) => [p.latitude, p.longitude]);
}

export function latLngPairsToPolygon(
  pairs: Array<[number, number]>,
): GeoLatLng[] {
  return pairs.map(([latitude, longitude]) => ({ latitude, longitude }));
}

/** Distanz Punkt→Polygon-Kante in m; innen = 0. */
export function distanceToPolygonM(
  lat: number,
  lng: number,
  polygon: GeoLatLng[],
): number {
  if (!polygon || polygon.length < 3) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(lat, lng, polygon)) return 0;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const ax = a.longitude * mPerDegLng;
    const ay = a.latitude * mPerDegLat;
    const bx = b.longitude * mPerDegLng;
    const by = b.latitude * mPerDegLat;
    const px = lng * mPerDegLng;
    const py = lat * mPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    best = Math.min(best, Math.hypot(px - cx, py - cy));
  }
  return best;
}

/** Nähe inkl. Puffer (Modul-1 Footprint-Trigger). */
export function nearPolygonWithBufferM(
  lat: number,
  lng: number,
  polygon: GeoLatLng[],
  bufferM: number,
): boolean {
  return distanceToPolygonM(lat, lng, polygon) <= Math.max(0, bufferM);
}
