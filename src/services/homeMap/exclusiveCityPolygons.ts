/**
 * Stadtflächen ohne Overlap: kleinere Gemeinde gewinnt die Schnittfläche
 * (Prisdorf vor Tornesch/Pinneberg). polygon-clipping → Polygon inkl. Löcher.
 */

import polygonClipping from 'polygon-clipping';

export type LatLngRing = Array<[number, number]>;

function ringAreaAbs(ring: LatLngRing): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lat1, lng1] = ring[i]!;
    const [lat2, lng2] = ring[(i + 1) % ring.length]!;
    a += lng1 * lat2 - lng2 * lat1;
  }
  return Math.abs(a) * 0.5;
}

/** [lat,lng] → GeoJSON [lng,lat], geschlossen. */
function toLngLatRing(ring: LatLngRing): Array<[number, number]> {
  const coords = ring.map((p) => [p[1], p[0]] as [number, number]);
  const a = coords[0]!;
  const b = coords[coords.length - 1]!;
  if (a[0] !== b[0] || a[1] !== b[1]) coords.push([a[0], a[1]]);
  return coords;
}

function fromLngLatRing(ring: Array<[number, number]>): LatLngRing {
  const out: LatLngRing = [];
  for (let i = 0; i < ring.length; i++) {
    const [lng, lat] = ring[i]!;
    if (i === ring.length - 1 && out.length > 0) {
      const f = out[0]!;
      if (Math.abs(f[0] - lat) < 1e-12 && Math.abs(f[1] - lng) < 1e-12) break;
    }
    out.push([lat, lng]);
  }
  return out;
}

function bboxOverlaps(a: LatLngRing, b: LatLngRing): boolean {
  let aMinLat = 90,
    aMaxLat = -90,
    aMinLng = 180,
    aMaxLng = -180;
  let bMinLat = 90,
    bMaxLat = -90,
    bMinLng = 180,
    bMaxLng = -180;
  for (const [lat, lng] of a) {
    if (lat < aMinLat) aMinLat = lat;
    if (lat > aMaxLat) aMaxLat = lat;
    if (lng < aMinLng) aMinLng = lng;
    if (lng > aMaxLng) aMaxLng = lng;
  }
  for (const [lat, lng] of b) {
    if (lat < bMinLat) bMinLat = lat;
    if (lat > bMaxLat) bMaxLat = lat;
    if (lng < bMinLng) bMinLng = lng;
    if (lng > bMaxLng) bMaxLng = lng;
  }
  return !(
    aMaxLat < bMinLat ||
    aMinLat > bMaxLat ||
    aMaxLng < bMinLng ||
    aMinLng > bMaxLng
  );
}

export type CityPolyInput = {
  id: string;
  ring: LatLngRing;
};

export type ExclusiveCityPoly<T extends CityPolyInput> = T & {
  /** Außenring [lat,lng] */
  ring: LatLngRing;
  /** Löcher = kleinere Nachbarn in der Schnittfläche */
  holes: LatLngRing[];
};

/**
 * Kleinere Fläche gewinnt Overlap. Größere bekommt Löcher (MapLibre Fill).
 */
export function exclusiveCityRings<T extends CityPolyInput>(
  cities: T[],
): Array<ExclusiveCityPoly<T>> {
  if (cities.length <= 1) {
    return cities.map((c) => ({ ...c, ring: c.ring, holes: [] as LatLngRing[] }));
  }
  const ranked = cities
    .map((c, i) => ({ c, i, area: ringAreaAbs(c.ring) }))
    .sort((a, b) => a.area - b.area || a.i - b.i);

  const out: Array<ExclusiveCityPoly<T>> = new Array(cities.length);
  for (let ri = 0; ri < ranked.length; ri++) {
    const cur = ranked[ri]!;
    let geom: polygonClipping.Geom = [toLngLatRing(cur.c.ring)];
    for (let sj = 0; sj < ri; sj++) {
      const smaller = ranked[sj]!;
      if (!bboxOverlaps(cur.c.ring, smaller.c.ring)) continue;
      try {
        const clipped = polygonClipping.difference(
          geom,
          [toLngLatRing(smaller.c.ring)],
        );
        if (clipped?.length) geom = clipped;
      } catch {
        /* Topology-Fail → Original */
      }
    }
    // MultiPolygon → größtes Polygon (mit Löchern) nehmen.
    let bestPoly: polygonClipping.Polygon | null = null;
    let bestArea = -1;
    for (const poly of geom as polygonClipping.MultiPolygon) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      const latLng = fromLngLatRing(outer as Array<[number, number]>);
      const area = ringAreaAbs(latLng);
      if (area > bestArea) {
        bestArea = area;
        bestPoly = poly;
      }
    }
    if (!bestPoly?.[0]) {
      out[cur.i] = { ...cur.c, ring: cur.c.ring, holes: [] };
      continue;
    }
    const ring = fromLngLatRing(bestPoly[0] as Array<[number, number]>);
    const holes: LatLngRing[] = [];
    for (let h = 1; h < bestPoly.length; h++) {
      const hr = bestPoly[h];
      if (!hr || hr.length < 4) continue;
      holes.push(fromLngLatRing(hr as Array<[number, number]>));
    }
    out[cur.i] = { ...cur.c, ring, holes };
  }
  return out;
}
