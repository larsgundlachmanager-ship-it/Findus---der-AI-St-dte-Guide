/**
 * Akt-3 Screensaver: Geo-Lookup + Welt-Regionen (EU / Asien / Amerika / Afrika).
 */

import { SEED_PLACES } from './candidates';

export type SparkPin = { lat: number; lng: number };

export type TheaterBounds = {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

export type TheaterRegionId = 'europe' | 'asia' | 'americas' | 'africa' | 'atlantic' | 'world';

export type TheaterView = {
  region: TheaterRegionId;
  /** 'europe' = Europa-Asset, sonst Weltkarte. */
  mapKind: 'europe' | 'world';
  bounds: TheaterBounds;
};

/** Default Europa/Mittelmeer — latMin niedrig genug, dass Balearen über Maghreb-Saum liegen. */
export const THEATER_BOUNDS: TheaterBounds = {
  latMin: 32.5,
  latMax: 62,
  lngMin: -12,
  lngMax: 38,
};

export const REGION_BOUNDS: Record<TheaterRegionId, TheaterBounds> = {
  europe: { latMin: 32.5, latMax: 62, lngMin: -12, lngMax: 38 },
  asia: { latMin: -12, latMax: 55, lngMin: 60, lngMax: 150 },
  americas: { latMin: -55, latMax: 72, lngMin: -130, lngMax: -30 },
  africa: { latMin: -36, latMax: 38, lngMin: -20, lngMax: 55 },
  atlantic: { latMin: 10, latMax: 65, lngMin: -85, lngMax: 40 },
  world: { latMin: -55, latMax: 72, lngMin: -170, lngMax: 180 },
};

const ALIASES: Record<string, string> = {
  mallorca: 'palma',
  'palma de mallorca': 'palma',
  majorca: 'palma',
  alcudia: 'alcudia',
  'alcúdia': 'alcudia',
  bucharest: 'bukarest',
  bukarest: 'bukarest',
  rugen: 'rugen',
  'ruegen': 'rugen',
  allgau: 'allgau',
  'allgaeu': 'allgau',
  albufeira: 'albufeira',
  faro: 'albufeira',
  'st julian': 'stjulians',
  'st julians': 'stjulians',
  'saint julians': 'stjulians',
  prisdorf: 'prisdorf',
  friesdorf: 'prisdorf',
  biesdorf: 'prisdorf',
};

/** DE/AT/CH/NL Abflug. */
export const ORIGIN_AIRPORTS: Record<string, SparkPin & { city: string }> = {
  HAM: { lat: 53.6304, lng: 9.9882, city: 'Hamburg' },
  HAJ: { lat: 52.4611, lng: 9.685, city: 'Hannover' },
  BRE: { lat: 53.0475, lng: 8.7867, city: 'Bremen' },
  BER: { lat: 52.3667, lng: 13.5033, city: 'Berlin' },
  TXL: { lat: 52.5597, lng: 13.2877, city: 'Berlin' },
  SXF: { lat: 52.3514, lng: 13.4939, city: 'Berlin' },
  CGN: { lat: 50.8659, lng: 7.1427, city: 'Köln' },
  DUS: { lat: 51.2895, lng: 6.7668, city: 'Düsseldorf' },
  FRA: { lat: 50.0379, lng: 8.5622, city: 'Frankfurt' },
  MUC: { lat: 48.3538, lng: 11.7861, city: 'München' },
  STR: { lat: 48.6899, lng: 9.222, city: 'Stuttgart' },
  NUE: { lat: 49.4987, lng: 11.0781, city: 'Nürnberg' },
  LEJ: { lat: 51.4324, lng: 12.2416, city: 'Leipzig' },
  DRS: { lat: 51.1344, lng: 13.7681, city: 'Dresden' },
  FMO: { lat: 52.1346, lng: 7.6848, city: 'Münster' },
  PAD: { lat: 51.6141, lng: 8.6163, city: 'Paderborn' },
  SCN: { lat: 49.2146, lng: 7.1095, city: 'Saarbrücken' },
  FKB: { lat: 48.7793, lng: 8.0805, city: 'Karlsruhe' },
  HHN: { lat: 49.9487, lng: 7.2639, city: 'Hahn' },
  NRN: { lat: 51.6024, lng: 6.1422, city: 'Weeze' },
  VIE: { lat: 48.1103, lng: 16.5697, city: 'Wien' },
  SZG: { lat: 47.7933, lng: 13.0043, city: 'Salzburg' },
  ZRH: { lat: 47.4647, lng: 8.5492, city: 'Zürich' },
  GVA: { lat: 46.2381, lng: 6.1089, city: 'Genf' },
  BSL: { lat: 47.5986, lng: 7.5292, city: 'Basel' },
  AMS: { lat: 52.3105, lng: 4.7683, city: 'Amsterdam' },
  BRU: { lat: 50.9014, lng: 4.4844, city: 'Brüssel' },
  CPH: { lat: 55.618, lng: 12.656, city: 'Kopenhagen' },
};

/** Weltweite Ziel-IATA (Pin-Placement, keine Suche). */
export const DEST_AIRPORTS: Record<string, SparkPin & { city: string }> = {
  ...ORIGIN_AIRPORTS,
  BKK: { lat: 13.69, lng: 100.75, city: 'Bangkok' },
  HKT: { lat: 8.1132, lng: 98.3169, city: 'Phuket' },
  DPS: { lat: -8.7482, lng: 115.167, city: 'Bali' },
  SIN: { lat: 1.3644, lng: 103.9915, city: 'Singapur' },
  KUL: { lat: 2.7456, lng: 101.707, city: 'Kuala Lumpur' },
  SGN: { lat: 10.8188, lng: 106.652, city: 'Ho-Chi-Minh' },
  HAN: { lat: 21.2212, lng: 105.807, city: 'Hanoi' },
  MNL: { lat: 14.5086, lng: 121.02, city: 'Manila' },
  NRT: { lat: 35.772, lng: 140.393, city: 'Tokio' },
  HND: { lat: 35.5494, lng: 139.78, city: 'Tokio' },
  ICN: { lat: 37.4602, lng: 126.441, city: 'Seoul' },
  PEK: { lat: 40.0799, lng: 116.603, city: 'Peking' },
  HKG: { lat: 22.308, lng: 113.919, city: 'Hongkong' },
  TPE: { lat: 25.0797, lng: 121.234, city: 'Taipeh' },
  DEL: { lat: 28.5562, lng: 77.1, city: 'Delhi' },
  BOM: { lat: 19.0896, lng: 72.8656, city: 'Mumbai' },
  GOI: { lat: 15.3808, lng: 73.8314, city: 'Goa' },
  DXB: { lat: 25.2532, lng: 55.3657, city: 'Dubai' },
  AUH: { lat: 24.433, lng: 54.6511, city: 'Abu Dhabi' },
  DOH: { lat: 25.2731, lng: 51.6081, city: 'Doha' },
  JFK: { lat: 40.6413, lng: -73.7781, city: 'New York' },
  EWR: { lat: 40.6895, lng: -74.1745, city: 'Newark' },
  MIA: { lat: 25.7959, lng: -80.287, city: 'Miami' },
  LAX: { lat: 33.9425, lng: -118.408, city: 'Los Angeles' },
  SFO: { lat: 37.6213, lng: -122.379, city: 'San Francisco' },
  ORD: { lat: 41.9742, lng: -87.9073, city: 'Chicago' },
  CUN: { lat: 21.0365, lng: -86.8771, city: 'Cancún' },
  MEX: { lat: 19.4361, lng: -99.0719, city: 'Mexiko-Stadt' },
  GRU: { lat: -23.4356, lng: -46.4731, city: 'São Paulo' },
  GIG: { lat: -22.8099, lng: -43.2506, city: 'Rio' },
  EZE: { lat: -34.8222, lng: -58.5358, city: 'Buenos Aires' },
  CPT: { lat: -33.9648, lng: 18.6017, city: 'Kapstadt' },
  JNB: { lat: -26.1392, lng: 28.246, city: 'Johannesburg' },
  NBO: { lat: -1.3192, lng: 36.9278, city: 'Nairobi' },
  CMN: { lat: 33.3675, lng: -7.59, city: 'Casablanca' },
  RAK: { lat: 31.6069, lng: -8.0363, city: 'Marrakesch' },
  CAI: { lat: 30.1219, lng: 31.4056, city: 'Kairo' },
  LOS: { lat: 6.5774, lng: 3.3212, city: 'Lagos' },
  SYD: { lat: -33.9399, lng: 151.175, city: 'Sydney' },
  AKL: { lat: -37.0082, lng: 174.785, city: 'Auckland' },
  PMI: { lat: 39.5517, lng: 2.7388, city: 'Palma' },
  BCN: { lat: 41.2971, lng: 2.0785, city: 'Barcelona' },
  AYT: { lat: 36.8987, lng: 30.8005, city: 'Antalya' },
  IST: { lat: 41.2753, lng: 28.7519, city: 'Istanbul' },
  LIS: { lat: 38.7742, lng: -9.1342, city: 'Lissabon' },
  OTP: { lat: 44.5711, lng: 26.085, city: 'Bukarest' },
  BUD: { lat: 47.4394, lng: 19.2619, city: 'Budapest' },
  FAO: { lat: 37.0144, lng: -7.9659, city: 'Faro' },
  MLA: { lat: 35.8575, lng: 14.4775, city: 'Malta' },
  IBZ: { lat: 38.8729, lng: 1.3731, city: 'Ibiza' },
  PRG: { lat: 50.1008, lng: 14.26, city: 'Prag' },
};

/** Bekannte Welt-Ortsnamen → Pin (nur Placement). */
const WORLD_LANDMARKS: Record<string, SparkPin> = {
  bangkok: { lat: 13.7563, lng: 100.5018 },
  phuket: { lat: 7.8804, lng: 98.3923 },
  bali: { lat: -8.4095, lng: 115.1889 },
  singapur: { lat: 1.3521, lng: 103.8198 },
  singapore: { lat: 1.3521, lng: 103.8198 },
  tokyo: { lat: 35.6762, lng: 139.6503 },
  tokio: { lat: 35.6762, lng: 139.6503 },
  seoul: { lat: 37.5665, lng: 126.978 },
  hongkong: { lat: 22.3193, lng: 114.1694 },
  delhi: { lat: 28.6139, lng: 77.209 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  goa: { lat: 15.2993, lng: 74.124 },
  dubai: { lat: 25.2048, lng: 55.2708 },
  'new york': { lat: 40.7128, lng: -74.006 },
  miami: { lat: 25.7617, lng: -80.1918 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  cancun: { lat: 21.1619, lng: -86.8515 },
  'cancún': { lat: 21.1619, lng: -86.8515 },
  'mexiko stadt': { lat: 19.4326, lng: -99.1332 },
  'mexico city': { lat: 19.4326, lng: -99.1332 },
  rio: { lat: -22.9068, lng: -43.1729 },
  'sao paulo': { lat: -23.5505, lng: -46.6333 },
  'buenos aires': { lat: -34.6037, lng: -58.3816 },
  kapstadt: { lat: -33.9249, lng: 18.4241 },
  'cape town': { lat: -33.9249, lng: 18.4241 },
  johannesburg: { lat: -26.2041, lng: 28.0473 },
  nairobi: { lat: -1.2921, lng: 36.8219 },
  marrakesch: { lat: 31.6295, lng: -7.9811 },
  marrakech: { lat: 31.6295, lng: -7.9811 },
  kairo: { lat: 30.0444, lng: 31.2357 },
  cairo: { lat: 30.0444, lng: 31.2357 },
  casablanca: { lat: 33.5731, lng: -7.5898 },
  sydney: { lat: -33.8688, lng: 151.2093 },
  vietnam: { lat: 16.0, lng: 108.0 },
  thailand: { lat: 15.0, lng: 101.0 },
  japan: { lat: 36.0, lng: 138.0 },
  indonesien: { lat: -2.0, lng: 118.0 },
  indonesia: { lat: -2.0, lng: 118.0 },
  indien: { lat: 22.0, lng: 79.0 },
  india: { lat: 22.0, lng: 79.0 },
  usa: { lat: 39.0, lng: -98.0 },
  amerika: { lat: 15.0, lng: -90.0 },
  mexiko: { lat: 23.0, lng: -102.0 },
  mexico: { lat: 23.0, lng: -102.0 },
  brasilien: { lat: -14.0, lng: -51.0 },
  brazil: { lat: -14.0, lng: -51.0 },
  afrika: { lat: 0.0, lng: 20.0 },
  africa: { lat: 0.0, lng: 20.0 },
  asien: { lat: 20.0, lng: 100.0 },
  asia: { lat: 20.0, lng: 100.0 },
  bukarest: { lat: 44.4268, lng: 26.1025 },
  bucharest: { lat: 44.4268, lng: 26.1025 },
  rugen: { lat: 54.4167, lng: 13.4 },
  ruegen: { lat: 54.4167, lng: 13.4 },
  allgau: { lat: 47.55, lng: 10.25 },
  allgaeu: { lat: 47.55, lng: 10.25 },
  albufeira: { lat: 37.0889, lng: -8.245 },
  faro: { lat: 37.0194, lng: -7.9322 },
  stjulians: { lat: 35.9182, lng: 14.4898 },
  'st julian': { lat: 35.9182, lng: 14.4898 },
  prisdorf: { lat: 53.6833, lng: 9.7667 },
  hamburg: { lat: 53.5511, lng: 9.9937 },
  lissabon: { lat: 38.7223, lng: -9.1393 },
  lisbon: { lat: 38.7223, lng: -9.1393 },
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß]+/gi, ' ')
    .trim();
}

const BY_NAME = new Map<string, SparkPin>();
const BY_ID = new Map<string, SparkPin>();

for (const p of SEED_PLACES) {
  BY_ID.set(p.id, { lat: p.lat, lng: p.lng });
  BY_NAME.set(norm(p.name), { lat: p.lat, lng: p.lng });
  if (p.wiki) BY_NAME.set(norm(p.wiki), { lat: p.lat, lng: p.lng });
  // IATA-Codes nicht als lowercase Namen — sonst „Bud“ → BUD
}

for (const [, a] of Object.entries(DEST_AIRPORTS)) {
  const cityKey = norm(a.city);
  if (!BY_NAME.has(cityKey)) {
    BY_NAME.set(cityKey, { lat: a.lat, lng: a.lng });
  }
}

for (const [name, pin] of Object.entries(WORLD_LANDMARKS)) {
  BY_NAME.set(norm(name), pin);
}

function inBounds(p: SparkPin, b: TheaterBounds): boolean {
  return p.lat >= b.latMin && p.lat <= b.latMax && p.lng >= b.lngMin && p.lng <= b.lngMax;
}

function clampBounds(b: TheaterBounds, extent: TheaterBounds): TheaterBounds {
  return {
    latMin: Math.max(extent.latMin, Math.min(b.latMin, extent.latMax - 0.5)),
    latMax: Math.min(extent.latMax, Math.max(b.latMax, extent.latMin + 0.5)),
    lngMin: Math.max(extent.lngMin, Math.min(b.lngMin, extent.lngMax - 0.5)),
    lngMax: Math.min(extent.lngMax, Math.max(b.lngMax, extent.lngMin + 0.5)),
  };
}

function padBounds(points: SparkPin[], minSpanLat = 18, minSpanLng = 28): TheaterBounds {
  let latMin = Math.min(...points.map((p) => p.lat));
  let latMax = Math.max(...points.map((p) => p.lat));
  let lngMin = Math.min(...points.map((p) => p.lng));
  let lngMax = Math.max(...points.map((p) => p.lng));
  const latPad = Math.max(minSpanLat / 2, (latMax - latMin) * 0.45 + 1.2);
  const lngPad = Math.max(minSpanLng / 2, (lngMax - lngMin) * 0.45 + 1.8);
  latMin -= latPad;
  latMax += latPad;
  lngMin -= lngPad;
  lngMax += lngPad;
  if (latMax - latMin < minSpanLat) {
    const mid = (latMin + latMax) / 2;
    latMin = mid - minSpanLat / 2;
    latMax = mid + minSpanLat / 2;
  }
  if (lngMax - lngMin < minSpanLng) {
    const mid = (lngMin + lngMax) / 2;
    lngMin = mid - minSpanLng / 2;
    lngMax = mid + minSpanLng / 2;
  }
  return { latMin, latMax, lngMin, lngMax };
}

function spanOf(points: SparkPin[]): { lat: number; lng: number } {
  const latMin = Math.min(...points.map((p) => p.lat));
  const latMax = Math.max(...points.map((p) => p.lat));
  const lngMin = Math.min(...points.map((p) => p.lng));
  const lngMax = Math.max(...points.map((p) => p.lng));
  return { lat: latMax - latMin, lng: lngMax - lngMin };
}

/** Karten-Extent des Bild-Assets (muss zu europe/world PNG passen). */
export function mapExtentForKind(mapKind: 'europe' | 'world'): TheaterBounds {
  return mapKind === 'europe' ? REGION_BOUNDS.europe : REGION_BOUNDS.world;
}

/**
 * Zoom/Crop: wie stark die Basiskarte skaliert und verschoben wird,
 * damit `viewBounds` den Screen füllt (Bayern/Ostsee = reinzoomen).
 */
export function computeMapCrop(
  viewBounds: TheaterBounds,
  mapExtent: TheaterBounds,
): { scale: number; anchorX: number; anchorY: number } {
  const mapLatSpan = Math.max(0.001, mapExtent.latMax - mapExtent.latMin);
  const mapLngSpan = Math.max(0.001, mapExtent.lngMax - mapExtent.lngMin);
  const viewLatSpan = Math.max(0.001, viewBounds.latMax - viewBounds.latMin);
  const viewLngSpan = Math.max(0.001, viewBounds.lngMax - viewBounds.lngMin);
  const scale = Math.min(
    5.2,
    Math.max(1, Math.min(mapLngSpan / viewLngSpan, mapLatSpan / viewLatSpan) * 0.92),
  );
  const cx =
    ((viewBounds.lngMin + viewBounds.lngMax) / 2 - mapExtent.lngMin) / mapLngSpan;
  const cy =
    (mapExtent.latMax - (viewBounds.latMin + viewBounds.latMax) / 2) / mapLatSpan;
  return {
    scale,
    anchorX: Math.max(0.05, Math.min(0.95, cx)),
    anchorY: Math.max(0.05, Math.min(0.95, cy)),
  };
}

/** Wählt Kartenfenster aus Live-Koordinaten — lokale Cluster zoomen (Bayern/Ostsee). */
export function resolveTheaterView(points: SparkPin[]): TheaterView {
  if (!points.length) {
    return { region: 'europe', mapKind: 'europe', bounds: REGION_BOUNDS.europe };
  }
  const regions: TheaterRegionId[] = ['europe', 'asia', 'americas', 'africa'];
  let best: TheaterRegionId = 'world';
  let bestCount = 0;
  for (const id of regions) {
    const b = REGION_BOUNDS[id];
    const n = points.filter((p) => inBounds(p, b)).length;
    if (n > bestCount) {
      bestCount = n;
      best = id;
    }
  }
  const allInEurope = points.every((p) => inBounds(p, REGION_BOUNDS.europe));
  if (allInEurope) {
    const span = spanOf(points);
    // Lokal (Bayern, Ostsee, …): eng zoomen — Startflughafen ist in points
    if (span.lat < 9 && span.lng < 12) {
      const fitted = clampBounds(padBounds(points, 3.8, 5.5), REGION_BOUNDS.europe);
      return { region: 'europe', mapKind: 'europe', bounds: fitted };
    }
    // Regional (DE/Alpen/Nordsee): mittlerer Zoom
    if (span.lat < 15 && span.lng < 18) {
      const fitted = clampBounds(padBounds(points, 7, 9), REGION_BOUNDS.europe);
      return { region: 'europe', mapKind: 'europe', bounds: fitted };
    }
    return { region: 'europe', mapKind: 'europe', bounds: REGION_BOUNDS.europe };
  }
  // Transatlantik: EU↔Amerika
  const hasEu = points.some((p) => inBounds(p, REGION_BOUNDS.europe));
  const hasAm = points.some((p) => inBounds(p, REGION_BOUNDS.americas));
  if (hasEu && hasAm) {
    return { region: 'atlantic', mapKind: 'world', bounds: REGION_BOUNDS.atlantic };
  }
  if (bestCount >= Math.ceil(points.length * 0.5) && best !== 'world') {
    const extent = REGION_BOUNDS[best];
    const span = spanOf(points);
    if (span.lat < 18 && span.lng < 28) {
      return {
        region: best,
        mapKind: 'world',
        bounds: clampBounds(padBounds(points, 8, 12), extent),
      };
    }
    return { region: best, mapKind: 'world', bounds: extent };
  }
  return {
    region: 'world',
    mapKind: 'world',
    bounds: clampBounds(padBounds(points), REGION_BOUNDS.world),
  };
}

export function approxPinForSpark(label: string): SparkPin | null {
  const n = norm(label || '');
  if (!n) return null;
  // Noise aus Spark-Labels (Preis/Flug-Schnipsel) entfernen
  const cleaned = n
    .replace(
      /\b(flug|fluege|hotel|pool|villa|warm|sonne|party|strand|ca|ab|nach|von|direkt|deal|p p|eur)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  const key = cleaned || n;

  // Nur echte IATA-Codes (ALL CAPS) — „Bud“ ≠ BUD Budapest
  const iataRaw = (label || '').trim();
  if (/^[A-Z]{3}$/.test(iataRaw) && DEST_AIRPORTS[iataRaw]) {
    const a = DEST_AIRPORTS[iataRaw];
    return { lat: a.lat, lng: a.lng };
  }

  const direct = BY_NAME.get(key) || BY_NAME.get(n);
  if (direct) return direct;

  const aliasId = ALIASES[key] || ALIASES[n];
  if (aliasId) {
    const a = BY_ID.get(aliasId);
    if (a) return a;
  }

  // Nur ganze Tokens — kein Substring („Port“ in „Portugal“ / „Bud“ in „Budapest“-Falsch-Match)
  const tokens = key.split(/\s+/).filter((t) => t.length >= 3);
  for (const [name, pin] of BY_NAME) {
    if (name.length < 4) continue;
    if (key === name || n === name) return pin;
    const nameTokens = name.split(/\s+/).filter(Boolean);
    if (nameTokens.length === 1 && tokens.includes(name)) return pin;
    if (nameTokens.length > 1 && nameTokens.every((t) => tokens.includes(t) || key.includes(t))) {
      // „palma de mallorca“ als Label vs. wiki name
      if (nameTokens.filter((t) => t.length >= 4).every((t) => key.includes(t))) return pin;
    }
  }

  for (const [alias, id] of Object.entries(ALIASES)) {
    if (alias.length >= 4 && (key === alias || tokens.includes(alias))) {
      const a = BY_ID.get(id);
      if (a) return a;
    }
  }
  return null;
}

export function airportPin(iataOrCity: string): (SparkPin & { label: string }) | null {
  const raw = (iataOrCity || '').trim();
  if (!raw) return null;
  const code = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(code) && DEST_AIRPORTS[code]) {
    const a = DEST_AIRPORTS[code];
    return { lat: a.lat, lng: a.lng, label: `${a.city} (${code})` };
  }
  const pin = approxPinForSpark(raw);
  return pin ? { ...pin, label: raw } : null;
}

export function projectPinToPercent(
  lat: number,
  lng: number,
  bounds: TheaterBounds = THEATER_BOUNDS,
): { xPct: number; yPct: number } {
  const { latMin, latMax, lngMin, lngMax } = bounds;
  const xPct = ((lng - lngMin) / Math.max(0.001, lngMax - lngMin)) * 100;
  const yPct = ((latMax - lat) / Math.max(0.001, latMax - latMin)) * 100;
  return {
    xPct: Math.max(4, Math.min(96, xPct)),
    yPct: Math.max(8, Math.min(88, yPct)),
  };
}

/** @deprecated Zufalls-Placement — nicht für Orte nutzen (Karten-Lüge). */
export function softPinPercent(label: string): { xPct: number; yPct: number } {
  let h = 0;
  const s = label || 'x';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const xPct = 18 + (h % 64);
  const yPct = 22 + ((h >>> 8) % 48);
  return { xPct, yPct };
}

function haversineKmQuick(a: SparkPin, b: SparkPin): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Erkennt vertauschte lat/lng (z. B. Lissabon −9/39 → Afrika).
 * Palma/Mittelmeer: lat ~35–42, lng ~−10…40 — Swap nur bei klarem |lat|<25.
 */
export function sanitizeLatLng(lat: number, lng: number): SparkPin | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    // Klassischer Swap: |„lat“| klein und |„lng“| im Breiten-Bereich Europas
    if (Math.abs(lat) < 25 && Math.abs(lng) >= 25 && Math.abs(lng) <= 90) {
      return { lat: lng, lng: lat };
    }
    return { lat, lng };
  }
  if (Math.abs(lng) <= 90 && Math.abs(lat) <= 180) {
    return { lat: lng, lng: lat };
  }
  return null;
}

/** Label und Geocode-Treffer müssen denselben Ort meinen (kein Namensvetter). */
export function geoNameMatchesLabel(label: string, geoLabel: string | null | undefined): boolean {
  const a = norm(label || '');
  const b = norm(geoLabel || '');
  if (!a || !b) return false;
  if (a === b) return true;
  const aTokens = a.split(/\s+/).filter((t) => t.length >= 3);
  const bTokens = b.split(/\s+/).filter((t) => t.length >= 3);
  if (!aTokens.length || !bTokens.length) return false;
  const head = aTokens[0]!;
  // Exaktes Token — „Budapest“ in „Budapest Hungary“
  if (bTokens.some((t) => t === head)) return true;
  // Prefix nur bei langen Köpfen — „Port“≠„Portugal“, „Bud“≠„Budapest“
  if (
    head.length >= 6 &&
    bTokens.some((t) => t.startsWith(head) || (t.length >= 4 && head.startsWith(t)))
  ) {
    return true;
  }
  const shared = aTokens.filter((t) => bTokens.includes(t));
  return shared.length >= Math.min(2, aTokens.length);
}

/**
 * Live-Geocode für Theater-Pins — nur mit Namens-Match.
 * Ohne Treffer: null (lieber kein Pin als falsch).
 */
export async function resolveSparkGeoLive(
  label: string,
): Promise<(SparkPin & { geoLabel?: string }) | null> {
  const exact = approxPinForSpark(label);
  if (exact) return exact;
  const q = (label || '').replace(/\s+/g, ' ').trim();
  if (q.length < 2) return null;
  try {
    const { geocodePlaceName } = await import('../../services/navigation/googleMapsNav');
    const hit = await geocodePlaceName(q);
    if (!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return null;
    const geoLabel = (hit as { label?: string }).label || q;
    if (!geoNameMatchesLabel(q, geoLabel)) return null;
    const sane = sanitizeLatLng(hit.lat, hit.lng);
    return sane ? { ...sane, geoLabel } : null;
  } catch {
    return null;
  }
}

export function enrichSparkGeo(input: {
  label: string;
  lat?: number | null;
  lng?: number | null;
}): { lat?: number; lng?: number } {
  const known = approxPinForSpark(input.label);
  const rawLat = input.lat;
  const rawLng = input.lng;
  if (
    typeof rawLat === 'number' &&
    Number.isFinite(rawLat) &&
    typeof rawLng === 'number' &&
    Number.isFinite(rawLng)
  ) {
    const sane = sanitizeLatLng(rawLat, rawLng);
    if (sane) {
      // Bekannter Ort + gelieferte Koords > ~400 km daneben → Seed gewinnen
      if (known && haversineKmQuick(known, sane) > 400) {
        return { lat: known.lat, lng: known.lng };
      }
      return { lat: sane.lat, lng: sane.lng };
    }
  }
  // Kein Seed-Default für unbekannte Labels — Live-Geocode macht der Store async
  return known ? { lat: known.lat, lng: known.lng } : {};
}

export function parseFlightLabel(label: string): {
  origins: string[];
  dest: string | null;
} {
  const t = (label || '').trim();
  const m = t.match(/^([A-Za-zÄÖÜäöü\/\s]{2,24})\s*[→\-~–]+\s*([A-Za-z]{3})\b/);
  if (!m) return { origins: [], dest: null };
  const origins = m[1]!
    .split(/[\/+,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return { origins, dest: m[2]!.toUpperCase() };
}

export function extractPriceLabel(sub?: string | null): string | null {
  if (!sub) return null;
  const m = sub.match(/(\d+)\s*€/);
  return m ? `${m[1]}€` : /€|EUR/i.test(sub) ? sub.slice(0, 12) : null;
}
