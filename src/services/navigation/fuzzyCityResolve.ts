/**
 * Gesprochene Stadt → beste Übereinstimmung (Tippfehler/STT) oder nächste Stadt per GPS.
 * Stadt-agnostisch: bekannte Namen + Edit-Distanz, kein Einzelfall-Hardcode.
 */

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const cur = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** Kanonische Städte für Nav/Geocode (SH + häufige Packs + Metropolen). */
const KNOWN_CITIES: string[] = [
  'Wedel',
  'Pinneberg',
  'Hamburg',
  'Uetersen',
  'Tornesch',
  'Prisdorf',
  'Elmshorn',
  'Quickborn',
  'Schenefeld',
  'Halstenbek',
  'Rellingen',
  'Wangerooge',
  'Berlin',
  'München',
  'Köln',
  'Bremen',
  'Hannover',
  'Kiel',
  'Lübeck',
  'Flensburg',
  'Norderstedt',
  'Ahrensburg',
  'Stade',
  'Itzehoe',
  'Glückstadt',
  'Scharbeutz',
  'Laboe',
  'Travemünde',
  'Heiligenhafen',
  'Eckernförde',
  'Düsseldorf',
  'Dresden',
  'Stuttgart',
  'Frankfurt',
];

function maxEditDist(len: number): number {
  if (len <= 4) return 1;
  if (len <= 8) return 2;
  return 3;
}

/**
 * Geocode-Query: nie Home-Stadt anhängen, wenn der Text schon eine andere Stadt nennt
 * („Tennisclub Phoenix Lübeck“ + Profil Prisdorf → nicht „… Lübeck, Prisdorf“).
 */
export function composeGeocodeQuery(
  query: string,
  cityHint?: string | null,
): string {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return q;
  const hint = String(cityHint || '').trim();
  if (!hint) return q;
  if (q.toLowerCase().includes(hint.toLowerCase())) return q;
  const ql = q.toLowerCase();
  for (const name of KNOWN_CITIES) {
    const n = normalize(name);
    if (!n || n.length < 4) continue;
    if (ql.includes(name.toLowerCase()) || ql.includes(n)) {
      return q;
    }
  }
  return `${q}, ${hint}`;
}

export function fuzzyResolveCityName(spoken: string): string | null {
  const q = normalize(spoken);
  if (!q || q.length < 3) return null;
  // Keine generischen Wörter
  if (
    /^(den|die|das|dem|der|park|nahe|naehe|mitte|zentrum|stadt|dorf)$/.test(q)
  ) {
    return null;
  }

  let best: { name: string; score: number } | null = null;
  for (const name of KNOWN_CITIES) {
    const n = normalize(name);
    if (!n) continue;
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q) || q.startsWith(n)) score = 90;
    else if (n.includes(q) || q.includes(n)) score = 75;
    else {
      const dist = editDistance(q, n);
      const allow = maxEditDist(Math.min(q.length, n.length));
      if (Math.abs(q.length - n.length) <= allow + 1 && dist <= allow) {
        score = Math.max(45, 85 - dist * 10);
      }
    }
    if (score >= 40 && (!best || score > best.score)) {
      best = { name, score };
    }
  }
  // ≥45: Tippfehler/STT ok (z. B. Pillerberg→Pinneberg, Distanz 3)
  return best && best.score >= 45 ? best.name : null;
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export type NearbyCity = { name: string; lat: number; lng: number };

/** Nächste Stadt aus Katalog/Index (GPS). */
export function nearestCityName(
  lat: number | null | undefined,
  lng: number | null | undefined,
  cities: NearbyCity[],
): string | null {
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !cities.length
  ) {
    return null;
  }
  let best: { name: string; km: number } | null = null;
  for (const c of cities) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const km = haversineKm({ lat, lng }, { lat: c.lat, lng: c.lng });
    if (!best || km < best.km) best = { name: c.name, km };
  }
  // Nur wenn wirklich „nah“ (< 40 km) — sonst nicht raten
  return best && best.km <= 40 ? best.name : null;
}

/** Städte aus Pack-Index (sync, optional). */
export function loadNearbyCitiesFromIndex(): NearbyCity[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const index = require('../../../data/staedte/index.json') as {
      available_cities?: Array<{
        name?: string;
        lat?: number;
        lng?: number;
      }>;
    };
    return (index.available_cities ?? [])
      .filter(
        (c) =>
          typeof c.name === 'string' &&
          Number.isFinite(c.lat) &&
          Number.isFinite(c.lng),
      )
      .map((c) => ({
        name: c.name!.trim(),
        lat: c.lat!,
        lng: c.lng!,
      }));
  } catch {
    return [];
  }
}

/**
 * Straße+Nr. aus Query ziehen; optionales „in Stadt“ abschneiden.
 */
export function splitStreetAndCity(query: string): {
  street: string;
  spokenCity: string | null;
} {
  const t = query.replace(/\s+/g, ' ').trim();
  const m = t.match(
    /^(.*?\d{1,4}[a-zA-Z]?)\s*(?:,\s*|\s+in\s+)([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]*(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]*){0,2})\s*$/u,
  );
  if (m?.[1] && m[2]) {
    return { street: m[1].trim(), spokenCity: m[2].trim() };
  }
  return { street: t, spokenCity: null };
}

/** „Berlin“ und „Berlin Umland“ / „Berlin Zentral“ sind dieselbe Stadt. */
export function citiesShareCore(a: string, b: string): boolean {
  const core = (s: string) =>
    normalize(s)
      .replace(/\b(umland|zentral|mitte|stadt|region)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const na = core(a);
  const nb = core(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return false;
}

/** Pack-Koordinaten zur gesprochenen Stadt — Bias statt Live-GPS. */
export function cityCoordsFromName(name: string): NearbyCity | null {
  const resolved = fuzzyResolveCityName(name) || String(name || '').trim();
  if (!resolved) return null;
  const n = normalize(resolved);
  const cities = loadNearbyCitiesFromIndex();
  let best: { city: NearbyCity; score: number } | null = null;
  for (const c of cities) {
    const cn = normalize(c.name);
    if (!cn) continue;
    let score = 0;
    if (cn === n) score = 100;
    else if (cn.startsWith(n) || n.startsWith(cn)) score = 80;
    else if (cn.includes(n) || n.includes(cn)) score = 60;
    if (score >= 60 && (!best || score > best.score)) {
      best = { city: c, score };
    }
  }
  return best?.city ?? null;
}

/**
 * Stadt aus der Query — zuerst „Straße, Stadt“, sonst erste bekannte Stadt im Text.
 * GPS-Stadt zählt hier nicht.
 */
export function spokenCityFromQuery(query: string): string | null {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const split = splitStreetAndCity(q);
  if (split.spokenCity) {
    return fuzzyResolveCityName(split.spokenCity) || split.spokenCity;
  }
  const ql = normalize(q);
  let found: { name: string; idx: number } | null = null;
  const consider = (name: string) => {
    const n = normalize(name);
    if (!n || n.length < 4) return;
    const idx = ql.indexOf(n);
    if (idx < 0) return;
    if (!found || idx < found.idx) found = { name, idx };
  };
  for (const name of KNOWN_CITIES) consider(name);
  for (const c of loadNearbyCitiesFromIndex()) consider(c.name);
  return found?.name ?? null;
}

/**
 * Gesprochene Stadt schlägt GPS-Viewbox.
 * Ohne Pack-Koordinaten: trotzdem kein Live-GPS-Bias (sonst Düsseldorf → Berlin).
 */
export function geocodeBiasForSpokenCity(query: string): {
  cityHint: string;
  biasLat?: number;
  biasLng?: number;
} | null {
  const city = spokenCityFromQuery(query);
  if (!city) return null;
  const coords = cityCoordsFromName(city);
  return {
    cityHint: city,
    biasLat: coords?.lat,
    biasLng: coords?.lng,
  };
}

export function geocodeHitMatchesSpokenCity(
  hit: { lat: number; lng: number; label?: string | null },
  query: string,
): boolean {
  const want = spokenCityFromQuery(query);
  if (!want) return true;
  if (hit.label && normalize(hit.label).includes(normalize(want))) return true;
  const destCity = nearestCityName(
    hit.lat,
    hit.lng,
    loadNearbyCitiesFromIndex(),
  );
  return Boolean(destCity && citiesShareCore(want, destCity));
}
