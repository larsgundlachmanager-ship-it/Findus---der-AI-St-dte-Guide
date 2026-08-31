/**
 * Travelpayouts-Partner: öffentliche Deep-URLs + stabile Tracking-Params
 * aus den echten tpx.li-Redirects (Marker 760293).
 * Keine erfundenen Product-/Location-/Checkout-Tokens.
 */

import { encodeUriBrackets } from './partnerDeepPrefill';

export const TPX_MARKER = '760293';

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

function clampAdults(n?: number | null, fallback = 2): number {
  const v = n != null && n > 0 ? Math.floor(n) : fallback;
  return Math.min(8, Math.max(1, v));
}

export function slugifyTpxCity(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function stamp(url: string, pairs: Record<string, string>): string {
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(pairs)) {
      if (!u.searchParams.get(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Klook Activity + Affiliate-Redirect (aff_pid aus TPX-Hop). */
export function withKlookAffiliate(activityUrl: string, marker = TPX_MARKER): string {
  let page = activityUrl.trim();
  try {
    const u = new URL(page);
    u.searchParams.set('aff_pid', marker);
    u.searchParams.set('utm_source', 'travelpayouts');
    u.searchParams.set('utm_medium', 'affiliate-alwayson');
    page = u.toString();
  } catch {
    /* keep */
  }
  const aid = `api|13694|${marker}|pid|${marker}`;
  return (
    `https://affiliate.klook.com/redirect?aid=${encodeURIComponent(aid)}` +
    `&k_site=${encodeURIComponent(page)}`
  );
}

/** KKday Produkt + invl.me (TPX). */
export function withKkdayAffiliate(productUrl: string, marker = TPX_MARKER): string {
  return `https://invl.me/clndj1c?aff_sub=${encodeURIComponent(marker)}&url=${encodeURIComponent(productUrl.trim())}`;
}

/** WeGoTrip: date + Personen auf Produkt-URL, sub_id Tracking. */
export function withWegotripPrefill(
  productUrl: string,
  opts?: { dateIso?: string | null; adults?: number | null },
): string {
  try {
    const u = new URL(productUrl);
    const date = ymd(opts?.dateIso);
    if (date) u.searchParams.set('date', date);
    u.searchParams.set('sub_id', TPX_MARKER);
    u.searchParams.set('utm_source', 'travelpayouts');
    return u.toString();
  } catch {
    return productUrl;
  }
}

/** Go City Explorer-Pass (kein Trip-Planner-UUID erfinden). */
export function buildGoCityExplorerUrl(opts: {
  citySlug: string;
  adults?: number | null;
  children?: number | null;
  plusDays?: number | null;
  standardChoices?: number | null;
}): string {
  const slug = slugifyTpxCity(opts.citySlug);
  const u = new URL(
    slug
      ? `https://gocity.com/en/${encodeURIComponent(slug)}/passes/explorer`
      : 'https://gocity.com/en/',
  );
  if (slug) {
    u.searchParams.set(
      'standard-choices',
      String(opts.standardChoices && opts.standardChoices > 0 ? Math.min(12, opts.standardChoices) : 5),
    );
    u.searchParams.set(
      'plus-days',
      String(opts.plusDays && opts.plusDays > 0 ? Math.min(7, opts.plusDays) : 2),
    );
    u.searchParams.set('adults', String(clampAdults(opts.adults)));
    u.searchParams.set(
      'children',
      String(
        opts.children != null && opts.children >= 0
          ? Math.min(8, Math.floor(opts.children))
          : 0,
      ),
    );
  }
  return withGoCityAffiliate(u.toString());
}

export function withGoCityAffiliate(pageUrl: string, marker = TPX_MARKER): string {
  return (
    `https://prf.hn/click/camref:1100l4xn8/pubref:${encodeURIComponent(marker)}` +
    `/destination:${pageUrl.trim()}`
  );
}

function usSlashDate(iso?: string | null): string | null {
  const d = ymd(iso);
  if (!d) return null;
  const [y, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}/${y}`;
}

/**
 * Welcome Pickups Transfer-Formular.
 * Location-IDs (from_location_id) nur durchreichen, nie erfinden.
 */
export function buildWelcomePickupsTransferUrl(opts: {
  citySlug: string;
  dateIso?: string | null;
  timeHm?: string | null;
  passengers?: number | null;
  luggage?: number | null;
  fromName?: string | null;
  fromAddress?: string | null;
  fromLat?: number | null;
  fromLng?: number | null;
  fromType?: 'hotel' | 'airport' | 'destination' | null;
  toName?: string | null;
  toAddress?: string | null;
  toLat?: number | null;
  toLng?: number | null;
  toType?: 'hotel' | 'airport' | 'hub' | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
}): string {
  const city = slugifyTpxCity(opts.citySlug) || 'city';
  const u = new URL(
    `https://traveler.welcomepickups.com/en/${encodeURIComponent(city)}/transfer/new`,
  );
  u.searchParams.set('city', city);
  u.searchParams.set('passengers', String(clampAdults(opts.passengers)));
  u.searchParams.set(
    'luggage',
    String(
      opts.luggage != null && opts.luggage > 0
        ? Math.min(20, Math.floor(opts.luggage))
        : 2,
    ),
  );
  const date = usSlashDate(opts.dateIso);
  if (date) u.searchParams.set('date', date);
  const time = hmm(opts.timeHm) || '10:00';
  u.searchParams.set('time', time);
  u.searchParams.set('from_time_as_pickup', '1');
  const fromName = (opts.fromName || '').trim();
  if (fromName) u.searchParams.set('from', fromName);
  const fromAddr = (opts.fromAddress || '').trim();
  if (fromAddr) u.searchParams.set('from_address', fromAddr);
  if (opts.fromLat != null && Number.isFinite(opts.fromLat)) {
    u.searchParams.set('from_lat', String(opts.fromLat));
  }
  if (opts.fromLng != null && Number.isFinite(opts.fromLng)) {
    u.searchParams.set('from_lng', String(opts.fromLng));
  }
  const fromType = opts.fromType || (fromName ? 'destination' : null);
  if (fromType) {
    u.searchParams.set('from_type', fromType);
    u.searchParams.set(
      'from_category',
      fromType === 'airport' ? 'hub' : 'destination',
    );
  }
  const toName = (opts.toName || '').trim();
  if (toName) u.searchParams.set('to', toName);
  const toAddr = (opts.toAddress || '').trim();
  if (toAddr) u.searchParams.set('to_address', toAddr);
  if (opts.toLat != null && Number.isFinite(opts.toLat)) {
    u.searchParams.set('to_lat', String(opts.toLat));
  }
  if (opts.toLng != null && Number.isFinite(opts.toLng)) {
    u.searchParams.set('to_lng', String(opts.toLng));
  }
  const toType = opts.toType || (toName ? 'airport' : null);
  if (toType) {
    u.searchParams.set('to_type', toType === 'hub' ? 'airport' : toType);
    u.searchParams.set(
      'to_category',
      toType === 'hotel' ? 'destination' : 'hub',
    );
  }
  if (opts.fromLocationId?.trim()) {
    u.searchParams.set('from_location_id', opts.fromLocationId.trim());
  }
  if (opts.toLocationId?.trim()) {
    u.searchParams.set('to_location_id', opts.toLocationId.trim());
  }
  u.searchParams.set('aff_track_id', TPX_MARKER);
  u.searchParams.set('utm_source', 'travelpayouts');
  return u.toString();
}

export function buildGetTransferNewUrl(): string {
  return stamp('https://gettransfer.com/de/transfers/new', {
    sub_id: TPX_MARKER,
    utm_source: 'travelpayouts',
    utm_campaign: 'travelpayouts',
    utm_medium: 'cpa',
  });
}

/** KiwiTaxi: Checkout-Token nie erfinden — nur Tracking auf vorhandener URL. */
export function withKiwitaxiTracking(pageUrl: string): string {
  return stamp(pageUrl, {
    tpo: TPX_MARKER,
    utm_source: 'travelpayouts',
  });
}

export function withIntuiTracking(pageUrl: string): string {
  return stamp(pageUrl, {
    partnerID: '287737',
    subID: TPX_MARKER,
    utm_source: 'travelpayouts',
  });
}

export function buildLocalrentSearchUrl(opts: {
  countrySlug: string;
  pickupDate?: string | null;
  dropoffDate?: string | null;
  pickupCode?: string | null;
  dropoffCode?: string | null;
}): string {
  const country = slugifyTpxCity(opts.countrySlug);
  const u = new URL(
    country
      ? `https://www.localrent.com/en/${encodeURIComponent(country)}/`
      : 'https://www.localrent.com/en/',
  );
  const pick = ymd(opts.pickupDate);
  const drop = ymd(opts.dropoffDate) || pick;
  if (pick) u.searchParams.set('pickup_date', pick);
  if (drop) u.searchParams.set('dropoff_date', drop);
  if (opts.pickupCode?.trim()) u.searchParams.set('pc', opts.pickupCode.trim().toUpperCase());
  if (opts.dropoffCode?.trim() || opts.pickupCode?.trim()) {
    u.searchParams.set(
      'dc',
      (opts.dropoffCode || opts.pickupCode || '').trim().toUpperCase(),
    );
  }
  u.searchParams.set('currency', 'EUR');
  u.searchParams.set('r', '2869');
  u.searchParams.set('utm_source', 'travelpayouts');
  return u.toString();
}

function deDotDate(iso?: string | null): string | null {
  const d = ymd(iso);
  if (!d) return null;
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

export function buildGetRentacarRequestUrl(opts: {
  pickupLocation: string;
  pickupDate?: string | null;
  returnDate?: string | null;
}): string {
  const loc = opts.pickupLocation.trim();
  const u = new URL('https://getrentacar.com/de/autovermietung/request');
  u.searchParams.set('vehicleSegment', 'cars');
  if (loc) u.searchParams.set('pickup[location]', loc);
  const pick = deDotDate(opts.pickupDate);
  const ret = deDotDate(opts.returnDate) || pick;
  if (pick) u.searchParams.set('pickup[date]', pick);
  if (ret) u.searchParams.set('return[date]', ret);
  u.searchParams.set('track_id', TPX_MARKER);
  u.searchParams.set('utm_source', 'travelpayouts');
  u.searchParams.set('utm_campaign', 'partner');
  u.searchParams.set('utm_medium', 'partner_cpa');
  return encodeUriBrackets(u.toString());
}

export function buildAutoEuropeResultsUrl(): string {
  return stamp('https://www.autoeurope.eu/results/', {
    aff: 'travelpayoutseu',
    sub_id: TPX_MARKER,
  });
}

export function buildBikesbookingSearchUrl(opts: {
  beginIso?: string | null;
  endIso?: string | null;
}): string {
  const begin = ymd(opts.beginIso);
  const end = ymd(opts.endIso) || begin;
  const u = new URL('https://bikesbooking.com/en/search/');
  if (begin) u.searchParams.set('begin', `${begin}T08:00:00.000Z`);
  if (end) u.searchParams.set('end', `${end}T08:00:00.000Z`);
  u.searchParams.set('returnAtSameCity', 'true');
  u.searchParams.set('ordering', 'recommended');
  u.searchParams.set('sub_id', TPX_MARKER);
  u.searchParams.set('utm_source', 'travelpayouts');
  return u.toString();
}

/** Vorhandene Partner-URL: Tiefe behalten, Tracking stempeln. */
export function stampTpxPartnerTracking(url: string): string {
  const raw = url.trim();
  if (!raw) return raw;
  if (/klook\.com|affiliate\.klook\.com/i.test(raw)) {
    if (/affiliate\.klook\.com/i.test(raw)) return raw;
    return withKlookAffiliate(raw);
  }
  if (/kkday\.com|invl\.me/i.test(raw)) {
    if (/invl\.me/i.test(raw)) return raw;
    return withKkdayAffiliate(raw);
  }
  if (/wegotrip\.com/i.test(raw)) return withWegotripPrefill(raw);
  if (/gocity\.com|prf\.hn\/click/i.test(raw)) {
    if (/prf\.hn/i.test(raw)) return raw;
    return withGoCityAffiliate(raw);
  }
  if (/welcomepickups\.com/i.test(raw)) {
    return stamp(raw, {
      aff_track_id: TPX_MARKER,
      utm_source: 'travelpayouts',
    });
  }
  if (/gettransfer\.com/i.test(raw)) {
    return stamp(raw, {
      sub_id: TPX_MARKER,
      utm_source: 'travelpayouts',
      utm_campaign: 'travelpayouts',
      utm_medium: 'cpa',
    });
  }
  if (/kiwitaxi\.com/i.test(raw)) return withKiwitaxiTracking(raw);
  if (/intui\.travel/i.test(raw)) return withIntuiTracking(raw);
  if (/localrent\.com/i.test(raw)) {
    return stamp(raw, { r: '2869', utm_source: 'travelpayouts' });
  }
  if (/getrentacar\.com/i.test(raw)) {
    return stamp(raw, {
      track_id: TPX_MARKER,
      utm_source: 'travelpayouts',
    });
  }
  if (/autoeurope\.(eu|com)/i.test(raw)) {
    return stamp(raw, { aff: 'travelpayoutseu', sub_id: TPX_MARKER });
  }
  if (/bikesbooking\.com/i.test(raw)) {
    return stamp(raw, { sub_id: TPX_MARKER, utm_source: 'travelpayouts' });
  }
  if (/radicalstorage\.com/i.test(raw)) {
    return stamp(raw, { track_id: TPX_MARKER, utm_term: 'travelpayouts' });
  }
  if (/airhelp\.com|funnel\.airhelp\.com/i.test(raw)) {
    return stamp(raw, {
      a_aid: 'Travelpayouts',
      data1: TPX_MARKER,
      utm_campaign: 'aff-Travelpayouts',
      utm_medium: 'affiliate',
      utm_source: 'pap',
    });
  }
  if (/compensair\.com/i.test(raw)) {
    return stamp(raw, {
      sub_id: TPX_MARKER,
      utm_medium: 'affiliate',
      utm_source: 'travelpayouts',
    });
  }
  if (/qeeq\.com/i.test(raw)) {
    return stamp(raw, { sub_id: TPX_MARKER, utm_source: 'travelpayouts' });
  }
  if (/saily\.com|go\.saily\.site/i.test(raw)) {
    if (/go\.saily\.site/i.test(raw)) return raw;
    return withSailyAffiliate(raw);
  }
  if (/yesim\.tech/i.test(raw)) {
    return stamp(raw, {
      partner_id: '636',
      pid: 'partner636',
      af_sub1: '636',
      c: 'Partners',
      sub_id: TPX_MARKER,
    });
  }
  return raw;
}

function isoStamp(dateIso?: string | null, timeHm?: string | null): string | null {
  const d = ymd(dateIso);
  if (!d) return null;
  const clock = hmm(timeHm) || '11:00';
  const [hh, mm] = clock.split(':');
  const local = new Date(`${d}T${hh}:${mm}:00`);
  const tzMin = -local.getTimezoneOffset();
  const sign = tzMin >= 0 ? '+' : '-';
  const abs = Math.abs(tzMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${d}T${hh}:${mm}:00${sign}${oh}:${om}`;
}

/**
 * Radical Storage: Stadt + GPS + Abgabe/Abholung.
 * Spot-Slugs (…/city-centre/…-train-station) nur durchreichen, nie erfinden.
 */
export function buildRadicalStorageUrl(opts: {
  citySlug?: string | null;
  spotPath?: string | null;
  lat?: number | null;
  lng?: number | null;
  dropOffIso?: string | null;
  pickUpIso?: string | null;
  dropOffTimeHm?: string | null;
  pickUpTimeHm?: string | null;
  bags?: number | null;
}): string {
  const city = slugifyTpxCity(opts.citySlug || '');
  const spot = (opts.spotPath || '').replace(/^\/+|\/+$/g, '');
  const path = spot
    ? `/${spot.replace(/^luggage-storage\//i, 'luggage-storage/')}`
    : city
      ? `/luggage-storage/${encodeURIComponent(city)}`
      : '/luggage-storage';
  const href = path.startsWith('/luggage-storage')
    ? `https://radicalstorage.com${path.startsWith('/') ? path : `/${path}`}`
    : `https://radicalstorage.com/luggage-storage/${path}`;
  const u = new URL(href);
  if (city) u.searchParams.set('s', city);
  if (opts.lat != null && Number.isFinite(opts.lat)) {
    u.searchParams.set('lat', String(opts.lat));
  }
  if (opts.lng != null && Number.isFinite(opts.lng)) {
    u.searchParams.set('lng', String(opts.lng));
  }
  const drop = isoStamp(opts.dropOffIso, opts.dropOffTimeHm);
  const pick = isoStamp(opts.pickUpIso, opts.pickUpTimeHm) || drop;
  if (drop) u.searchParams.set('dropOff', drop);
  if (pick) u.searchParams.set('pickUp', pick);
  const bags =
    opts.bags != null && opts.bags > 0 ? Math.min(20, Math.floor(opts.bags)) : 2;
  u.searchParams.set('bags', String(bags));
  u.searchParams.set('bagsSmall', '0');
  u.searchParams.set('bagsLarge', '0');
  u.searchParams.set('track_id', TPX_MARKER);
  u.searchParams.set('utm_term', 'travelpayouts');
  return u.toString();
}

export function buildAirhelpClaimUrl(): string {
  return stamp('https://funnel.airhelp.com/claims/new/trip-details', {
    a_aid: 'Travelpayouts',
    data1: TPX_MARKER,
    utm_campaign: 'aff-Travelpayouts',
    utm_medium: 'affiliate',
    utm_source: 'pap',
  });
}

export function buildCompensairCheckUrl(): string {
  return stamp('https://www.compensair.com/de/check-flight.html', {
    sub_id: TPX_MARKER,
    utm_medium: 'affiliate',
    utm_source: 'travelpayouts',
  });
}

/** QEEQ Karten-Suche am Standort — Listing-`id` nie erfinden. */
export function buildQeeqSearchMapUrl(opts: {
  lat: number;
  lng: number;
}): string {
  const u = new URL('https://www.qeeq.com/car/search_map');
  u.searchParams.set('pickup_lat', String(opts.lat));
  u.searchParams.set('pickup_lng', String(opts.lng));
  u.searchParams.set('dropoff_lat', String(opts.lat));
  u.searchParams.set('dropoff_lng', String(opts.lng));
  u.searchParams.set('utm_source', 'travelpayouts');
  u.searchParams.set('sub_id', TPX_MARKER);
  return u.toString();
}

export function buildSailyCountryPageUrl(countrySlug: string): string {
  const slug = slugifyTpxCity(countrySlug).replace(/-esim$/i, '');
  if (!slug) return 'https://saily.com/de/';
  return `https://saily.com/de/esim-${encodeURIComponent(slug)}/`;
}

export function withSailyAffiliate(pageUrl: string, marker = TPX_MARKER): string {
  return (
    `https://go.saily.site/aff_c?aff_id=8014&offer_id=126` +
    `&aff_sub=${encodeURIComponent(marker)}` +
    `&url=${encodeURIComponent(pageUrl.trim())}`
  );
}

export function buildYesimCountryPageUrl(countrySlug: string): string {
  const slug = slugifyTpxCity(countrySlug);
  if (!slug) return 'https://yesim.tech/';
  const u = new URL(`https://yesim.tech/country/${encodeURIComponent(slug)}/`);
  u.searchParams.set('partner_id', '636');
  u.searchParams.set('pid', 'partner636');
  u.searchParams.set('af_sub1', '636');
  u.searchParams.set('c', 'Partners');
  u.searchParams.set('sub_id', TPX_MARKER);
  return u.toString();
}
