/**
 * Hotel-Buchung: Property-Deep-Link (Zimmer wählen + Preise), nicht Stadt-Suche.
 * Flow: Live-Treffer → Expedia-Property-URL mit Daten → Affiliate-Wrapper.
 */

import { isHollowPartnerUrl, unwrapPartnerLandingUrl } from './hollowPartnerUrl';

function decodeMaybe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function isHollowGeoLabel(s: string): boolean {
  return /^(germany|deutschland|europe|europa|de|world|welt)$/i.test(s.trim());
}

/**
 * Hotelname vs. Zielstadt für Buchungs-URLs.
 * destination = Stadt/Ort der Reise — nie GPS-Heimat, nie den Hotelnamen als Stadt.
 */
export function resolveHotelBookTarget(opts: {
  hotelName?: string | null;
  city?: string | null;
  destination?: string | null;
}): { hotelName: string; city: string | null } {
  const named = String(opts.hotelName || '').trim();
  const dest = String(opts.destination || '').trim();
  let city = String(opts.city || '').trim();
  let hotelName = named;

  if (!hotelName && dest && !isHollowGeoLabel(dest)) hotelName = dest;

  if (dest && !isHollowGeoLabel(dest) && dest.toLowerCase() !== hotelName.toLowerCase()) {
    city = dest;
  } else if (!city && dest && !isHollowGeoLabel(dest) && dest.toLowerCase() !== hotelName.toLowerCase()) {
    city = dest;
  }
  if (city && isHollowGeoLabel(city)) city = '';
  if (city && hotelName && city.toLowerCase() === hotelName.toLowerCase()) {
    city = '';
  }

  const comma = hotelName.match(/,\s*([^,]+)$/);
  if (comma?.[1] && comma[1].trim().length >= 3) {
    const maybeCity = comma[1].trim();
    if (!city) city = maybeCity;
    hotelName = hotelName.slice(0, comma.index).trim() || hotelName;
  }

  hotelName = (hotelName.split(/[|,·•]/)[0] || hotelName).trim() || 'Hotel';
  return { hotelName, city: city || null };
}

/** OPEN_URL-Payload: Hotel + Stadt + Zeitraum + Gäste — damit der Tap den richtigen Link baut. */
export function hotelBookOpenUrlPayload(opts: {
  url: string;
  hotelName: string;
  city?: string | null;
  checkin: string;
  checkout: string;
  adults?: number;
}): {
  url: string;
  destName: string;
  destination: string;
  checkin: string;
  checkout: string;
  adults: number;
} {
  const t = resolveHotelBookTarget(opts);
  const adults =
    opts.adults != null && opts.adults > 0
      ? Math.min(6, Math.floor(opts.adults))
      : 2;
  return {
    url: opts.url,
    destName: t.hotelName,
    destination: t.city || t.hotelName,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults,
  };
}

function significantHotelTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/^hotel\s+/i, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (t) =>
        t.length >= 4 &&
        !/^(gmbh|hotel|inns?|suites?|the|and|und|city)$/i.test(t),
    );
}

/** True wenn der Link wirklich dieses Hotel (nicht nur eine Stadt/Heimat) trägt. */
export function hotelNameAppearsInUrl(url: string, hotelName: string): boolean {
  let blob = '';
  try {
    blob = decodeURIComponent(hotelUrlCandidates(url).join('\n')).toLowerCase();
  } catch {
    blob = url.toLowerCase();
  }
  const tokens = significantHotelTokens(hotelName);
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => blob.includes(t)).length;
  return tokens.length === 1 ? hits === 1 : hits >= Math.min(2, tokens.length);
}

/** Alle relevanten URL-Schichten (Affiliate → Landing → raw). */
export function hotelUrlCandidates(url: string): string[] {
  const raw = (url || '').trim();
  if (!raw) return [];
  const out: string[] = [raw];
  const unwrapped = unwrapPartnerLandingUrl(raw);
  if (unwrapped && unwrapped !== raw) out.push(unwrapped);
  try {
    const u = new URL(unwrapped || raw);
    for (const key of ['url', 'u', 'dest', 'destination_url', 'redirect']) {
      const v = u.searchParams.get(key);
      if (v && /^https?:/i.test(decodeMaybe(v))) {
        out.push(decodeMaybe(v));
      }
    }
  } catch {
    /* soft */
  }
  return [...new Set(out)];
}

export function extractExpediaPropertyId(url: string): string | null {
  for (const raw of hotelUrlCandidates(url)) {
    if (!raw) continue;
    const go = raw.match(/\/go\/hotel\/info\/(\d{4,})/i);
    if (go?.[1]) return go[1];
    const hDot = raw.match(/\.h(\d{5,})\.Hotel-Information/i);
    if (hDot?.[1]) return hDot[1];
    const hQuery = raw.match(
      /[?&](?:hotelid|HotelID|selected|propertyId|HTID)=(\d{4,})/i,
    );
    if (hQuery?.[1]) return hQuery[1];
    try {
      const u = new URL(raw);
      for (const key of [
        'hotelid',
        'HotelID',
        'selected',
        'propertyId',
        'HTID',
        'hotelId',
      ]) {
        const v = u.searchParams.get(key);
        if (v && /^\d{4,}$/.test(v)) return v;
      }
    } catch {
      /* soft */
    }
  }
  return null;
}

/** True wenn URL schon die Hotel-Detailseite ist (nicht Hotel-Search Stadt). */
export function isExpediaHotelPropertyUrl(url: string): boolean {
  for (const u of hotelUrlCandidates(url)) {
    if (!u) continue;
    if (/\/go\/hotel\/info\/\d+/i.test(u)) return true;
    if (/\.h\d{5,}\.Hotel-Information/i.test(u)) return true;
    if (/Hotel-Information/i.test(u) && extractExpediaPropertyId(u)) return true;
  }
  return false;
}

/** Expedia-Suchseite (Hotel wählen) — noch nicht „Zimmer auswählen“. */
export function isExpediaHotelSearchUrl(url: string): boolean {
  for (const u of hotelUrlCandidates(url)) {
    if (/expedia\.[^/\s]+\/Hotel-Search/i.test(u)) return true;
  }
  return false;
}

export function buildExpediaHotelPropertyDeepLink(
  propertyId: string,
  opts: { checkin: string; checkout: string; adults?: number },
): string {
  const id = String(propertyId || '').replace(/\D/g, '');
  const adults =
    opts.adults != null && opts.adults > 0 ? Math.min(6, Math.floor(opts.adults)) : 2;
  const nights = (() => {
    try {
      const a = new Date(opts.checkin + 'T12:00:00').getTime();
      const b = new Date(opts.checkout + 'T12:00:00').getTime();
      const n = Math.round((b - a) / 86_400_000);
      return Number.isFinite(n) && n > 0 ? n : 1;
    } catch {
      return 1;
    }
  })();
  return (
    `https://www.expedia.de/go/hotel/info/${id}/${opts.checkin}/${opts.checkout}` +
    `?NumRooms=1&NumNights=${nights}&NumAdult-Room1=${adults}` +
    `&locale=de_DE&currency=EUR`
  );
}

/** chkin/chkout auf bestehender Expedia-URL aktualisieren. */
export function injectExpediaStayDates(
  url: string,
  checkin: string,
  checkout: string,
  adults?: number,
): string {
  try {
    const u = new URL(url);
    u.searchParams.set('chkin', checkin);
    u.searchParams.set('chkout', checkout);
    if (adults != null && adults > 0) {
      u.searchParams.set('rm1', `a${adults}`);
      u.searchParams.set('NumAdult-Room1', String(adults));
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** True wenn der Link schon zur Zimmerwahl führt (nicht Hotel-Suche). */
export function isHotelRoomSelectUrl(url: string): boolean {
  const u = (url || '').trim();
  if (!u) return false;
  if (extractExpediaPropertyId(u) || isExpediaHotelPropertyUrl(u)) return true;
  if (/booking\.com\/hotel\//i.test(unwrapPartnerLandingUrl(u) || u)) return true;
  return false;
}

type AffiliateApi = {
  buildExpediaAffiliateLink: (url: string, opts?: { adref?: string | null }) => string;
  getExpediaAccommodationUrl: (
    dest: string,
    opts?: { checkin?: string; checkout?: string; adults?: number },
  ) => string;
  getExpediaCamref: () => string;
  getStay22AccommodationUrl: (
    dest: string,
    opts?: { checkin?: string; checkout?: string; adults?: number },
  ) => string;
  normalizeAffiliateUrl: (url: string) => string;
};

function loadAffiliate(): AffiliateApi {
  return require('./affiliateService') as AffiliateApi;
}

function expediaHotelSearchLanding(
  destination: string,
  opts: { checkin: string; checkout: string; adults: number },
): string {
  const dest = (destination || '').trim() || 'Germany';
  const q = new URLSearchParams({
    destination: dest,
    locale: 'de_DE',
    currency: 'EUR',
    chkin: opts.checkin,
    chkout: opts.checkout,
    rm1: `a${opts.adults}`,
  });
  return `https://www.expedia.de/Hotel-Search?${q.toString()}`;
}

function wrapHotelLanding(landing: string): string {
  try {
    const {
      buildExpediaAffiliateLink,
      getExpediaCamref,
      normalizeAffiliateUrl,
    } = loadAffiliate();
    if (/expedia\.(com|de|at|ch)\b/i.test(landing) && getExpediaCamref()) {
      return buildExpediaAffiliateLink(landing);
    }
    return normalizeAffiliateUrl(landing);
  } catch {
    return landing;
  }
}

/**
 * Sync: vorhandene bookUrl → Property-Affiliate wenn möglich, sonst Hotelname-Suche.
 */
export function finalizeHotelBookAffiliateUrl(opts: {
  hotelName: string;
  city?: string | null;
  bookUrl?: string | null;
  checkin: string;
  checkout: string;
  adults?: number;
  /** Explizite Expedia Property-ID (aus Stay22 raw.id / suppliers) */
  expediaPropertyId?: string | null;
}): string {
  const adults = opts.adults != null && opts.adults > 0 ? opts.adults : 2;
  const raw = (opts.bookUrl || '').trim();
  const target = resolveHotelBookTarget({
    hotelName: opts.hotelName,
    city: opts.city,
    destination: opts.city,
  });
  const dest = [target.hotelName, target.city]
    .map((x) => (x || '').trim())
    .filter(Boolean)
    .join(', ');

  const pidDigits = String(opts.expediaPropertyId || '').replace(/\D/g, '');
  const pid =
    (pidDigits.length >= 4 ? pidDigits : null) ||
    (raw ? extractExpediaPropertyId(raw) : null);

  if (pid) {
    return wrapHotelLanding(
      buildExpediaHotelPropertyDeepLink(pid, {
        checkin: opts.checkin,
        checkout: opts.checkout,
        adults,
      }),
    );
  }

  if (raw && /^https?:\/\//i.test(raw)) {
    const pidInRaw = extractExpediaPropertyId(raw);
    const keepNamedHotel =
      Boolean(pidInRaw) ||
      isExpediaHotelPropertyUrl(raw) ||
      hotelNameAppearsInUrl(raw, target.hotelName);
    if (!isHollowPartnerUrl(raw) && keepNamedHotel) {
      if (isExpediaHotelPropertyUrl(raw) || /expedia\.(com|de|at|ch)\b/i.test(raw)) {
        const landing = unwrapPartnerLandingUrl(raw) || raw;
        return wrapHotelLanding(
          injectExpediaStayDates(landing, opts.checkin, opts.checkout, adults),
        );
      }
      if (/stay22\.com/i.test(raw)) {
        try {
          const u = new URL(raw);
          u.searchParams.set('checkin', opts.checkin);
          u.searchParams.set('checkout', opts.checkout);
          u.searchParams.set('adults', String(adults));
          return wrapHotelLanding(u.toString());
        } catch {
          /* fall through */
        }
      }
      if (
        /booking\.com|hotels\.com|hoteis\.com|vrbo\.com/i.test(raw) &&
        !/\/search/i.test(raw)
      ) {
        return wrapHotelLanding(raw);
      }
    }
  }

  return wrapHotelLanding(
    expediaHotelSearchLanding(dest || target.hotelName, {
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults,
    }),
  );
}

/**
 * Async: Live-Lookup fürs konkrete Hotel → Property-Deep-Link (Endzustand).
 * Genau der Link, den man nach „Zimmer auswählen“ sieht.
 */
export async function resolveHotelPropertyAffiliateUrl(opts: {
  hotelName: string;
  city?: string | null;
  bookUrl?: string | null;
  checkin: string;
  checkout: string;
  adults?: number;
  expediaPropertyId?: string | null;
}): Promise<string> {
  const adults = opts.adults != null && opts.adults > 0 ? opts.adults : 2;
  const name = (opts.hotelName || '').trim();
  const city = (opts.city || '').trim();

  if (
    opts.expediaPropertyId ||
    (opts.bookUrl &&
      (extractExpediaPropertyId(opts.bookUrl) ||
        isExpediaHotelPropertyUrl(opts.bookUrl)))
  ) {
    return finalizeHotelBookAffiliateUrl(opts);
  }

  try {
    const { lookupHotelAvailability } = await import(
      '../concierge/hotelAvailabilityService'
    );
    const live = await lookupHotelAvailability({
      hotelName: name,
      city: city || name,
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults,
    });
    const hit = live.matched;
    if (hit?.bookUrl || hit?.expediaPropertyId) {
      const resolved = finalizeHotelBookAffiliateUrl({
        hotelName: hit.name || name,
        city,
        bookUrl: hit.bookUrl,
        checkin: opts.checkin,
        checkout: opts.checkout,
        adults,
        expediaPropertyId: hit.expediaPropertyId,
      });
      if (isHotelRoomSelectUrl(resolved)) return resolved;
      if (hit.bookUrl && !isExpediaHotelSearchUrl(hit.bookUrl)) {
        return finalizeHotelBookAffiliateUrl({
          hotelName: hit.name || name,
          city,
          bookUrl: hit.bookUrl,
          checkin: opts.checkin,
          checkout: opts.checkout,
          adults,
          expediaPropertyId: hit.expediaPropertyId,
        });
      }
    }
  } catch {
    /* soft */
  }

  return finalizeHotelBookAffiliateUrl({
    hotelName: name,
    city,
    bookUrl: opts.bookUrl,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults,
    expediaPropertyId: opts.expediaPropertyId,
  });
}
