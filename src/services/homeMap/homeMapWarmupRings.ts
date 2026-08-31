/**
 * Karten-Warmup: zuerst die sichtbare Ansicht, dann Ringe um den User.
 * 500 m → 2 km → 10 km → Rest der Stadt — Extract von Disk, Kamera bleibt.
 */

export const HOME_MAP_WARMUP_RINGS_M = [500, 2_000, 10_000] as const;

export const HOME_MAP_PLACE_CAP_BY_RING = {
  500: 160,
  2000: 280,
  10000: 380,
  rest: 460,
} as const;

export function placeCapForRadiusM(radiusM: number): number {
  if (radiusM <= 500) return HOME_MAP_PLACE_CAP_BY_RING[500];
  if (radiusM <= 2_000) return HOME_MAP_PLACE_CAP_BY_RING[2000];
  if (radiusM <= 10_000) return HOME_MAP_PLACE_CAP_BY_RING[10000];
  return HOME_MAP_PLACE_CAP_BY_RING.rest;
}

export function homeMapViewSpanM(view: {
  south: number;
  north: number;
  west: number;
  east: number;
}): number {
  const dLat = Math.abs(view.north - view.south) * 111_320;
  const mid = (view.north + view.south) / 2;
  const dLng =
    Math.abs(view.east - view.west) *
    111_320 *
    Math.max(0.2, Math.cos((mid * Math.PI) / 180));
  return Math.hypot(dLat, dLng);
}

/** Stadt-Übersicht: Orte so lange wie möglich, Icons blenden per Zoom. */
export function placeCapForMapView(radiusM: number, viewSpanM: number): number {
  if (viewSpanM >= 18_000) return 120;
  if (viewSpanM >= 10_000) return 180;
  if (viewSpanM >= 5_000) return 280;
  return placeCapForRadiusM(radiusM);
}

/** Gebäude nie zu Punkten — Ringe bleiben in jeder Übersicht. */
export function skipPlaceRingsForView(_viewSpanM: number): boolean {
  return false;
}

/** ÖPNV/Briefkasten zuerst, dann Story, dann Nähe — Halt fällt nicht aus dem Cap. */
export function capMapPlacesForView<T extends { keepPin?: boolean; story?: number }>(
  visible: T[],
  cap: number,
  distM: (place: T) => number,
): T[] {
  if (visible.length <= cap) return visible;
  const pinned = visible.filter((p) => p.keepPin);
  const rest = visible.filter((p) => !p.keepPin);
  pinned.sort((a, b) => distM(a) - distM(b));
  rest.sort((a, b) => {
    const story = (b.story || 0) - (a.story || 0);
    if (story !== 0) return story;
    return distM(a) - distM(b);
  });
  if (pinned.length >= cap) return pinned.slice(0, cap);
  return [...pinned, ...rest.slice(0, cap - pinned.length)];
}

/** Stadt-Rest: halbe Diagonale der Coverage-Box, mind. 12 km. */
export function cityRestRadiusM(bounds: {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
} | null): number {
  if (!bounds) return 18_000;
  const dLat = (bounds.latMax - bounds.latMin) * 111_320;
  const midLat = (bounds.latMin + bounds.latMax) / 2;
  const dLng =
    (bounds.lngMax - bounds.lngMin) *
    111_320 *
    Math.cos((midLat * Math.PI) / 180);
  return Math.max(12_000, Math.hypot(dLat, dLng) / 2);
}

export function warmupRingListM(
  cityBounds: {
    latMin: number;
    latMax: number;
    lngMin: number;
    lngMax: number;
  } | null,
): number[] {
  const rest = cityRestRadiusM(cityBounds);
  const out: number[] = [...HOME_MAP_WARMUP_RINGS_M];
  if (rest > 10_000) out.push(rest);
  return out;
}

/**
 * Settled-Boot: nur Nahbereich — kein Expand auf 2/10 km / Stadt-Rest.
 * Weites Nachladen erst bei bewusstem Pan (Places/Extract-Gates).
 */
export function warmupSettleRingsM(): number[] {
  return [HOME_MAP_WARMUP_RINGS_M[0]];
}
