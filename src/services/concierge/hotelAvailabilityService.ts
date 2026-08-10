/**
 * Live hotel availability via Stay22 Direct Travel API.
 * Demo mode works without key (rate-limited); set EXPO_PUBLIC_STAY22_API_KEY for production.
 *
 * Rule: ONLY recommend a hotel as primary if a live price exists for the date window.
 * No price → treat as unavailable → fall back to nearby priced alternatives.
 */

import { env } from '../../config/env';
import { getStay22AffiliateId } from '../affiliate/affiliateService';

const API = 'https://api.stay22.com/v2/accommodations';

export type HotelLiveStay = {
  id: string;
  name: string;
  priceTotal: number | null;
  currency: string;
  bookUrl: string;
  address?: string;
  /** Gästebewertung (z. B. 7,1 / 10 oder 4,2 / 5 — wie von Stay22 geliefert) */
  rating?: number | null;
  /** Hotelsterne wenn bekannt */
  stars?: number | null;
  lat?: number;
  lng?: number;
  amenities?: string[];
  supplier?: string | null;
};

export type HotelAvailabilityResult = {
  checkin: string;
  checkout: string;
  /** Exact/fuzzy match for the requested hotel — only if bookable (price present). */
  matched: HotelLiveStay | null;
  /** Named hotel appeared but without live price → treat as sold out / not bookable. */
  matchedUnpricedName: string | null;
  /** Nearby alternatives that DO have live prices. */
  alternatives: HotelLiveStay[];
  source: 'stay22_live' | 'stay22_error';
  error?: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Default: tonight → tomorrow (1 night). */
export function defaultHotelStayWindow(now = new Date()): {
  checkin: string;
  checkout: string;
} {
  const checkin = ymd(now);
  return { checkin, checkout: addDays(checkin, 1) };
}

const WEEKDAYS_DE: Record<string, number> = {
  sonntag: 0,
  so: 0,
  montag: 1,
  mo: 1,
  dienstag: 2,
  di: 2,
  mittwoch: 3,
  mi: 3,
  donnerstag: 4,
  do: 4,
  freitag: 5,
  fr: 5,
  samstag: 6,
  sa: 6,
};

function nextWeekdayIso(from: Date, weekday: number): string {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return ymd(d);
}

/** True wenn User einen Zeitraum nennt (nicht „irgendwann“). */
export function hasExplicitStayDates(text: string | undefined | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (
    /\b(irgendwann|spaeter|später|mal\s+schauen|offen|egal\s+wann)\b/.test(t) &&
    !/\b(heute|morgen|übermorgen|uebermorgen|\d{1,2}\.\d{1,2})\b/.test(t)
  ) {
    return false;
  }
  if (
    /\b(heute|heut\s*nacht|heute\s*nacht|heute\s*abend|noch\s*heute|diese\s*nacht|naechste\s*nacht|nächste\s*nacht|morgen|übermorgen|uebermorgen|wochenende|freitag|samstag|sonntag)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s*[-–bis]+\s*(\d{1,2})\.(\d{1,2})/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(von\s+)?(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(
      t,
    ) &&
    /\b(bis|[-–])\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Alleinreisende → 1; zu zweit → 2; Default 1 (kein stilles „2 Erwachsene“). */
export function parseHotelAdults(text: string | undefined | null): number {
  if (!text) return 1;
  const t = text.toLowerCase();
  if (
    /\b(allein|alleinreis|solo|nur\s+ich|eine\s+person|1\s*person|einzelreis)\w*\b/.test(
      t,
    )
  ) {
    return 1;
  }
  if (/\b(zu\s+zweit|zwei\s+erwachs|2\s*erwachs|paar)\w*\b/.test(t)) {
    return 2;
  }
  const n = t.match(/\b(\d)\s*(erwachs|person|leute|gaeste|gäste)/);
  if (n) {
    const v = Number(n[1]);
    if (v >= 1 && v <= 6) return v;
  }
  return 1;
}

export function parseHotelStayDates(text: string | undefined | null): {
  checkin: string;
  checkout: string;
} {
  const base = defaultHotelStayWindow();
  if (!text) return base;
  const t = text.toLowerCase();

  // „morgen bis Sonntag“ / „heute bis Freitag“ — vor Einzel-„morgen“ (sonst nur 1 Nacht)
  const relToWd = t.match(
    /\b(heute|morgen|übermorgen|uebermorgen)\b(?:[\s\w]{0,24}?)\s*(?:[-–]|bis)\s*(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\w*/,
  );
  if (relToWd) {
    const startWord = relToWd[1]!;
    const checkin =
      startWord === 'heute'
        ? base.checkin
        : /übermorgen|uebermorgen/.test(startWord)
          ? addDays(base.checkin, 2)
          : addDays(base.checkin, 1);
    const key2 =
      Object.keys(WEEKDAYS_DE).find((k) => relToWd[2]!.startsWith(k)) ??
      relToWd[2]!;
    const d2 = WEEKDAYS_DE[key2];
    if (d2 != null) {
      let checkout = nextWeekdayIso(new Date(checkin + 'T12:00:00'), d2);
      if (checkout <= checkin) {
        checkout = nextWeekdayIso(new Date(addDays(checkin, 1) + 'T12:00:00'), d2);
      }
      if (checkout <= checkin) checkout = addDays(checkin, 1);
      return { checkin, checkout };
    }
  }

  if (/\bübermorgen|uebermorgen\b/.test(t)) {
    const checkin = addDays(base.checkin, 2);
    return { checkin, checkout: addDays(checkin, 1) };
  }
  if (/\bmorgen(\s*früh|\s*frueh|\s*nacht)?\b/.test(t)) {
    const checkin = addDays(base.checkin, 1);
    return { checkin, checkout: addDays(checkin, 1) };
  }
  if (
    /\b(heute(\s*nacht|\s*abend)?|heut\s*nacht|noch\s*heute|diese\s*nacht|nächste\s*nacht|naechste\s*nacht)\b/.test(
      t,
    )
  ) {
    return base;
  }

  const range = t.match(
    /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s*[-–bis]+\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/,
  );
  if (range) {
    const y = new Date().getFullYear();
    const y1 = range[3] ? Number(range[3]) : y;
    const y2 = range[6] ? Number(range[6]) : y1;
    const cIn = `${y1 < 100 ? 2000 + y1 : y1}-${String(Number(range[2])).padStart(2, '0')}-${String(Number(range[1])).padStart(2, '0')}`;
    const cOut = `${y2 < 100 ? 2000 + y2 : y2}-${String(Number(range[5])).padStart(2, '0')}-${String(Number(range[4])).padStart(2, '0')}`;
    return { checkin: cIn, checkout: cOut };
  }

  const wd = t.match(
    /\b(?:von\s+)?(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\w*\s*(?:[-–]|bis)\s*(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\w*/,
  );
  if (wd) {
    const key1 =
      Object.keys(WEEKDAYS_DE).find((k) => wd[1]!.startsWith(k)) ?? wd[1]!;
    const key2 =
      Object.keys(WEEKDAYS_DE).find((k) => wd[2]!.startsWith(k)) ?? wd[2]!;
    const d1 = WEEKDAYS_DE[key1];
    const d2 = WEEKDAYS_DE[key2];
    if (d1 != null && d2 != null) {
      const checkin = nextWeekdayIso(new Date(), d1);
      let checkout = nextWeekdayIso(new Date(checkin + 'T12:00:00'), d2);
      if (checkout <= checkin) checkout = addDays(checkin, 1);
      return { checkin, checkout };
    }
  }

  // „Wochenende“ / „Freitag bis Sonntag“ ohne explizites „bis“-Paar oben
  if (/\bwochenende\b/.test(t) || (/\bfreitag\b/.test(t) && /\bsonntag\b/.test(t))) {
    const checkin = nextWeekdayIso(new Date(), 5); // Freitag
    const checkout = addDays(checkin, 2); // Sonntag
    return { checkin, checkout };
  }

  return base;
}

function withFindusAid(url: string): string {
  const aid = getStay22AffiliateId();
  try {
    const u = new URL(url);
    if (!/stay22\.com/i.test(u.hostname)) return url;
    u.searchParams.set('aid', aid);
    return u.toString();
  } catch {
    return url;
  }
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/^hotel\s+/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function nameScore(query: string, candidate: string): number {
  const q = normName(query);
  const c = normName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.includes(q) || q.includes(c)) return 80;
  const qt = q.split(/\s+/).filter((t) => t.length >= 3);
  let hit = 0;
  for (const t of qt) if (c.includes(t)) hit += 1;
  return qt.length ? Math.round((hit / qt.length) * 60) : 0;
}

function mapStay(
  raw: Record<string, unknown>,
  currency: string,
): HotelLiveStay | null {
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  const suppliers = (raw.suppliers ?? {}) as Record<
    string,
    { price?: { total?: number }; link?: string }
  >;
  let priceTotal: number | null = null;
  let bookUrl = typeof raw.url === 'string' ? raw.url : '';
  let supplier: string | null = null;
  for (const key of ['booking', 'expedia', 'hotels', 'vrbo']) {
    const s = suppliers[key];
    if (s?.price?.total != null && Number.isFinite(s.price.total)) {
      priceTotal = Number(s.price.total);
      if (typeof s.link === 'string' && s.link) bookUrl = s.link;
      supplier = key;
      break;
    }
  }
  // Prefer cheapest supplier link if multiple priced
  for (const [key, s] of Object.entries(suppliers)) {
    if (s?.price?.total == null || !Number.isFinite(s.price.total)) continue;
    const p = Number(s.price.total);
    if (priceTotal == null || p < priceTotal) {
      priceTotal = p;
      if (typeof s.link === 'string' && s.link) bookUrl = s.link;
      supplier = key;
    }
  }
  const loc = raw.location as
    | { address?: string; coordinates?: { lat?: number; lng?: number } }
    | undefined;
  const rating = raw.rating as { value?: number; stars?: number } | undefined;
  const starsRaw =
    typeof raw.stars === 'number'
      ? raw.stars
      : typeof raw.starRating === 'number'
        ? raw.starRating
        : rating?.stars;
  const amenitiesRaw = raw.amenities ?? raw.facilities ?? raw.features;
  const amenities = Array.isArray(amenitiesRaw)
    ? amenitiesRaw
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 24)
    : [];
  if (!bookUrl) return null;
  return {
    id: String(raw.id ?? name),
    name,
    priceTotal,
    currency,
    bookUrl: withFindusAid(bookUrl),
    address: loc?.address,
    rating: rating?.value ?? null,
    stars: typeof starsRaw === 'number' && Number.isFinite(starsRaw) ? starsRaw : null,
    lat: loc?.coordinates?.lat,
    lng: loc?.coordinates?.lng,
    amenities,
    supplier,
  };
}

async function stay22Search(params: {
  address: string;
  hotelname?: string;
  checkin: string;
  checkout: string;
  adults?: number;
  pageSize?: number;
}): Promise<{ stays: HotelLiveStay[]; currency: string; error?: string }> {
  const q = new URLSearchParams({
    address: params.address,
    checkin: params.checkin,
    checkout: params.checkout,
    adults: String(params.adults ?? 2),
    children: '0',
    rooms: '1',
    currency: 'EUR',
    pageSize: String(params.pageSize ?? 20),
    lang: 'de',
  });
  if (params.hotelname) q.set('hotelname', params.hotelname);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'FindusTravelCompanion/2.0',
  };
  const apiKey = env.stay22ApiKey();
  if (apiKey) headers['X-API-KEY'] = apiKey;

  try {
    const res = await fetch(`${API}?${q.toString()}`, { headers });
    if (!res.ok) {
      return {
        stays: [],
        currency: 'EUR',
        error: `Stay22 HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      meta?: { currency?: string };
      results?: Array<Record<string, unknown>>;
    };
    const currency = data.meta?.currency ?? 'EUR';
    const stays = (data.results ?? [])
      .map((r) => mapStay(r, currency))
      .filter((s): s is HotelLiveStay => s != null);
    return { stays, currency };
  } catch (err) {
    return {
      stays: [],
      currency: 'EUR',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * City / area search — hotels & Ferienwohnungen with live prices (Stay22).
 */
export async function searchStay22HotelsInCity(opts: {
  city: string;
  checkin: string;
  checkout: string;
  adults?: number;
  /** z. B. „pool sauna“ — erweitert die Adress-Suche, filtert nicht allein */
  amenityHint?: string | null;
  pageSize?: number;
}): Promise<{
  stays: HotelLiveStay[];
  checkin: string;
  checkout: string;
  error?: string;
}> {
  const city = (opts.city || '').trim() || 'Germany';
  const hint = (opts.amenityHint || '').trim();
  const address = hint ? `${city} hotel ${hint}` : city;
  const pageSize = opts.pageSize ?? (hint ? 40 : 24);
  const result = await stay22Search({
    address,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults ?? 1,
    pageSize,
  });
  let bookable = result.stays.filter(
    (s) => s.priceTotal != null && s.priceTotal > 0 && !!s.bookUrl,
  );
  // Zweite Runde ohne Hint, falls Hint die Treffer zu stark verengt hat
  if (hint && bookable.length < 4) {
    const plain = await stay22Search({
      address: city,
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults ?? 1,
      pageSize,
    });
    const seen = new Set(bookable.map((s) => s.id));
    for (const s of plain.stays) {
      if (s.priceTotal == null || s.priceTotal <= 0 || !s.bookUrl) continue;
      if (seen.has(s.id)) continue;
      bookable.push(s);
      seen.add(s.id);
    }
    if (!result.error && plain.error) {
      /* keep first error soft */
    }
  }
  return {
    stays: bookable,
    checkin: opts.checkin,
    checkout: opts.checkout,
    error: result.error,
  };
}

/**
 * Live lookup for a named hotel + nearby priced alternatives.
 */
export async function lookupHotelAvailability(opts: {
  hotelName: string;
  city: string;
  checkin: string;
  checkout: string;
  adults?: number;
  lat?: number | null;
  lng?: number | null;
}): Promise<HotelAvailabilityResult> {
  const address = opts.city
    ? `${opts.hotelName}, ${opts.city}`
    : opts.hotelName;

  const primary = await stay22Search({
    address,
    hotelname: opts.hotelName.replace(/^hotel\s+/i, '').trim(),
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults,
  });

  if (primary.error && primary.stays.length === 0) {
    return {
      checkin: opts.checkin,
      checkout: opts.checkout,
      matched: null,
      matchedUnpricedName: null,
      alternatives: [],
      source: 'stay22_error',
      error: primary.error,
    };
  }

  let best: HotelLiveStay | null = null;
  let bestScore = 0;
  for (const s of primary.stays) {
    const sc = nameScore(opts.hotelName, s.name);
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }

  const matchedBookable =
    best && bestScore >= 50 && best.priceTotal != null && best.priceTotal > 0
      ? best
      : null;
  const matchedUnpricedName =
    best && bestScore >= 50 && (best.priceTotal == null || best.priceTotal <= 0)
      ? best.name
      : null;

  // Nearby city search for alternatives with prices
  const citySearch = await stay22Search({
    address: opts.city || opts.hotelName,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults,
  });

  const alternatives = citySearch.stays
    .filter(
      (s) =>
        s.priceTotal != null &&
        s.priceTotal > 0 &&
        (!matchedBookable || s.id !== matchedBookable.id) &&
        nameScore(opts.hotelName, s.name) < 80,
    )
    .slice(0, 4);

  return {
    checkin: opts.checkin,
    checkout: opts.checkout,
    matched: matchedBookable,
    matchedUnpricedName,
    alternatives,
    source: 'stay22_live',
  };
}
