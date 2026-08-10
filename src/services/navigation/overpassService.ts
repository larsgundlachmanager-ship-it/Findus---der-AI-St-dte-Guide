/**
 * OpenStreetMap Overpass — €0 POI search (OSM-first strategy).
 * Google Places only after OSM returns zero usable results.
 */

export type OsmPlace = {
  placeId: string;
  name: string;
  types: string[];
  lat: number;
  lng: number;
  distanceM: number;
  openNow: boolean;
  rating: null;
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

const FETCH_MS = 12_000;

/** Google-style placeType → Overpass tag filters. */
const PLACE_TYPE_FILTERS: Record<string, string[]> = {
  bakery: ['["amenity"="bakery"]', '["shop"="bakery"]'],
  cafe: ['["amenity"="cafe"]', '["amenity"="coffee_shop"]'],
  restaurant: ['["amenity"="restaurant"]'],
  toilet: ['["amenity"="toilets"]'],
  toilets: ['["amenity"="toilets"]'],
  park: ['["leisure"="park"]', '["leisure"="garden"]'],
  bank: ['["amenity"="bank"]', '["amenity"="atm"]'],
  pharmacy: ['["amenity"="pharmacy"]'],
  hospital: [
    '["amenity"="hospital"]',
    '["amenity"="clinic"]',
    '["healthcare"="hospital"]',
  ],
  doctor: [
    '["amenity"="doctors"]',
    '["amenity"="clinic"]',
    '["amenity"="hospital"]',
  ],
  drugstore: [
    '["shop"="chemist"]',
    '["shop"="drugstore"]',
    '["brand"~"^(dm|Rossmann|Müller|Mueller|Budni)$",i]',
  ],
  supermarket: ['["shop"="supermarket"]'],
  convenience_store: ['["shop"="convenience"]'],
  atm: ['["amenity"="atm"]'],
  drinking_water: ['["amenity"="drinking_water"]'],
  ice_cream: [
    '["amenity"="ice_cream"]',
    '["shop"="ice_cream"]',
    '["cuisine"="ice_cream"]',
  ],
  wifi: [
    '["amenity"="internet_cafe"]',
    '["internet_access"="wlan"]',
    '["internet_access"="yes"]',
    '["tourism"="information"]',
  ],
  /** Handy laden / fest installierte Device-Ladestationen */
  phone_charge: [
    '["amenity"="device_charging_station"]',
    '["amenity"="device_charging"]',
    '["amenity"="vending_machine"]["vending"~"power_?bank|phone|electronics",i]',
    '["rental:powerbank"]',
    '["amenity"="rental_machine"]["rental"~"powerbank",i]',
    '["amenity"="cafe"]["socket"]',
    '["amenity"="library"]["socket"]',
  ],
  /** Powerbank-Automaten / Sharing */
  powerbank: [
    '["amenity"="vending_machine"]["vending"~"power_?bank",i]',
    '["rental:powerbank"]',
    '["amenity"="rental_machine"]["rental"~"powerbank",i]',
    '["amenity"="rental_machine"]["rental:powerbank"]',
    '["brand"~"^(voozaa|Batterybar|Cheetah|Rechargy|Chargery)$",i]',
  ],
  /** Cafés/Bibliotheken mit belegter Steckdose (OSM socket=*) */
  outlet_cafe: [
    '["amenity"="cafe"]["socket"]',
    '["amenity"="cafe"]["socket:usb"]',
    '["amenity"="cafe"]["socket:power"]',
    '["amenity"="fast_food"]["socket"]',
    '["amenity"="library"]["socket"]',
    '["tourism"="information"]["socket"]',
  ],
  post_office: ['["amenity"="post_office"]'],
  parking: ['["amenity"="parking"]'],
  museum: ['["tourism"="museum"]'],
  church: ['["amenity"="place_of_worship"]'],
  point_of_interest: [
    '["amenity"~"bakery|cafe|pharmacy|bank|toilets|restaurant|fast_food|hospital|drinking_water"]',
    '["shop"~"bakery|supermarket|convenience"]',
    '["leisure"="park"]',
  ],
  /** 2-Min-Dwell: breitere Nähe-Orte inkl. Bar/Hotel */
  dwell: [
    '["amenity"~"bakery|cafe|pharmacy|bank|toilets|restaurant|fast_food|bar|pub|biergarten|cinema|theatre|nightclub|hospital|drinking_water|ice_cream|fuel"]',
    '["shop"]',
    '["tourism"~"hotel|museum|attraction|viewpoint|guest_house|apartment|zoo|theme_park"]',
    '["leisure"~"park|sports_centre|fitness_centre|pitch"]',
    '["historic"]',
  ],
};

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function osmTypesForPlaceType(placeType: string): string[] {
  const t = placeType.toLowerCase();
  if (t === 'toilet' || t === 'toilets') return ['toilet', 'point_of_interest'];
  if (t === 'park') return ['park', 'point_of_interest'];
  if (t === 'bakery') return ['bakery', 'store', 'point_of_interest'];
  if (t === 'cafe') return ['cafe', 'food', 'point_of_interest'];
  if (t === 'bank' || t === 'atm') return ['bank', 'finance', 'point_of_interest'];
  if (t === 'pharmacy') return ['pharmacy', 'health', 'point_of_interest'];
  if (t === 'hospital' || t === 'doctor') {
    return ['hospital', 'doctor', 'health', 'point_of_interest'];
  }
  if (t === 'drinking_water') {
    return ['drinking_water', 'point_of_interest'];
  }
  if (t === 'ice_cream') {
    return ['ice_cream', 'cafe', 'point_of_interest'];
  }
  if (t === 'wifi') {
    return ['wifi', 'cafe', 'point_of_interest'];
  }
  if (t === 'drugstore') {
    return ['drugstore', 'store', 'chemist', 'point_of_interest'];
  }
  if (t === 'phone_charge' || t === 'powerbank' || t === 'outlet_cafe') {
    return [t, 'point_of_interest', 'cafe'];
  }
  return [t, 'point_of_interest'];
}

function buildQuery(
  lat: number,
  lng: number,
  radiusM: number,
  placeType: string,
  keyword?: string | null,
): string {
  const filters =
    PLACE_TYPE_FILTERS[placeType.toLowerCase()] ??
    PLACE_TYPE_FILTERS.point_of_interest;
  const around = `(around:${Math.round(radiusM)},${lat},${lng})`;
  const kw = (keyword ?? '').trim();
  // Optional name/cuisine/brand match — keeps Overpass €0 for “Burger”-style intents.
  const nameFilter = kw
    ? `["name"~"${kw.replace(/[\\"]/g, '').slice(0, 40)}",i]`
    : '';
  const cuisineFilter =
    kw &&
    /restaurant|cafe|bakery|meal_takeaway|fast_food/i.test(placeType)
      ? `["cuisine"~"${kw.replace(/[\\"]/g, '').slice(0, 40)}",i]`
      : '';
  const parts = filters.flatMap((f) => {
    const base = [`node${f}${around};`, `way${f}${around};`];
    if (!kw) return base;
    // Base + name/cuisine — client filtert Keyword; Base fängt Lücken ab (€0).
    const withName = nameFilter
      ? [`node${f}${nameFilter}${around};`, `way${f}${nameFilter}${around};`]
      : [];
    const withCuisine = cuisineFilter
      ? [
          `node${f}${cuisineFilter}${around};`,
          `way${f}${cuisineFilter}${around};`,
        ]
      : [];
    return [...base, ...withName, ...withCuisine];
  });
  return `[out:json][timeout:8];(${parts.join('')});out center tags 32;`;
}

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

async function postOverpass(
  endpoint: string,
  query: string,
  signal: AbortSignal,
): Promise<OverpassElement[]> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!res.ok) {
    throw new Error(`Overpass ${res.status}`);
  }
  const data = (await res.json()) as { elements?: OverpassElement[] };
  return data.elements ?? [];
}

/** Best-effort openNow from OSM opening_hours — unknown → true (nicht blocken). */
function openNowFromOsmTags(tags: Record<string, string>): boolean {
  const raw = (tags.opening_hours ?? tags['opening_hours:covid19'] ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return true;
  if (raw === '24/7') return true;
  if (raw === 'closed' || raw === 'off') return false;
  // Keine volle OH-Parser-Lib — unklare Strings nicht als geschlossen verkaufen.
  return true;
}

function elementToPlace(
  el: OverpassElement,
  originLat: number,
  originLng: number,
  placeType: string,
  keyword?: string | null,
): OsmPlace | null {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const tags = el.tags ?? {};
  let name = (tags.name ?? tags.brand ?? tags.operator ?? '').trim();
  if (!name || name.length < 2) {
    const chargeType = /^(phone_charge|powerbank|outlet_cafe)$/i.test(placeType);
    if (!chargeType) return null;
    name =
      tags.brand ||
      tags.operator ||
      (placeType === 'powerbank'
        ? 'Powerbank-Automat'
        : placeType === 'outlet_cafe'
          ? 'Ort mit Steckdose'
          : 'Handy-Ladestation');
  }
  const kw = (keyword ?? '').trim().toLowerCase();
  if (kw) {
    const blob = `${name} ${tags.cuisine ?? ''} ${tags.brand ?? ''} ${tags.amenity ?? ''} ${tags.vending ?? ''}`.toLowerCase();
    if (!blob.includes(kw)) return null;
  }
  const distanceM = Math.round(haversine(originLat, originLng, lat, lng));
  const placeId = `osm:${el.type ?? 'n'}:${el.id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}`;
  return {
    placeId,
    name,
    types: osmTypesForPlaceType(placeType),
    lat,
    lng,
    distanceM,
    openNow: openNowFromOsmTags(tags),
    rating: null,
  };
}

/**
 * Query Overpass for amenity/shop POIs near lat/lng.
 * Returns [] on network/timeout — caller may fall back to Google.
 */
export async function searchOsmPlacesNearby(opts: {
  lat: number;
  lng: number;
  placeType: string;
  radiusM?: number;
  /** Optional name/cuisine filter (still €0). */
  keyword?: string | null;
}): Promise<OsmPlace[]> {
  // Expanding rings may request up to ~30 km — Overpass around: handles it.
  const radius = Math.max(60, Math.min(opts.radiusM ?? 800, 30_000));
  const query = buildQuery(
    opts.lat,
    opts.lng,
    radius,
    opts.placeType,
    opts.keyword,
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);

  try {
    let lastErr: unknown;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const elements = await postOverpass(endpoint, query, ctrl.signal);
        const out: OsmPlace[] = [];
        const seen = new Set<string>();
        for (const el of elements) {
          const place = elementToPlace(
            el,
            opts.lat,
            opts.lng,
            opts.placeType,
            opts.keyword,
          );
          if (!place) continue;
          if (place.distanceM > radius + 25) continue;
          if (seen.has(place.placeId)) continue;
          seen.add(place.placeId);
          out.push(place);
        }
        out.sort((a, b) => a.distanceM - b.distanceM);
        if (__DEV__) {
          console.log(
            `[overpass] ${opts.placeType}${opts.keyword ? `~${opts.keyword}` : ''} @${radius}m → ${out.length} hits`,
          );
        }
        return out.slice(0, 8);
      } catch (err) {
        lastErr = err;
        if (ctrl.signal.aborted) break;
      }
    }
    if (__DEV__ && lastErr) {
      console.warn('[overpass] query failed:', lastErr);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Landmark-style OSM scan (generic POIs near a turn / walker). */
export async function searchOsmLandmarksNear(
  lat: number,
  lng: number,
  radiusM = 55,
): Promise<OsmPlace[]> {
  return searchOsmPlacesNearby({
    lat,
    lng,
    placeType: 'point_of_interest',
    radiusM: Math.max(40, Math.min(radiusM, 120)),
  });
}
