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
  /** Expedia Property-ID für /go/hotel/info/… (Zimmerwahl) */
  expediaPropertyId?: string | null;
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

const MONTHS_DE: Record<string, number> = {
  januar: 1,
  february: 2,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

function monthNum(name: string): number | null {
  const n = MONTHS_DE[name.toLowerCase()];
  return n ?? null;
}

function isoFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Wenn Check-in in der Vergangenheit liegt → Jahr +1 (nächste Saison). */
function rollForwardIfPast(checkin: string, checkout: string): {
  checkin: string;
  checkout: string;
} {
  const today = ymd(new Date());
  if (checkin >= today) return { checkin, checkout };
  const cin = new Date(checkin + 'T12:00:00');
  const cout = new Date(checkout + 'T12:00:00');
  cin.setFullYear(cin.getFullYear() + 1);
  cout.setFullYear(cout.getFullYear() + 1);
  return { checkin: ymd(cin), checkout: ymd(cout) };
}

/** True wenn User einen Zeitraum nennt (nicht „irgendwann“). */
export function hasExplicitStayDates(text: string | undefined | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (
    /\b(irgendwann|spaeter|später|mal\s+schauen|offen|egal\s+wann)\b/.test(t) &&
    !/\b(heute|morgen|übermorgen|uebermorgen|\d{1,2}\.\d{1,2}|\d{1,2}\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember))\b/.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /\b(heute|heut\s*nacht|heute\s*nacht|heute\s*abend|noch\s*heute|diese\s*nacht|naechste\s*nacht|nächste\s*nacht|morgen|übermorgen|uebermorgen|wochenende|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(
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
  // „20. bis 22. August“ / „vom 20. August bis 22.“
  if (
    /\b(?:vom?\s+)?\d{1,2}\.?\s*(?:bis|[-–])\s*\d{1,2}\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(?:vom?\s+)?\d{1,2}\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(?:bis|[-–])\s*\d{1,2}/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b\d{1,2}\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.test(
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
  // „heute bis/auf morgen“ = 1 Nacht ab heute — VOR einzelnem „morgen“
  if (/\bheute\b[\s\w]{0,24}\b(bis|auf)\s+morgen\b/.test(t)) {
    return base;
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

  // „vom 20. bis 22. August“ / „20.–22. August 2026“
  const monthSpan = t.match(
    /\b(?:vom?\s+)?(\d{1,2})\.?\s*(?:bis|[-–])\s*(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+(\d{4}))?\b/,
  );
  if (monthSpan) {
    const mon = monthNum(monthSpan[3]!);
    if (mon != null) {
      const y = monthSpan[4]
        ? Number(monthSpan[4])
        : new Date().getFullYear();
      const d1 = Number(monthSpan[1]);
      const d2 = Number(monthSpan[2]);
      if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
        let checkin = isoFromParts(y, mon, d1);
        let checkout = isoFromParts(y, mon, d2);
        if (checkout <= checkin) checkout = addDays(checkin, 1);
        return rollForwardIfPast(checkin, checkout);
      }
    }
  }

  // „vom 20. August bis 22. August“ / „20. August bis 3. September“
  const twoNamed = t.match(
    /\b(?:vom?\s+)?(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(?:bis|[-–])\s*(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)?(?:\s+(\d{4}))?\b/,
  );
  if (twoNamed) {
    const m1 = monthNum(twoNamed[2]!);
    const m2 = twoNamed[4] ? monthNum(twoNamed[4]) : m1;
    if (m1 != null && m2 != null) {
      const y = twoNamed[5] ? Number(twoNamed[5]) : new Date().getFullYear();
      const d1 = Number(twoNamed[1]);
      const d2 = Number(twoNamed[3]);
      if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
        let y2 = y;
        if (m2 < m1 || (m2 === m1 && d2 < d1)) y2 = y + 1;
        let checkin = isoFromParts(y, m1, d1);
        let checkout = isoFromParts(y2, m2, d2);
        if (checkout <= checkin) checkout = addDays(checkin, 1);
        return rollForwardIfPast(checkin, checkout);
      }
    }
  }

  // Einzelner Monatstag „am 20. August“ → 1 Nacht
  const oneNamed = t.match(
    /\b(?:am\s+)?(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+(\d{4}))?\b/,
  );
  if (oneNamed) {
    const mon = monthNum(oneNamed[2]!);
    if (mon != null) {
      const y = oneNamed[3] ? Number(oneNamed[3]) : new Date().getFullYear();
      const d = Number(oneNamed[1]);
      if (d >= 1 && d <= 31) {
        const checkin = isoFromParts(y, mon, d);
        return rollForwardIfPast(checkin, addDays(checkin, 1));
      }
    }
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
    return rollForwardIfPast(cIn, cOut <= cIn ? addDays(cIn, 1) : cOut);
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

  // Einzelner Wochentag („Donnerstag in Lübeck“) → Check-in an dem Tag, 1 Nacht
  const loneWd = t.match(
    /\b(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\w*\b/,
  );
  if (loneWd) {
    const key =
      Object.keys(WEEKDAYS_DE).find((k) => loneWd[1]!.startsWith(k)) ??
      loneWd[1]!;
    const d = WEEKDAYS_DE[key];
    if (d != null) {
      const checkin = nextWeekdayIso(new Date(), d);
      return { checkin, checkout: addDays(checkin, 1) };
    }
  }

  return base;
}

/** Hotel vs. Apartment/Ferienwohnung vs. breite Unterkunftssuche. */
export function parseLodgingTypePreference(
  text: string | undefined | null,
): 'hotel' | 'apartment' | 'any' {
  const t = (text || '').toLowerCase();
  if (
    /\b(airbnb|ferienwohnung|ferienhaus|apartment|appartement|fewo|ferienhaus|chalet|villa)\b/.test(
      t,
    )
  ) {
    return 'apartment';
  }
  if (
    /\b(unterkunft|unterkünfte|unterkuenfte|übernacht|uebernacht|schlafen|wo\s+übernacht)\b/.test(
      t,
    )
  ) {
    return 'any';
  }
  return 'hotel';
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

function readPriceTotal(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && raw && 'total' in raw) {
    const n = Number((raw as { total?: unknown }).total);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapStay(
  raw: Record<string, unknown>,
  currency: string,
  stayDates?: { checkin: string; checkout: string; adults?: number },
): HotelLiveStay | null {
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  const suppliers = (raw.suppliers ?? {}) as Record<
    string,
    { price?: { total?: number }; link?: string }
  >;
  let priceTotal: number | null = null;
  let bookUrl = typeof raw.url === 'string' ? raw.url : '';
  let expediaLink: string | null = null;
  let supplier: string | null = null;
  for (const key of ['booking', 'expedia', 'hotelscom', 'hotels', 'vrbo']) {
    const s = suppliers[key];
    if (typeof s?.link === 'string' && s.link && key === 'expedia') {
      expediaLink = s.link;
    }
    const quoted = readPriceTotal(s?.price);
    if (quoted != null) {
      priceTotal = quoted;
      if (typeof s?.link === 'string' && s.link) bookUrl = s.link;
      supplier = key;
      break;
    }
  }
  // Prefer cheapest supplier link if multiple priced
  for (const [key, s] of Object.entries(suppliers)) {
    if (typeof s?.link === 'string' && s.link && /expedia/i.test(key)) {
      expediaLink = s.link;
    }
    const quoted = readPriceTotal(s?.price);
    if (quoted == null) continue;
    if (priceTotal == null || quoted < priceTotal) {
      priceTotal = quoted;
      if (typeof s?.link === 'string' && s.link) bookUrl = s.link;
      supplier = key;
    }
  }
  // Buchungs-Button: Expedia-Property-Link bevorzugen (Zimmer + Preise), Preis bleibt günstigster
  if (expediaLink) {
    bookUrl = expediaLink;
    supplier = supplier || 'expedia';
  }

  // Property-ID aus Links / Stay22-ID ziehen
  let expediaPropertyId: string | null = null;
  try {
    const {
      extractExpediaPropertyId,
      buildExpediaHotelPropertyDeepLink,
    } = require('../affiliate/hotelPropertyDeepLink') as {
      extractExpediaPropertyId: (u: string) => string | null;
      buildExpediaHotelPropertyDeepLink: (
        id: string,
        o: { checkin: string; checkout: string; adults?: number },
      ) => string;
    };
    const candidates = [
      expediaLink,
      bookUrl,
      typeof raw.url === 'string' ? raw.url : null,
      ...Object.values(suppliers).map((s) =>
        typeof s?.link === 'string' ? s.link : null,
      ),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      const pid = extractExpediaPropertyId(c);
      if (pid) {
        expediaPropertyId = pid;
        break;
      }
    }
    const rawId = String(raw.id ?? raw.hotelId ?? raw.expediaId ?? '').trim();
    if (!expediaPropertyId && /^\d{5,}$/.test(rawId)) {
      expediaPropertyId = rawId;
    }
    // Sofort Zimmerwahl-URL bauen wenn Daten + ID da sind
    if (
      expediaPropertyId &&
      stayDates?.checkin &&
      stayDates?.checkout
    ) {
      bookUrl = buildExpediaHotelPropertyDeepLink(expediaPropertyId, {
        checkin: stayDates.checkin,
        checkout: stayDates.checkout,
        adults: stayDates.adults,
      });
      supplier = supplier || 'expedia';
    }
  } catch {
    /* soft */
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
    expediaPropertyId,
  };
}

async function stay22Search(params: {
  address?: string;
  lat?: number;
  lng?: number;
  radiusM?: number;
  hotelname?: string;
  checkin: string;
  checkout: string;
  adults?: number;
  pageSize?: number;
  /** Stay22 type filter — ohne `hotel` oft 0 Treffer. */
  lodgingType?: 'hotel' | 'apartment' | 'any' | null;
}): Promise<{ stays: HotelLiveStay[]; currency: string; error?: string }> {
  const q = new URLSearchParams({
    checkin: params.checkin,
    checkout: params.checkout,
    adults: String(params.adults ?? 2),
    children: '0',
    rooms: '1',
    currency: 'EUR',
    pageSize: String(params.pageSize ?? 20),
    // API unterstützt aktuell nur en — `de` kommt als leere results[] zurück
    lang: 'en',
  });
  const aid = getStay22AffiliateId();
  if (aid) q.set('aid', aid);

  const hasCoords =
    params.lat != null &&
    params.lng != null &&
    Number.isFinite(params.lat) &&
    Number.isFinite(params.lng);
  const address = (params.address || '').trim();
  if (address && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(address)) {
    q.set('address', address);
  } else if (hasCoords) {
    q.set('lat', String(params.lat));
    q.set('lng', String(params.lng));
    q.set('radius', String(Math.max(2000, Math.min(params.radiusM ?? 12_000, 40_000))));
  } else if (address) {
    q.set('address', address);
  }

  if (params.lodgingType === 'apartment') {
    q.set('type', 'rental');
  } else if (params.lodgingType !== 'any') {
    q.set('type', 'hotel');
  }
  if (params.hotelname) q.set('hotelsearch', params.hotelname.slice(0, 100));

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
    const stayDates = {
      checkin: params.checkin,
      checkout: params.checkout,
      adults: params.adults,
    };
    const stays = (data.results ?? [])
      .map((r) => mapStay(r, currency, stayDates))
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
 * lodgingType: hotel | apartment (Fewo/Airbnb-ähnlich) | any (beide scannen, nach Preis mergen).
 */
export async function searchStay22HotelsInCity(opts: {
  city: string;
  checkin: string;
  checkout: string;
  adults?: number;
  /** z. B. „pool sauna“ — Client-Filter, nicht in die Stay22-Adresse */
  amenityHint?: string | null;
  lodgingType?: 'hotel' | 'apartment' | 'any' | null;
  pageSize?: number;
  lat?: number | null;
  lng?: number | null;
}): Promise<{
  stays: HotelLiveStay[];
  checkin: string;
  checkout: string;
  error?: string;
}> {
  const city = (opts.city || '').trim();
  const lodging = opts.lodgingType ?? 'hotel';
  const pageSize = opts.pageSize ?? 24;
  const lat = opts.lat ?? undefined;
  const lng = opts.lng ?? undefined;

  const mergeBookable = async (
    address?: string,
  ): Promise<{ stays: HotelLiveStay[]; error?: string }> => {
    const result = await stay22Search({
      address,
      lat,
      lng,
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults ?? 1,
      pageSize,
      lodgingType: lodging,
    });
    const out = result.stays.filter(
      (s) => s.priceTotal != null && s.priceTotal > 0 && s.bookUrl,
    );
    return { stays: out, error: result.error };
  };

  const { stays: bookable, error } = await mergeBookable(
    city && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(city) ? city : undefined,
  );

  if (lodging === 'apartment' || lodging === 'any') {
    bookable.sort((a, b) => {
      const score = (s: HotelLiveStay) => {
        const blob = `${s.name} ${s.supplier ?? ''}`.toLowerCase();
        let n = 0;
        if (/vrbo|apartment|ferien|appart|airbnb|fewo|suite/.test(blob)) n += 2;
        if (s.supplier === 'vrbo') n += 2;
        return n;
      };
      const d = score(b) - score(a);
      if (d !== 0) return d;
      return (a.priceTotal ?? 9e9) - (b.priceTotal ?? 9e9);
    });
  }

  return {
    stays: bookable,
    checkin: opts.checkin,
    checkout: opts.checkout,
    error,
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
    lodgingType: 'hotel',
    lat: opts.lat ?? undefined,
    lng: opts.lng ?? undefined,
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
    lodgingType: 'hotel',
    lat: opts.lat ?? undefined,
    lng: opts.lng ?? undefined,
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
