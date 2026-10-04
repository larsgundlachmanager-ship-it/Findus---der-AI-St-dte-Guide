/**
 * Stadtflächen ohne Overlap: kleinere Gemeinde gewinnt die Schnittfläche
 * (Prisdorf vor Tornesch/Pinneberg). polygon-clipping → Polygon inkl. Löcher.
 *
 * Naht: Lücken bis ~200 m schließen (Midline), Overlaps auf kleinere Kante ziehen,
 * Loch = exakter kleinerer Ring → eine gemeinsame Kontur ohne Doppel-Zacke.
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

/** Grobe Meter-Distanz (lat/lng) — nur für Seam-Seal, keine Navigation. */
function approxDistM(a: [number, number], b: [number, number]): number {
  const dLat = (a[0] - b[0]) * 111_320;
  const midLat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dLng = (a[1] - b[1]) * 111_320 * Math.cos(midLat);
  return Math.hypot(dLat, dLng);
}

function metersToLat(m: number): number {
  return m / 111_320;
}

function metersToLng(m: number, atLat: number): number {
  return m / (111_320 * Math.max(0.2, Math.cos((atLat * Math.PI) / 180)));
}

function nearestOnRing(
  p: [number, number],
  ring: LatLngRing,
): { q: [number, number]; distM: number } {
  let bestQ: [number, number] = ring[0]!;
  let best = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const abLat = b[0] - a[0];
    const abLng = b[1] - a[1];
    const apLat = p[0] - a[0];
    const apLng = p[1] - a[1];
    const ab2 = abLat * abLat + abLng * abLng;
    const t =
      ab2 < 1e-24
        ? 0
        : Math.max(0, Math.min(1, (apLat * abLat + apLng * abLng) / ab2));
    const q: [number, number] = [a[0] + t * abLat, a[1] + t * abLng];
    const d = approxDistM(p, q);
    if (d < best) {
      best = d;
      bestQ = q;
    }
  }
  return { q: bestQ, distM: best };
}

function pointInRing(ring: LatLngRing, lat: number, lng: number): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi
    ) {
      odd = !odd;
    }
  }
  return odd;
}

function ringCentroid(ring: LatLngRing): [number, number] {
  let lat = 0;
  let lng = 0;
  const n = Math.max(1, ring.length);
  for (const p of ring) {
    lat += p[0];
    lng += p[1];
  }
  return [lat / n, lng / n];
}

/**
 * Entlang Kanten verdichten, wenn die Kante nahe am Nachbarn liegt —
 * sonst bleiben Lücken-Mitten ohne Vertex und der Snap greift nicht.
 */
export function densifyRingNearNeighbor(
  ring: LatLngRing,
  neighbor: LatLngRing,
  opts?: { maxGapM?: number; stepM?: number; maxPts?: number },
): LatLngRing {
  if (ring.length < 3 || neighbor.length < 3) return ring;
  const maxGapM = opts?.maxGapM ?? 200;
  const stepM = opts?.stepM ?? 28;
  const maxPts = opts?.maxPts ?? 900;
  const out: LatLngRing = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    out.push([a[0], a[1]]);
    const edgeM = approxDistM(a, b);
    if (edgeM < stepM * 1.2) continue;
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const { distM } = nearestOnRing(mid, neighbor);
    if (distM > maxGapM) continue;
    const steps = Math.min(24, Math.max(1, Math.floor(edgeM / stepM)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      if (out.length >= maxPts) return out;
    }
  }
  return out.length >= 3 ? out : ring;
}

/**
 * Kleine Stadt wächst in Lücken ≤ maxGapM bis an die große Kante.
 * Form-SSOT der Naht = große Kante dort, wo sie schon da ist; Lücke wird grün gefüllt.
 */
export function expandSmallerToMeetLarger(
  smaller: LatLngRing,
  larger: LatLngRing,
  maxGapM = 200,
  opts?: { densify?: boolean },
): LatLngRing {
  if (smaller.length < 3 || larger.length < 3) return smaller;
  const dense =
    opts?.densify === false
      ? smaller
      : densifyRingNearNeighbor(smaller, larger, { maxGapM });
  const out: LatLngRing = [];
  for (const p of dense) {
    const inside = pointInRing(larger, p[0], p[1]);
    const { q, distM } = nearestOnRing(p, larger);
    if (!inside && distM > 0.8 && distM <= maxGapM) {
      out.push([q[0], q[1]]);
    } else {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

/**
 * Große Stadt: nur Rand-Overlap (≤ maxGapM in der Kleinen) auf kleine Kante ziehen.
 * Kein Expand der Großen — sonst kollabiert die Hülle (Tornesch um Prisdorf).
 */
export function pullLargerFringeOutOfSmaller(
  larger: LatLngRing,
  smaller: LatLngRing,
  maxGapM = 200,
): LatLngRing {
  if (larger.length < 3 || smaller.length < 3) return larger;
  const out: LatLngRing = [];
  for (const p of larger) {
    if (!pointInRing(smaller, p[0], p[1])) {
      out.push([p[0], p[1]]);
      continue;
    }
    const { q, distM } = nearestOnRing(p, smaller);
    if (distM <= maxGapM) out.push([q[0], q[1]]);
    else out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * Versiegeln: verdichten + Snap, dann einmal nachverdichten.
 * Densify in jedem Pass war zu teuer für den Map-Hot-Path.
 */
export function sealRingPairToSharedSeam(
  smaller: LatLngRing,
  larger: LatLngRing,
  maxGapM = 280,
): { a: LatLngRing; b: LatLngRing } {
  const b = larger.map((p) => [p[0], p[1]] as [number, number]);
  let a = densifyRingNearNeighbor(
    smaller.map((p) => [p[0], p[1]] as [number, number]),
    b,
    { maxGapM, stepM: 36, maxPts: 480 },
  );
  a = expandSmallerToMeetLarger(a, b, maxGapM, { densify: false });
  a = densifyRingNearNeighbor(a, b, { maxGapM, stepM: 36, maxPts: 560 });
  a = expandSmallerToMeetLarger(a, b, maxGapM, { densify: false });
  return { a, b };
}

/**
 * Vor Exclusive: alle überlappenden / nahen Paare versiegeln (kleinere gewinnt Index).
 */
export function harmonizeNeighborSeams<T extends CityPolyInput>(
  cities: T[],
  maxGapM = 200,
): T[] {
  if (cities.length <= 1) return cities;
  const ranked = cities
    .map((c, i) => ({ c, i, area: ringAreaAbs(c.ring) }))
    .sort((a, b) => a.area - b.area || a.i - b.i);
  const rings = cities.map((c) =>
    c.ring.map((p) => [p[0], p[1]] as [number, number]),
  );

  const overlapsPadded = (ra: LatLngRing, rb: LatLngRing): boolean => {
    let aMinLat = 90,
      aMaxLat = -90,
      aMinLng = 180,
      aMaxLng = -180;
    let bMinLat = 90,
      bMaxLat = -90,
      bMinLng = 180,
      bMaxLng = -180;
    for (const [lat, lng] of ra) {
      if (lat < aMinLat) aMinLat = lat;
      if (lat > aMaxLat) aMaxLat = lat;
      if (lng < aMinLng) aMinLng = lng;
      if (lng > aMaxLng) aMaxLng = lng;
    }
    for (const [lat, lng] of rb) {
      if (lat < bMinLat) bMinLat = lat;
      if (lat > bMaxLat) bMaxLat = lat;
      if (lng < bMinLng) bMinLng = lng;
      if (lng > bMaxLng) bMaxLng = lng;
    }
    const dLat = metersToLat(maxGapM);
    const mid = (aMinLat + aMaxLat + bMinLat + bMaxLat) / 4;
    const dLng = metersToLng(maxGapM, mid);
    return !(
      aMaxLat + dLat < bMinLat ||
      aMinLat - dLat > bMaxLat ||
      aMaxLng + dLng < bMinLng ||
      aMinLng - dLng > bMaxLng
    );
  };

  for (let ri = 0; ri < ranked.length; ri++) {
    const larger = ranked[ri]!;
    for (let sj = 0; sj < ri; sj++) {
      const smaller = ranked[sj]!;
      if (!overlapsPadded(rings[larger.i]!, rings[smaller.i]!)) continue;
      const sealed = sealRingPairToSharedSeam(
        rings[smaller.i]!,
        rings[larger.i]!,
        maxGapM,
      );
      rings[smaller.i] = sealed.a;
      rings[larger.i] = sealed.b;
    }
  }
  return cities.map((c, i) => ({ ...c, ring: rings[i]! }));
}

/** @deprecated alias */
export function snapRingToNeighborSeam(
  ring: LatLngRing,
  neighbor: LatLngRing,
  maxSnapM = 200,
): LatLngRing {
  return expandSmallerToMeetLarger(ring, neighbor, maxSnapM);
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

function ringFingerprint(ring: LatLngRing): string {
  if (!ring.length) return '0';
  const a = ring[0]!;
  const b = ring[(ring.length / 2) | 0]!;
  const c = ring[ring.length - 1]!;
  return `${ring.length}:${a[0].toFixed(5)},${a[1].toFixed(5)}:${b[0].toFixed(5)},${b[1].toFixed(5)}:${c[0].toFixed(5)},${c[1].toFixed(5)}`;
}

function exclusiveCacheKey(cities: CityPolyInput[]): string {
  return cities.map((c) => `${c.id}|${ringFingerprint(c.ring)}`).join(';');
}

type ExclusiveCacheEntry = {
  key: string;
  rings: LatLngRing[];
  holes: LatLngRing[][];
};

let exclusiveCache: ExclusiveCacheEntry | null = null;

/**
 * Kleinere Fläche gewinnt Overlap. Größere bekommt Löcher (MapLibre Fill).
 */
export function exclusiveCityRings<T extends CityPolyInput>(
  cities: T[],
): Array<ExclusiveCityPoly<T>> {
  if (cities.length <= 1) {
    return cities.map((c) => ({ ...c, ring: c.ring, holes: [] as LatLngRing[] }));
  }
  const cacheKey = exclusiveCacheKey(cities);
  if (
    exclusiveCache?.key === cacheKey &&
    exclusiveCache.rings.length === cities.length
  ) {
    return cities.map((c, i) => ({
      ...c,
      ring: exclusiveCache!.rings[i]!,
      holes: exclusiveCache!.holes[i] ?? [],
    }));
  }
  // Lücken schließen + Overlaps versiegeln, bevor gelocht wird.
  const sealed = harmonizeNeighborSeams(cities, 280);
  const ranked = sealed
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
        const clipped = polygonClipping.difference(geom, [
          toLngLatRing(smaller.c.ring),
        ]);
        if (clipped?.length) geom = clipped;
      } catch {
        /* Topology-Fail → Original */
      }
    }
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
    // Loch nur wenn die kleinere Stadt wirklich INNEN liegt (Enklave).
    // Seite-an-Seite (Prisdorf|Tornesch): Difference formt die Außenkante — kein Loch.
    const holes: LatLngRing[] = [];
    for (let sj = 0; sj < ri; sj++) {
      const smaller = ranked[sj]!;
      if (!bboxOverlaps(ring, smaller.c.ring)) continue;
      const [clat, clng] = ringCentroid(smaller.c.ring);
      if (!pointInRing(ring, clat, clng)) continue;
      holes.push(smaller.c.ring.map((p) => [p[0], p[1]] as [number, number]));
    }
    if (!holes.length) {
      for (let h = 1; h < bestPoly.length; h++) {
        const hr = bestPoly[h];
        if (!hr || hr.length < 4) continue;
        holes.push(fromLngLatRing(hr as Array<[number, number]>));
      }
    }
    out[cur.i] = { ...cur.c, ring, holes };
  }
  exclusiveCache = {
    key: cacheKey,
    rings: out.map((c) => c.ring),
    holes: out.map((c) => c.holes),
  };
  return out;
}
