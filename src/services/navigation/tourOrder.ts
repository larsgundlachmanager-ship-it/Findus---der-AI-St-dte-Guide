/**
 * Offene Tour-Stopps in die kürzeste Reihenfolge vom Standort aus.
 * Kleine N: alle Permutationen. Größer: nearest-neighbor + 2-opt.
 */

export type GeoStop = { lat: number; lng: number };

function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathLengthM(origin: GeoStop, stops: GeoStop[]): number {
  let total = 0;
  let prev = origin;
  for (const s of stops) {
    total += haversineM(prev.lat, prev.lng, s.lat, s.lng);
    prev = s;
  }
  return total;
}

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i]!;
    const rest = items.filter((_, j) => j !== i);
    for (const p of permute(rest)) out.push([head, ...p]);
  }
  return out;
}

function nearestNeighbor<T extends GeoStop>(origin: GeoStop, stops: T[]): T[] {
  const left = stops.slice();
  const ordered: T[] = [];
  let cur = origin;
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = haversineM(cur.lat, cur.lng, left[i]!.lat, left[i]!.lng);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = left.splice(best, 1)[0]!;
    ordered.push(next);
    cur = next;
  }
  return ordered;
}

function twoOpt<T extends GeoStop>(origin: GeoStop, stops: T[]): T[] {
  const ord = stops.slice();
  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    improved = false;
    guard += 1;
    for (let i = 0; i < ord.length - 1; i++) {
      for (let k = i + 1; k < ord.length; k++) {
        const next = ord.slice();
        const mid = next.slice(i, k + 1).reverse();
        next.splice(i, k + 1 - i, ...mid);
        if (pathLengthM(origin, next) + 8 < pathLengthM(origin, ord)) {
          ord.splice(0, ord.length, ...next);
          improved = true;
        }
      }
    }
  }
  return ord;
}

/** Hotel / Unterkunft bleibt ans Ende gepinnt — nicht in die Tour-Mitte mischen. */
export function isHotelTourEnd(stop: { name?: string | null }): boolean {
  return /\b(hotel|pension|hostel|unterkunft|gasthof|ferienwohnung|airbnb)\b/i.test(
    stop.name ?? '',
  );
}

function orderFreeStops<T extends GeoStop>(origin: GeoStop, stops: T[]): T[] {
  if (stops.length <= 1) return stops.slice();
  if (stops.length <= 6) {
    let best = stops.slice();
    let bestLen = pathLengthM(origin, best);
    for (const p of permute(stops)) {
      const len = pathLengthM(origin, p);
      if (len + 1 < bestLen) {
        best = p;
        bestLen = len;
      }
    }
    return best;
  }
  return twoOpt(origin, nearestNeighbor(origin, stops));
}

/** Offene Stopps so sortieren, dass der Weg vom Standort insgesamt am kürzesten ist. */
export function orderStopsEfficiently<T extends GeoStop>(
  origin: GeoStop,
  stops: T[],
  opts?: { pinLast?: (stop: T) => boolean },
): T[] {
  if (stops.length <= 1) return stops.slice();
  const pinLast = opts?.pinLast;
  if (pinLast) {
    const anchored = stops.filter((s) => pinLast(s));
    const free = stops.filter((s) => !pinLast(s));
    if (anchored.length && free.length) {
      return [...orderFreeStops(origin, free), ...anchored];
    }
  }
  return orderFreeStops(origin, stops);
}
