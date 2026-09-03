/**
 * Place-Fill an denselben OSM-Gebäudeumriss koppeln, den die Karte schon zeichnet.
 * Pack-Ringe können falsch geshared / versetzt sein → sonst „Vierecke“ neben dem Haus.
 */

import {
  approxPolygonAreaM2,
  distanceToPolygonM,
  isAxisAlignedBoxPolygon,
  pointInPolygon,
  type GeoLatLng,
} from '../geo/polygon';
import { isMapCrossingPoi } from '../navigation/osmBuildingFootprint';

export type LatLngRing = Array<[number, number]>;

const MAX_MATCH_M = 38;
const MAX_AREA_M2 = 12_000;

/** Natur/Fläche — nie auf ein Nachbarhaus snappen. */
const NON_BUILDING_PLACE_RE =
  /\b(wald|moor|fluss|bach|ufer|feldmark|wiese|see\b|teich|auen|niederung|park\b|garten|aussicht|wanderung|jagd|angel|brücke|bruecke|unterführung|unterfuehrung)\b/i;

function toGeo(ring: LatLngRing): GeoLatLng[] {
  return ring.map(([latitude, longitude]) => ({ latitude, longitude }));
}

function ringCentroid(ring: LatLngRing): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  const n = ring.length;
  for (const [la, ln] of ring) {
    lat += la;
    lng += ln;
  }
  return { lat: lat / n, lng: lng / n };
}

function metersBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = (aLat - bLat) * 111_320;
  const dLng = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function closeRing(ring: LatLngRing): LatLngRing | null {
  if (!ring || ring.length < 3) return null;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (a[0] === b[0] && a[1] === b[1]) return ring.length >= 4 ? ring : null;
  return [...ring, a];
}

function areaM2(ring: LatLngRing): number {
  return approxPolygonAreaM2(toGeo(ring));
}

/**
 * Kleinstes Extract-Gebäude, das den Pin enthält — sonst nächstes in Reichweite.
 */
export function findExtractBuildingUnderPin(
  lat: number,
  lng: number,
  buildings: LatLngRing[] | undefined | null,
  opts?: { maxDistM?: number; maxAreaM2?: number; requireContain?: boolean },
): LatLngRing | null {
  if (!buildings?.length) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const maxDist = opts?.maxDistM ?? MAX_MATCH_M;
  const maxArea = opts?.maxAreaM2 ?? MAX_AREA_M2;
  const requireContain = opts?.requireContain === true;

  let bestInside: LatLngRing | null = null;
  let bestInsideArea = Number.POSITIVE_INFINITY;
  let bestNear: LatLngRing | null = null;
  let bestNearDist = Number.POSITIVE_INFINITY;

  for (const raw of buildings) {
    const ring = closeRing(raw);
    if (!ring) continue;
    const area = areaM2(ring);
    if (!(area > 12) || area > maxArea) continue;
    const geo = toGeo(ring);
    if (pointInPolygon(lat, lng, geo)) {
      if (area < bestInsideArea) {
        bestInsideArea = area;
        bestInside = ring;
      }
      continue;
    }
    if (requireContain) continue;
    const d = distanceToPolygonM(lat, lng, geo);
    if (d <= maxDist && d < bestNearDist) {
      bestNearDist = d;
      bestNear = ring;
    }
  }
  return bestInside ?? bestNear;
}

/**
 * Pack-Ring ist keine echte OSM-Hülle (Achsen-Box oder zu wenige Ecken) →
 * braucht Tile/Extract-Snap auf den gerenderten Gebäudeumriss.
 */
export function packRingNeedsTileSnap(
  ring: LatLngRing | null | undefined,
): boolean {
  if (!ring || ring.length < 3) return true;
  if (isAxisAlignedBoxPolygon(toGeo(ring))) return true;
  const uniq = new Set<string>();
  for (const [la, ln] of ring) {
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
    uniq.add(`${la.toFixed(6)},${ln.toFixed(6)}`);
  }
  return uniq.size < 6;
}

/**
 * Pack-Ring behalten, wenn er zum Pin passt — sonst Extract-Gebäude (sichtbare Umrisse).
 */
export function resolvePlaceFillRing(
  lat: number,
  lng: number,
  packRing: LatLngRing | null | undefined,
  buildings: LatLngRing[] | undefined | null,
  opts?: { name?: string | null; category?: string | null },
): LatLngRing | null {
  const pack = packRing && packRing.length >= 3 ? closeRing(packRing) : null;
  const blob = `${opts?.name ?? ''} ${opts?.category ?? ''}`;
  if (isMapCrossingPoi(blob) || NON_BUILDING_PLACE_RE.test(blob)) {
    return pack;
  }

  const packGeo = pack ? toGeo(pack) : null;
  // Box ODER zu wenige Ecken (< 6 unique) = keine echte OSM-Hülle → snappen.
  const packIsBox = !!pack && packRingNeedsTileSnap(pack);
  const pinInPack = !!packGeo && pointInPolygon(lat, lng, packGeo);
  // Nur bei klarem Pack-Fehler Extract erzwingen — und dann Pin im Haus.
  const packBroken = !pack || packIsBox || !pinInPack;
  const extract = findExtractBuildingUnderPin(lat, lng, buildings, {
    requireContain: packBroken,
  });

  if (!pack) return extract;
  if (!extract) return pack;

  const packC = ringCentroid(pack);
  const packPinDist = metersBetween(lat, lng, packC.lat, packC.lng);
  const extractArea = areaM2(extract);
  const packArea = areaM2(pack);

  if (packIsBox) return extract;
  if (!pinInPack) return extract;
  if (packPinDist > 55) return extract;

  // Shared-Riesen-Footprint (Feuerwehr für Stadtgeschichte): Extract-Haus unter Pin.
  if (packArea > 2_800 && extractArea > 0 && extractArea < packArea * 0.55) {
    return extract;
  }

  return pack;
}
