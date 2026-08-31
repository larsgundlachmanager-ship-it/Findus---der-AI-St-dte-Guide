/**
 * Partner-Deep-Links (ohne RN): Datum, Personen, Checkout soweit die
 * öffentliche URL das erlaubt. Tracking hängt affiliateService an.
 */

import { encodeUriBrackets } from './partnerDeepPrefill';

export type PartyDatePrefill = {
  dateIso?: string | null;
  adults?: number | null;
  timeHm?: string | null;
};

function clampAdults(n?: number | null, fallback = 2): number {
  const v = n != null && n > 0 ? Math.floor(n) : fallback;
  return Math.min(8, Math.max(1, v));
}

function ymd(raw?: string | null): string | null {
  const m = String(raw || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return m?.[1] ?? null;
}

function hmm(raw?: string | null): string | null {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function withGygDateAdults(
  url: string,
  opts?: PartyDatePrefill & { query?: string | null },
): string {
  try {
    const u = new URL(url);
    const adults = opts?.adults;
    const date = ymd(opts?.dateIso);
    if (adults != null && adults > 0) {
      u.searchParams.set('adults', String(clampAdults(adults)));
    }
    if (date) u.searchParams.set('date_from', date);
    const q = opts?.query?.trim();
    if (q && !u.searchParams.get('q')) u.searchParams.set('q', q);
    return u.toString();
  } catch {
    return url;
  }
}

/** Produkt-Slug `…-p12345` aus Tiqets-URL. */
export function tiqetsProductSlug(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\/([^/]*-p\d+)\/?/i);
    return m?.[1] || null;
  } catch {
    const m = String(url).match(/\/([^/?#]*-p\d+)\/?/i);
    return m?.[1] || null;
  }
}

/**
 * Tiqets: Produktseite mit Datum/Slot, sonst Checkout booking_details.
 * selected_variants nur mit echter Varianten-ID (kein Fake).
 */
export function toTiqetsDeepLanding(
  url: string,
  opts?: PartyDatePrefill & { variantId?: string | null; preferCheckout?: boolean },
): string {
  const slug = tiqetsProductSlug(url);
  const date = ymd(opts?.dateIso);
  const time = hmm(opts?.timeHm);
  const adults = opts?.adults != null ? clampAdults(opts.adults) : null;
  const variant = String(opts?.variantId || '').replace(/[^\d]/g, '');
  const useCheckout = Boolean(opts?.preferCheckout && slug && date);

  let href = url;
  if (useCheckout && slug) {
    href = `https://www.tiqets.com/de/checkout/${encodeURIComponent(slug)}/booking_details/`;
  }

  try {
    const u = new URL(href);
    if (date) u.searchParams.set('selected_date', date);
    if (time) u.searchParams.set('selected_timeslot_id', time);
    if (variant && adults != null) {
      u.searchParams.set('selected_variants', `${variant}=${adults}`);
    }
    return u.toString();
  } catch {
    return href;
  }
}

export function withViatorDateAdults(url: string, opts?: PartyDatePrefill): string {
  try {
    const u = new URL(url);
    const date = ymd(opts?.dateIso);
    const adults = opts?.adults;
    if (date) {
      u.searchParams.set('date', date);
      u.searchParams.set('selectedDate', date);
    }
    if (adults != null && adults > 0) {
      const n = clampAdults(adults);
      u.searchParams.set('pax', String(n));
      u.searchParams.set('adults', String(n));
    }
    return u.toString();
  } catch {
    return url;
  }
}

export type UberGoPlace = {
  addressLine1: string;
  addressLine2?: string | null;
  latitude: number;
  longitude: number;
};

function uberPlaceJson(p: UberGoPlace): string {
  const body: Record<string, unknown> = {
    addressLine1: p.addressLine1,
    latitude: p.latitude,
    longitude: p.longitude,
    source: 'SEARCH',
    provider: 'google_places',
  };
  if (p.addressLine2?.trim()) body.addressLine2 = p.addressLine2.trim();
  return JSON.stringify(body);
}

function splitAddressLines(addr: string): { line1: string; line2?: string } {
  const t = addr.replace(/\s+/g, ' ').trim();
  const comma = t.indexOf(',');
  if (comma > 2 && comma < t.length - 2) {
    return { line1: t.slice(0, comma).trim(), line2: t.slice(comma + 1).trim() };
  }
  return { line1: t || 'Ziel' };
}

export function localPickupFormattedTime(hhmm: string, dateIso?: string | null): string {
  const clock = hmm(hhmm) || '12:00';
  const [hs, ms] = clock.split(':').map((x) => Number(x));
  if (ymd(dateIso)) {
    return `${ymd(dateIso)}T${clock}:00`;
  }
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(hs, ms, 0, 0);
  if (d.getTime() <= Date.now() - 60_000) d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}T${clock}:00`;
}

/**
 * Uber Web: Produktwahl mit Preis (jetzt) oder Reserve mit Abholzeit.
 * client_id bleibt für Affiliate-Tracking.
 */
export function buildUberGoUrl(opts: {
  clientId: string;
  dropoff: UberGoPlace;
  pickup?: UberGoPlace | null;
  pickupMyLocation?: boolean;
  /** HH:mm — wenn gesetzt → Reserve statt Sofort. */
  pickupTimeHm?: string | null;
  pickupDateIso?: string | null;
}): string {
  const clientId = encodeURIComponent(opts.clientId || '');
  const drop = encodeURIComponent(uberPlaceJson(opts.dropoff));
  const params = [`client_id=${clientId}`, `drop%5B0%5D=${drop}`];

  if (
    opts.pickup &&
    Number.isFinite(opts.pickup.latitude) &&
    Number.isFinite(opts.pickup.longitude)
  ) {
    params.push(`pickup=${encodeURIComponent(uberPlaceJson(opts.pickup))}`);
  } else if (opts.pickupMyLocation !== false) {
    params.push('pickup=my_location');
  }

  const time = hmm(opts.pickupTimeHm);
  if (time) {
    const formatted = encodeURIComponent(
      localPickupFormattedTime(time, opts.pickupDateIso),
    );
    return encodeUriBrackets(
      `https://m.uber.com/go/reserve/select-time?${params.join('&')}&pickup_formatted_time=${formatted}`,
    );
  }

  return encodeUriBrackets(
    `https://m.uber.com/go/product-selection?${params.join('&')}`,
  );
}

export function uberPlaceFromAddress(
  lat: number,
  lng: number,
  address: string,
): UberGoPlace {
  const { line1, line2 } = splitAddressLines(address);
  return {
    addressLine1: line1,
    addressLine2: line2 || null,
    latitude: lat,
    longitude: lng,
  };
}

export type DiscoverCarsSearchOpts = {
  pickupLocation?: string | null;
  pickupIata?: string | null;
  dropoffLocation?: string | null;
  dropoffIata?: string | null;
  pickupDate?: string | null;
  dropoffDate?: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
  driverAge?: number | null;
  residenceCountry?: string | null;
  affiliateAid?: string | null;
};

function utf8ToBase64(s: string): string {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(s, 'utf8').toString('base64');
    }
  } catch {
    /* RN / browser */
  }
  const bytes = unescape(encodeURIComponent(s));
  if (typeof btoa === 'function') return btoa(bytes);
  return bytes;
}

function isoDateTime(date?: string | null, time?: string | null): string | null {
  const d = ymd(date);
  if (!d) return null;
  const t = hmm(time) || '10:00';
  return `${d}T${t}:00`;
}

/** DiscoverCars: Suche starten (sq-JSON), nicht nur das Formular. */
export function buildDiscoverCarsSearchUrl(opts: DiscoverCarsSearchOpts): string {
  const pickupDt = isoDateTime(opts.pickupDate, opts.pickupTime);
  const dropDt =
    isoDateTime(opts.dropoffDate, opts.dropoffTime) || pickupDt;
  const age =
    opts.driverAge != null && opts.driverAge >= 18 && opts.driverAge <= 99
      ? Math.floor(opts.driverAge)
      : 24;
  const aid = (opts.affiliateAid || 'Yorro-Ai').trim() || 'Yorro-Ai';
  const iata = (opts.pickupIata || '').trim().toUpperCase();
  const dropIata = (opts.dropoffIata || iata).trim().toUpperCase();
  const loc = (opts.pickupLocation || '').trim();
  const dropLoc = (opts.dropoffLocation || loc).trim();

  const sq: Record<string, unknown> = {
    PickupDateTime: pickupDt,
    DropOffDateTime: dropDt,
    ResidenceCountry: (opts.residenceCountry || 'DE').trim().toUpperCase().slice(0, 2),
    DriverAge: age,
    Hash: '',
  };
  if (iata) {
    sq.PickupIata = iata;
    sq.DropOffIata = dropIata || iata;
  }
  if (loc) {
    sq.PickupLocation = loc;
    sq.DropOffLocation = dropLoc || loc;
  }

  const encoded = utf8ToBase64(JSON.stringify(sq));
  const u = new URL('https://www.discovercars.com/de/search');
  u.searchParams.set('sq', encoded);
  u.searchParams.set('searchVersion', '2');
  u.searchParams.set('a_aid', aid);
  if (iata) u.searchParams.set('pickup_iata', iata);
  if (loc && !iata) u.searchParams.set('pickup_location', loc);
  if (opts.pickupDate) u.searchParams.set('pickup_date', ymd(opts.pickupDate) || '');
  if (opts.dropoffDate) u.searchParams.set('dropoff_date', ymd(opts.dropoffDate) || '');
  u.searchParams.set('pickup_time', hmm(opts.pickupTime) || '10:00');
  u.searchParams.set('dropoff_time', hmm(opts.dropoffTime) || '10:00');
  u.searchParams.set('driver_age', String(age));
  return u.toString();
}

/** Kiwi Ergebnis-Liste: Strecke + Datum + Personen + Gepäck. */
export function buildKiwiResultsPageUrl(opts: {
  fromIata: string;
  toIata: string;
  dateKey: string;
  adults?: number;
  children?: number;
  infants?: number;
  /** Kabine.Aufgabe pro Person, z. B. 0.1 = 0 Kabine + 1 Aufgabe. */
  bagsPerAdult?: string;
}): string {
  const from = opts.fromIata.trim().toLowerCase();
  const to = opts.toIata.trim().toLowerCase();
  const date = ymd(opts.dateKey) || opts.dateKey.trim();
  const adults = clampAdults(opts.adults, 1);
  const children = Math.max(0, Math.floor(opts.children ?? 0));
  const infants = Math.max(0, Math.floor(opts.infants ?? 0));
  const per = (opts.bagsPerAdult || '0.0').trim() || '0.0';
  const bags = Array.from({ length: adults }, () => per).join('_');
  const u = new URL(
    `https://www.kiwi.com/de/search/results/${encodeURIComponent(from)}/${encodeURIComponent(to)}/${encodeURIComponent(date)}/no-return/`,
  );
  u.searchParams.set('adults', String(adults));
  u.searchParams.set('children', String(children));
  u.searchParams.set('infants', String(infants));
  u.searchParams.set('bags', bags);
  return u.toString();
}

/** Aviasales Kurz-Suche: HAM1209ATH2 = 12.09., 2 Erwachsene. */
export function buildAviasalesCompactSearchUrl(opts: {
  fromIata: string;
  toIata: string;
  dateKey: string;
  adults?: number;
  marker?: string | null;
}): string {
  const from = opts.fromIata.trim().toUpperCase();
  const to = opts.toIata.trim().toUpperCase();
  const date = ymd(opts.dateKey);
  const adults = clampAdults(opts.adults, 1);
  let code = `${from}${to}${adults}`;
  if (date) {
    const dd = date.slice(8, 10);
    const mm = date.slice(5, 7);
    code = `${from}${dd}${mm}${to}${adults}`;
  }
  const u = new URL(`https://www.aviasales.com/search/${code}`);
  if (opts.marker?.trim()) u.searchParams.set('marker', opts.marker.trim());
  return u.toString();
}

export function looksLikeGygUrl(url: string): boolean {
  return /getyourguide\.com/i.test(url);
}

export function looksLikeTiqetsUrl(url: string): boolean {
  return /tiqets\.com|awin1\.com\/cread\.php[^?\s]*12428/i.test(url);
}

export function looksLikeViatorUrl(url: string): boolean {
  return /viator\.com|tripadvisor\.com/i.test(url);
}

export function looksLikeDiscoverCarsUrl(url: string): boolean {
  return /discovercars\.com/i.test(url);
}

export function isKonfettiEventUrl(url: string): boolean {
  return /gokonfetti\.com\/[^?\s]*\/e\/[a-z0-9-]+/i.test(url);
}

/** Session-qid streichen; Event-Slug behalten. */
export function sanitizeKonfettiUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('qid');
    return u.toString();
  } catch {
    return url;
  }
}

/** Economy Bookings Promoter (Yorro Referral). */
export const ECONOMY_BOOKINGS_PROMOTER_ID = '16yupj';

function economyHhmm(time?: string | null, fallback = '10:00'): string {
  const t = hmm(time) || fallback;
  const [h, m] = t.split(':');
  return `${h}${m}`;
}

function economyYmdParts(iso?: string | null): {
  y: string;
  m: string;
  d: string;
} | null {
  const d = ymd(iso);
  if (!d) return null;
  return { y: d.slice(0, 4), m: d.slice(5, 7), d: d.slice(8, 10) };
}

export type EconomyBookingsSearchOpts = {
  pickupDate?: string | null;
  dropoffDate?: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
  driverAge?: number | null;
  pickupCountry?: string | null;
  /** Interne Location-SKU nur durchreichen. */
  pickupLocationCode?: string | null;
  dropoffLocationCode?: string | null;
  countryCode?: string | null;
};

/** Tracking auf Ergebnis-URL — nicht target_circle (fremdes Affiliate). */
export function withEconomyBookingsTracking(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('tc_id');
    u.searchParams.delete('reload');
    if (/target_circle/i.test(u.searchParams.get('utm_source') || '')) {
      u.searchParams.delete('utm_source');
      u.searchParams.delete('utm_campaign');
      u.searchParams.delete('btag');
    }
    u.searchParams.set('utm_medium', 'affiliate');
    u.searchParams.set(
      'utm_content',
      `text-link_${ECONOMY_BOOKINGS_PROMOTER_ID}`,
    );
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Economy Bookings Ergebnis-Liste.
 * `plc`/`dlc`/`cr`/`tc_id` nicht erfinden.
 */
export function buildEconomyBookingsResultsUrl(
  opts?: EconomyBookingsSearchOpts,
): string {
  const u = new URL('https://www.economybookings.com/de/cars/results');
  u.searchParams.set('lang', 'de');
  u.searchParams.set('crcy', 'EUR');
  const age =
    opts?.driverAge != null && opts.driverAge >= 18 && opts.driverAge <= 99
      ? Math.floor(opts.driverAge)
      : 24;
  u.searchParams.set('age', String(age));
  const pick = economyYmdParts(opts?.pickupDate);
  const drop = economyYmdParts(opts?.dropoffDate) || pick;
  if (pick) {
    u.searchParams.set('py', pick.y);
    u.searchParams.set('pm', pick.m);
    u.searchParams.set('pd', pick.d);
  }
  if (drop) {
    u.searchParams.set('dy', drop.y);
    u.searchParams.set('dm', drop.m);
    u.searchParams.set('dd', drop.d);
  }
  if (pick) {
    u.searchParams.set('pt', economyHhmm(opts?.pickupTime));
    u.searchParams.set('dt', economyHhmm(opts?.dropoffTime, opts?.pickupTime || '10:00'));
  }
  const pcntry = (opts?.pickupCountry || 'DE').trim().toUpperCase().slice(0, 2);
  if (/^[A-Z]{2}$/.test(pcntry)) u.searchParams.set('pcntry', pcntry);
  const plc = (opts?.pickupLocationCode || '').replace(/\D/g, '');
  const dlc = (opts?.dropoffLocationCode || plc).replace(/\D/g, '');
  if (plc) u.searchParams.set('plc', plc);
  if (dlc) u.searchParams.set('dlc', dlc);
  const cr = (opts?.countryCode || '').replace(/\D/g, '');
  if (cr) u.searchParams.set('cr', cr);
  return withEconomyBookingsTracking(u.toString());
}

/** Tote Session raus, Location-SKU und Daten behalten. */
export function sanitizeEconomyBookingsUrl(url: string): string {
  try {
    const u = new URL(url);
    if (/\/referral\//i.test(u.pathname) && !u.searchParams.get('py')) {
      return buildEconomyBookingsResultsUrl();
    }
    return withEconomyBookingsTracking(u.toString());
  } catch {
    return url;
  }
}

export function looksLikeEconomyBookingsUrl(url: string): boolean {
  return /economybookings\.com/i.test(url);
}

export function looksLikeKiwiUrl(url: string): boolean {
  return /kiwi\.com|c111\.travelpayouts\.com/i.test(url);
}

export function looksLikeAviasalesUrl(url: string): boolean {
  return /aviasales\.(com|tpx\.li)/i.test(url);
}

/** Airalo: Landesseite `/greece` — nicht `/greece-esim?selected-segment=unlimited`. */
export function buildAiraloCountryPageUrl(countrySlug: string): string {
  const slug = countrySlug
    .trim()
    .toLowerCase()
    .replace(/-esim$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'https://www.airalo.com/';
  return `https://www.airalo.com/${encodeURIComponent(slug)}`;
}

/** Travelpayouts-Wrap für Airalo-Landesseite (p=8310, Marker 760293). */
export function buildAiraloTravelpayoutsUrl(
  airaloPageUrl = 'https://www.airalo.com/',
  marker = '760293',
): string {
  const u = encodeURIComponent(airaloPageUrl);
  return (
    `https://tp.media/r?marker=${encodeURIComponent(marker)}` +
    `&p=8310&u=${u}&campaign_id=541`
  );
}

export function withCampingInfoStayParams(
  url: string,
  opts?: {
    arrival?: string | null;
    departure?: string | null;
    adults?: number | null;
    flex?: number | null;
  },
): string {
  try {
    const u = new URL(url);
    const arrival = ymd(opts?.arrival);
    const departure = ymd(opts?.departure);
    if (arrival) {
      u.searchParams.set('arrival', arrival);
      if (!u.searchParams.get('from')) u.searchParams.set('from', arrival);
    }
    if (departure) {
      u.searchParams.set('departure', departure);
      if (!u.searchParams.get('until')) u.searchParams.set('until', departure);
    }
    if (opts?.adults != null && opts.adults > 0) {
      u.searchParams.set('adults', String(clampAdults(opts.adults)));
    }
    const flex = opts?.flex;
    if (flex != null && flex > 0) u.searchParams.set('flex', String(Math.min(14, Math.floor(flex))));
    return u.toString();
  } catch {
    return url;
  }
}

/** Stadt-Hub wie campsite-athens, wenn kein konkreter Platzname da ist. */
export function campingInfoCityHubPath(cityOrQuery: string): string {
  const slug = (cityOrQuery || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!slug) return '';
  return `campsite-${slug}`;
}

export const BOUNCE_AFFILIATE_REF = 'FINDUS64751223710664';

export function extractBounceAffiliateRef(tracked?: string | null): string {
  const raw = String(tracked || '');
  const fromGo = raw.match(/go\.bounce\.com\/([A-Za-z0-9]+)/i)?.[1];
  if (fromGo) return fromGo;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const ref = u.searchParams.get('ref')?.trim();
    if (ref) return ref;
  } catch {
    /* ignore */
  }
  return BOUNCE_AFFILIATE_REF;
}

/** Bounce Datum: 2026-08-22T0000 */
export function bounceStamp(dateIso?: string | null, timeHm?: string | null): string | null {
  const d = ymd(dateIso);
  if (!d) return null;
  const clock = hmm(timeHm);
  const hhmm = clock ? clock.replace(':', '') : '0000';
  return `${d}T${hhmm}`;
}

export function bounceLocationIdFromUrl(url: string): string | null {
  const m = String(url).match(/\/s\/location\/([0-9a-f-]{8,})/i);
  return m?.[1] || null;
}

export function buildBounceBookUrl(opts: {
  ref: string;
  query?: string | null;
  lat?: number | null;
  lng?: number | null;
  locationId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  fromTimeHm?: string | null;
  toTimeHm?: string | null;
  standardBags?: number | null;
}): string {
  const ref = (opts.ref || BOUNCE_AFFILIATE_REF).trim() || BOUNCE_AFFILIATE_REF;
  const loc = (opts.locationId || '').trim();
  const href = loc
    ? `https://bounce.com/s/location/${encodeURIComponent(loc)}/book`
    : 'https://bounce.com/s';
  const u = new URL(href);
  const q = (opts.query || '').trim();
  if (q) u.searchParams.set('query', q);
  if (opts.lat != null && Number.isFinite(opts.lat)) {
    u.searchParams.set('latitude', String(opts.lat));
  }
  if (opts.lng != null && Number.isFinite(opts.lng)) {
    u.searchParams.set('longitude', String(opts.lng));
  }
  const from = bounceStamp(opts.fromDate, opts.fromTimeHm);
  const to = bounceStamp(opts.toDate, opts.toTimeHm) || from;
  if (from) u.searchParams.set('from', from);
  if (to) u.searchParams.set('to', to);
  const bags =
    opts.standardBags != null && opts.standardBags > 0
      ? Math.min(20, Math.floor(opts.standardBags))
      : null;
  if (bags != null) {
    u.searchParams.set('standardBags', String(bags));
    u.searchParams.set('compactBags', '0');
    u.searchParams.set('oddsizeBags', '0');
  }
  u.searchParams.set('ref', ref);
  u.searchParams.set('utm_source', 'affiliates');
  u.searchParams.set('utm_medium', 'link');
  return u.toString();
}

