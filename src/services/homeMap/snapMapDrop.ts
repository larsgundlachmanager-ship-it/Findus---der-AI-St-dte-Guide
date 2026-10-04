/**
 * Long-Press auf der Karte: Hausnummer vor Ort — sonst namenloser Punkt.
 * Adresse darf nicht vom nächsten Laden (140 m) geschluckt werden.
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

const PLACE_SNAP_M = 140;
const ADDRESS_SNAP_M = 55;

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

  // Hausnummer zuerst — sonst schnappt der nächste Laden (140 m) die Adresse weg.
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

  return { kind: 'point', lat, lng };
}

/**
 * Long-Press ohne Pack-Ort: Gebäude-/Ladenname aus Nominatim (z. B. Edeka Böge).
 * Kein Hardcode — nur was reverse liefert.
 */
export async function resolveMapDropName(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const u = new URL('https://nominatim.openstreetmap.org/reverse');
      u.searchParams.set('lat', String(lat));
      u.searchParams.set('lon', String(lng));
      u.searchParams.set('format', 'json');
      u.searchParams.set('addressdetails', '1');
      u.searchParams.set('zoom', '18');
      u.searchParams.set('namedetails', '1');
      const res = await fetch(u.toString(), {
        signal: ctrl.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        name?: string;
        namedetails?: { name?: string; 'name:de'?: string };
        address?: Record<string, string | undefined>;
        display_name?: string;
      };
      const addr = data.address || {};
      const named =
        (data.namedetails?.['name:de'] || data.namedetails?.name || data.name || '').trim() ||
        (
          addr.amenity ||
          addr.shop ||
          addr.tourism ||
          addr.leisure ||
          addr.building ||
          addr.office ||
          ''
        ).trim();
      if (named && named.length >= 2 && !/^\d+$/.test(named)) {
        return named.slice(0, 64);
      }
      const road = (addr.road || addr.pedestrian || '').trim();
      const house = (addr.house_number || '').trim();
      if (road && house) return `${road} ${house}`.slice(0, 64);
      if (road) return road.slice(0, 64);
      const first = data.display_name?.split(',')[0]?.trim();
      if (first && first.length >= 3 && !/^punkt/i.test(first)) return first.slice(0, 64);
      return null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
