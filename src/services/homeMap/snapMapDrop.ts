/**
 * Long-Press auf der Karte: nächsten Ort oder Hausnummer nehmen,
 * nicht einen namenlosen „Punkt auf der Karte“.
 */

export type MapDropPlace = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  category?: string;
};

export type MapDropHouse = {
  lat: number;
  lng: number;
  n: string;
  s?: string;
};

export type SnappedMapDrop =
  | { kind: 'place'; place: MapDropPlace; meters: number }
  | { kind: 'address'; lat: number; lng: number; name: string; meters: number }
  | { kind: 'point'; lat: number; lng: number };

const PLACE_SNAP_M = 95;
const ADDRESS_SNAP_M = 48;

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

export function snapMapLongPress(opts: {
  lat: number;
  lng: number;
  places: MapDropPlace[];
  houses?: MapDropHouse[] | null;
}): SnappedMapDrop {
  const { lat, lng, places, houses } = opts;
  let bestPlace: MapDropPlace | null = null;
  let bestPlaceM = PLACE_SNAP_M;
  for (const p of places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.id <= 0) continue;
    const d = metersBetween(lat, lng, p.lat, p.lng);
    if (d < bestPlaceM) {
      bestPlaceM = d;
      bestPlace = p;
    }
  }
  if (bestPlace) {
    return { kind: 'place', place: bestPlace, meters: bestPlaceM };
  }

  let bestHouse: MapDropHouse | null = null;
  let bestHouseM = ADDRESS_SNAP_M;
  for (const h of houses ?? []) {
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) continue;
    const d = metersBetween(lat, lng, h.lat, h.lng);
    if (d < bestHouseM) {
      bestHouseM = d;
      bestHouse = h;
    }
  }
  if (bestHouse) {
    const street = (bestHouse.s || '').trim();
    const name = street
      ? `${street} ${bestHouse.n}`.trim()
      : `Hausnummer ${bestHouse.n}`;
    return {
      kind: 'address',
      lat: bestHouse.lat,
      lng: bestHouse.lng,
      name,
      meters: bestHouseM,
    };
  }

  return { kind: 'point', lat, lng };
}
