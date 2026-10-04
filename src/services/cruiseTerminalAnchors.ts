/**
 * Cruise-Terminal-Anker — Ausnahme zur Stadtmitte.
 * Nähe ≤ IN_CITY_KM zum Terminal → Stadtwechsel-Angebot fürs Pack
 * (auch wenn Pack-Zentrum weiter weg ist, z. B. Gdynia → Danzig).
 */

export type CruiseTerminalAnchor = {
  /** Katalog- / Pack-City-Id */
  cityId: string;
  /** Anzeigename der Stadt (Pack) */
  cityName: string;
  /** Terminal-Label */
  terminalName: string;
  lat: number;
  lng: number;
  /** Ortsnamen die dieses Terminal matchen (Hafenstopp, GPS-Locality) */
  portAliases: string[];
};

/**
 * Belegte Terminal-Koordinaten (öffentliche Liegeplätze).
 * Stadt-agnostisch: jede Pack-Stadt mit Terminal kann hier landen.
 */
export const CRUISE_TERMINAL_ANCHORS: CruiseTerminalAnchor[] = [
  {
    cityId: 'kiel',
    cityName: 'Kiel',
    terminalName: 'Cruise Terminal Ostseekai, Kiel',
    lat: 54.32487,
    lng: 10.14549,
    portAliases: ['kiel', 'ostseekai'],
  },
  {
    cityId: 'hamburg',
    cityName: 'Hamburg',
    terminalName: 'Cruise Center Steinwerder, Hamburg',
    lat: 53.5342,
    lng: 9.9641,
    portAliases: ['hamburg', 'steinwerder', 'hafencity'],
  },
  {
    cityId: 'warnemuende',
    cityName: 'Warnemünde',
    terminalName: 'Cruise Terminal Warnemünde',
    lat: 54.1814,
    lng: 12.0882,
    portAliases: ['warnemünde', 'warnemuende', 'rostock'],
  },
  {
    cityId: 'bremerhaven',
    cityName: 'Bremerhaven',
    terminalName: 'Columbus Cruise Center Bremerhaven',
    lat: 53.5635,
    lng: 8.5532,
    portAliases: ['bremerhaven', 'columbus'],
  },
  {
    // Pack-Zentrum Gdańsk; Cruise oft Gdynia — Terminal ist die Nähe-Ausnahme
    cityId: 'danzig',
    cityName: 'Danzig',
    terminalName: 'Cruise Terminal Gdynia',
    lat: 54.5333,
    lng: 18.5514,
    portAliases: [
      'danzig',
      'gdańsk',
      'gdansk',
      'gdynia',
      'gdingen',
      'sopot',
      'zoppot',
    ],
  },
];

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type NearbyCruiseTerminalHit = {
  anchor: CruiseTerminalAnchor;
  km: number;
};

/** Nächstes Terminal innerhalb maxKm (Default 12 = IN_CITY_KM). */
export function findNearbyCruiseTerminal(
  lat: number,
  lng: number,
  maxKm = 12,
): NearbyCruiseTerminalHit | null {
  let best: NearbyCruiseTerminalHit | null = null;
  for (const anchor of CRUISE_TERMINAL_ANCHORS) {
    const km = haversineKm(lat, lng, anchor.lat, anchor.lng);
    if (km > maxKm) continue;
    if (!best || km < best.km) best = { anchor, km };
  }
  return best;
}

/** Terminal-Pin für Nav (Text → Koordinaten). */
export function cruiseTerminalPinFromText(text: string): {
  name: string;
  lat: number;
  lng: number;
} | null {
  const blob = norm(text);
  if (!blob) return null;
  for (const a of CRUISE_TERMINAL_ANCHORS) {
    if (a.portAliases.some((alias) => blob.includes(norm(alias)))) {
      return { name: a.terminalName, lat: a.lat, lng: a.lng };
    }
  }
  return null;
}

export function cruiseTerminalAnchorForCityId(
  cityId: string | null | undefined,
): CruiseTerminalAnchor | null {
  const id = norm(cityId || '');
  if (!id) return null;
  return CRUISE_TERMINAL_ANCHORS.find((a) => norm(a.cityId) === id) ?? null;
}
