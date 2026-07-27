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
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 3) return null;
    const out: GeoLatLng[] = [];
    for (const p of parsed) {
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
      }
    }
    return out.length >= 3 ? out : null;
  } catch {
    return null;
  }
}

export function serializePolygon(polygon: GeoLatLng[]): string {
  return JSON.stringify(polygon);
}
