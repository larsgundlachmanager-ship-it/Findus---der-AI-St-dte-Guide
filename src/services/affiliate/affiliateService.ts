/**
 * Affiliate-Links & Widgets (Findus Monetarisierungs-Kern):
 * - GetYourGuide Partner ZVQGONB (partner_id)
 * - Musement / TUI Affiliate findus-8445 (aid + client_id)
 * - Viator / TripAdvisor Partner P00311883 (pid + mcid + medium)
 * - Uber Client ID 4a6yecXWLriTzMd4uqp41cVz2dDdlpSB
 * - DiscoverCars Mietwagen a_aid=Findus-Ai (Primär BOOK_CAR_RENTAL)
 * - Economy Bookings Mietwagen Referral 16yupj/l0j2ln (Backup)
 * - TravelSecure DE AWIN mid=106517 / publisher 3021215
 * - travSIM DACH AWIN mid=15561 / publisher 3021215 (Primär eSIM)
 * - Tiqets AWIN mid=12428 (bis ~6 %, Primär EU-Tickets; Env override)
 * - Bounce Gepäckaufbewahrung FINDUS64751223710664
 * - Expedia Partnerize camref 1101l5Qcvp (Primär Unterkunft)
 * - Stay22 Unterkünfte Affiliate findus (Backup / Live-Preis)
 * - Travelpayouts Marker 760293 → siehe travelpayoutsPartners.ts
 *
 * PLACEHOLDER (Env-Slots, noch keine Deep-Link-APIs):
 * - OpenTable → getOpenTableAffiliateId / getOpenTableBookingUrl → null (keine Booking-Buttons)
 * - Quandoo → getQuandooPartnerId / getQuandooBookingUrl → null (keine Booking-Buttons)
 *
 * eSIM: travSIM AWIN (Primär) → Airalo TPX/Env (Fallback)
 *
 * Exportierte URL-Utilities (dynamisch aus Env + Defaults):
 * getStay22AccommodationUrl, buildExpediaAffiliateLink, getExpediaHotelSearchUrl,
 * getTravSimUrl, getEsimAffiliateUrl, getTiqetsUrl, getBounceLuggageUrl,
 * getUberRideUrl, getCarRentalUrl, getViatorBookingUrl, getMusementBookingUrl,
 * buildGetYourGuideTourUrl, preferTicketSource, getAiraloAffiliateUrl, buildEsimAction
 */

import { Linking } from 'react-native';
import { env } from '../../config/env';
import { getCachedUserProfile } from '../userProfileService';
import {
  TRAVELPAYOUTS_MARKER,
  TRAVELPAYOUTS_PARTNERS,
  getTravelpayoutsUrl,
  pickTourPartnerId,
  pickPrimaryPartner,
} from './travelpayoutsPartners';

/** Findus GetYourGuide Partner-ID (Affiliate). */
export const GYG_PARTNER_ID = 'ZVQGONB';

/** Findus Musement / TUI Affiliate-ID. */
export const MUSEMENT_AFFILIATE_ID = 'findus-8445';

/** Findus Viator (TripAdvisor) Partner-ID. */
export const VIATOR_PARTNER_ID = 'P00311883';

/** Viator Media Campaign ID (Affiliate Tracking). */
export const VIATOR_MCID = '42383';

/** Findus Uber Client-ID (Deep Links). */
export const UBER_CLIENT_ID = '4a6yecXWLriTzMd4uqp41cVz2dDdlpSB';

/** Economy Bookings Mietwagen-Referral (Findus) — Backup. */
export const ECONOMY_BOOKINGS_REFERRAL_URL =
  'https://www.economybookings.com/de/referral/16yupj/l0j2ln';

/** DiscoverCars Mietwagen Affiliate (Findus) — Primär (~$20 avg / Booking). */
export const DISCOVER_CARS_AFFILIATE_URL =
  'https://www.discovercars.com/?a_aid=Findus-Ai';

/** AWIN Publisher-ID (Findus). */
export const AWIN_PUBLISHER_ID = '3021215';

/** TravelSecure DE — AWIN Advertiser (Reiseversicherung). */
export const TRAVELSECURE_AWIN_MID = '106517';

/** travSIM DACH — AWIN Advertiser (eSIM / Travel-SIM). */
export const TRAVSIM_AWIN_MID = '15561';

/**
 * Tiqets AWIN Advertiser — Default US/Intl (6 % „other sites“, wie Welcome-Mail).
 * Falls dein Programm eine andere Mid hat (UK 12430 / FR 7437): Env setzen.
 */
export const TIQETS_AWIN_MID = '12428';

/** Bounce Gepäckaufbewahrung Affiliate-Link (Findus). */
export const BOUNCE_LUGGAGE_URL =
  'https://go.bounce.com/FINDUS64751223710664';

/** Findus Stay22 Affiliate-ID (Unterkünfte). */
export const STAY22_AFFILIATE_ID = 'findus';

const STAY22_HOST = 'https://www.stay22.com';

/** Campaign-Tag für Attribution in der App. */
export const GYG_CMP = 'findus_app';
export const MUSEMENT_CID = 'findus_app';
export const VIATOR_MEDIUM = 'link';

const GYG_HOST = 'https://www.getyourguide.com';
const MUSEMENT_HOST = 'https://www.musement.com';
const VIATOR_HOST = 'https://www.viator.com';
const GYG_WIDGET_SCRIPT =
  'https://widget.getyourguide.com/dist/pa.umd.production.min.js';

export function getGygPartnerId(): string {
  return env.gygPartnerId() || GYG_PARTNER_ID;
}

export function getMusementAffiliateId(): string {
  return env.musementAffiliateId() || MUSEMENT_AFFILIATE_ID;
}

export function getViatorPartnerId(): string {
  return env.viatorPartnerId() || VIATOR_PARTNER_ID;
}

export function getViatorMcid(): string {
  return env.viatorMcid() || VIATOR_MCID;
}

export function getUberClientId(): string {
  return env.uberClientId() || UBER_CLIENT_ID;
}

async function openAffiliateUrl(url: string, reason = 'AFFILIATE'): Promise<void> {
  try {
    const { armLinkBackgroundSpeech } = await import(
      '../speech/backgroundSpeechPolicy'
    );
    armLinkBackgroundSpeech({ reason });
  } catch {
    /* soft */
  }
  await Linking.openURL(url);
}

/**
 * Mietwagen-Buchungs-URL — Primär DiscoverCars (a_aid=Findus-Ai).
 * Optional Env-Override; Economy Bookings bleibt als Katalog-Backup.
 */
export function getCarRentalUrl(): string {
  const discover = env.discoverCarsAffiliateUrl().trim();
  if (discover) return discover;
  return DISCOVER_CARS_AFFILIATE_URL;
}

/** Economy Bookings Referral (Backup / Katalog). */
export function getEconomyBookingsUrl(): string {
  return env.economyBookingsReferralUrl() || ECONOMY_BOOKINGS_REFERRAL_URL;
}

export async function openCarRental(): Promise<boolean> {
  const url = getCarRentalUrl();
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url, 'BOOK_CAR');
  return true;
}

/** Quick-Action: Mietwagen bei DiscoverCars. */
export function buildCarRentalAction(): {
  type: 'BOOK_CAR_RENTAL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'BOOK_CAR_RENTAL',
    label: '🚗 Mietwagen buchen',
    payload: { url: getCarRentalUrl() },
  };
}

/**
 * AWIN Deep-Link: cread.php?awinmid=&awinaffid=&ued=
 * (ued = Ziel-URL URL-encoded)
 */
export function buildAwinClickUrl(opts: {
  merchantId: string;
  destinationUrl: string;
  publisherId?: string;
}): string {
  const aff =
    opts.publisherId?.trim() ||
    env.awinPublisherId().trim() ||
    AWIN_PUBLISHER_ID;
  const mid = opts.merchantId.trim();
  const ued = encodeURIComponent(opts.destinationUrl.trim());
  return `https://www.awin1.com/cread.php?awinmid=${encodeURIComponent(mid)}&awinaffid=${encodeURIComponent(aff)}&ued=${ued}`;
}

/** TravelSecure Reiseversicherung (AWIN mid=106517). */
export function getTravelSecureUrl(destinationUrl?: string): string {
  const fromEnv = env.travelSecureAffiliateUrl().trim();
  if (fromEnv) return fromEnv;
  return buildAwinClickUrl({
    merchantId: TRAVELSECURE_AWIN_MID,
    destinationUrl: destinationUrl?.trim() || 'https://www.travelsecure.de',
  });
}

/** Quick-Action: Reiseversicherung TravelSecure. */
export function buildTravelInsuranceAction(): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: '🛡️ Reiseversicherung',
    payload: { url: getTravelSecureUrl() },
  };
}

/** travSIM eSIM / Travel-SIM (AWIN mid=15561, DACH). */
export function getTravSimUrl(destinationUrl?: string): string {
  const fromEnv = env.travSimAffiliateUrl().trim();
  if (fromEnv) return fromEnv;
  return buildAwinClickUrl({
    merchantId: TRAVSIM_AWIN_MID,
    destinationUrl: destinationUrl?.trim() || 'https://travsim.com/',
  });
}

/**
 * eSIM-Partner-URL: Primär travSIM (AWIN DACH), Fallback Airalo (TPX/Env).
 */
export function getEsimAffiliateUrl(countrySlug?: string): string | null {
  const trav = getTravSimUrl();
  if (trav) return trav;
  return getAiraloAffiliateUrl(countrySlug);
}

/** Tiqets Landing: Start oder DE-Suche. */
export function getTiqetsLandingUrl(cityOrQuery?: string | null): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return 'https://www.tiqets.com/de/';
  return `https://www.tiqets.com/de/search/?q=${encodeURIComponent(q)}`;
}

/**
 * Tiqets Affiliate (AWIN, bis ~6 % vom Buchungswert).
 * Beliebige tiqets.com-URL oder Stadt-Suche → cread.php Deep-Link.
 * Fallback: Travelpayouts-Shortlink.
 */
export function getTiqetsUrl(
  destinationUrl?: string | null,
  cityOrQuery?: string | null,
): string {
  const fromEnv = env.tiqetsAffiliateUrl().trim();
  if (fromEnv) return fromEnv;
  const landing =
    destinationUrl?.trim() || getTiqetsLandingUrl(cityOrQuery);
  // Schon AWIN → nicht doppelt
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  const mid = (env.tiqetsAwinMid() || TIQETS_AWIN_MID).trim();
  if (mid) {
    return buildAwinClickUrl({
      merchantId: mid,
      destinationUrl: landing,
    });
  }
  return getTravelpayoutsUrl('tiqets') || landing;
}

/** Quick-Action: Tiqets Tickets (AWIN). */
export function buildTiqetsAction(opts?: {
  cityOrQuery?: string | null;
  destinationUrl?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '🎫 Tickets bei Tiqets',
    payload: {
      url: getTiqetsUrl(opts?.destinationUrl, opts?.cityOrQuery),
    },
  };
}

/**
 * Bounce Gepäckaufbewahrung — Affiliate-Deep-Link.
 */
export function getBounceLuggageUrl(): string {
  return env.bounceLuggageUrl() || BOUNCE_LUGGAGE_URL;
}

/**
 * Bounce hat auf kleinen Inseln / Orten ohne Stationen keine Abdeckung.
 * Nur dort empfehlen, wo ein Spot plausibel ist.
 */
const BOUNCE_UNAVAILABLE_CITY_IDS = new Set([
  'wangerooge',
  'juist',
  'norderney',
  'langeoog',
  'baltrum',
  'spiekeroog',
  'borkum',
  'helgoland',
  'foehr',
  'föhr',
  'amrum',
  'prisdorf',
]);

const BOUNCE_UNAVAILABLE_NAME_RE =
  /\b(wangerooge|juist|norderney|langeoog|baltrum|spiekeroog|borkum|helgoland|f[oö]hr|amrum|nordseeinsel|ostfriesische\s+insel)\b/iu;

export function isBounceAvailableForCity(
  cityId?: string | null,
  cityName?: string | null,
): boolean {
  const id = (cityId || '').trim().toLowerCase();
  if (id && BOUNCE_UNAVAILABLE_CITY_IDS.has(id)) return false;
  const name = (cityName || '').trim();
  if (name && BOUNCE_UNAVAILABLE_NAME_RE.test(name)) return false;
  return true;
}

export async function openBounceLuggage(): Promise<boolean> {
  const url = getBounceLuggageUrl();
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

/** Quick-Action: Gepäck-Spot bei Bounce — nur wenn Abdeckung plausibel. */
export function buildBounceLuggageAction(opts?: {
  cityId?: string | null;
  cityName?: string | null;
}): {
  type: 'BOOK_BOUNCE_LUGGAGE';
  label: string;
  payload: { url: string };
} | null {
  const profile = getCachedUserProfile();
  const cityId = opts?.cityId ?? profile?.cityId;
  const cityName = opts?.cityName ?? profile?.cityName;
  if (!isBounceAvailableForCity(cityId, cityName)) {
    return null;
  }
  return {
    type: 'BOOK_BOUNCE_LUGGAGE',
    label: '🧳 Gepäck-Spot buchen',
    payload: { url: getBounceLuggageUrl() },
  };
}

export function getStay22AffiliateId(): string {
  return env.stay22AffiliateId() || STAY22_AFFILIATE_ID;
}

/**
 * Stay22 Such-URL für Hotels & Ferienwohnungen am Zielort.
 * https://www.stay22.com/allez/findus?address=…
 */
export function getStay22AccommodationUrl(
  destination: string,
  opts?: { checkin?: string; checkout?: string; adults?: number },
): string {
  const address = (destination || '').trim() || 'Germany';
  const aid = encodeURIComponent(getStay22AffiliateId());
  const q = new URLSearchParams({ address });
  if (opts?.checkin) q.set('checkin', opts.checkin);
  if (opts?.checkout) q.set('checkout', opts.checkout);
  if (opts?.adults != null) q.set('adults', String(opts.adults));
  return `${STAY22_HOST}/allez/${aid}?${q.toString()}`;
}

export async function openStay22Accommodation(
  destination: string,
  opts?: { checkin?: string; checkout?: string; adults?: number; url?: string },
): Promise<boolean> {
  const url =
    opts?.url?.trim() ||
    getStay22AccommodationUrl(destination, {
      checkin: opts?.checkin,
      checkout: opts?.checkout,
      adults: opts?.adults,
    });
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

/** Quick-Action: Unterkunft bei Stay22 (optional mit Datum vorausgefüllt). */
export function buildStay22AccommodationAction(
  destination: string,
  opts?: { checkin?: string; checkout?: string; adults?: number },
): {
  type: 'BOOK_STAY22';
  label: string;
  payload: {
    url: string;
    destination: string;
    checkin?: string;
    checkout?: string;
    adults?: number;
  };
} {
  const dest = (destination || '').trim() || 'Germany';
  return {
    type: 'BOOK_STAY22',
    label: '🏨 Mehr Unterkünfte',
    payload: {
      url: getStay22AccommodationUrl(dest, opts),
      destination: dest,
      ...(opts?.checkin ? { checkin: opts.checkin } : {}),
      ...(opts?.checkout ? { checkout: opts.checkout } : {}),
      ...(opts?.adults != null ? { adults: opts.adults } : {}),
    },
  };
}

/** Expedia Partnerize Tracking-IDs (Link-Builder). */
export const EXPEDIA_DEFAULT_CAMREF = '1101l5Qcvp';
export const EXPEDIA_DEFAULT_CREATIVEREF = '1100l86803';
export const EXPEDIA_DEFAULT_SITE_ID = '1';

export function getExpediaCamref(): string {
  return env.expediaCamref() || EXPEDIA_DEFAULT_CAMREF;
}

export function getExpediaCreativeref(): string {
  return env.expediaCreativeref() || EXPEDIA_DEFAULT_CREATIVEREF;
}

export function getExpediaSiteId(): string {
  return env.expediaSiteId() || EXPEDIA_DEFAULT_SITE_ID;
}

/**
 * Beliebige Expedia-Ziel-URL → provisionsfähiger Affiliate-Link.
 * landingPage = encodeURIComponent(normale expedia.de/com URL).
 * Riesige PWA-Parameter (searchId, pwa_ts, …) sind nicht nötig.
 */
export function buildExpediaAffiliateLink(
  targetUrl: string,
  opts?: { adref?: string | null },
): string {
  const raw = (targetUrl || '').trim();
  if (!raw) {
    return buildExpediaAffiliateLink('https://www.expedia.de/Hotels', opts);
  }
  // Schon Affiliate-Wrapper → nicht doppelt wrappen
  if (/expedia\.com\/affiliate\?/i.test(raw)) {
    return raw;
  }
  const siteId = encodeURIComponent(getExpediaSiteId());
  const camref = encodeURIComponent(getExpediaCamref());
  const creativeref = encodeURIComponent(getExpediaCreativeref());
  const landingPage = encodeURIComponent(raw);
  const adref = (opts?.adref ?? env.expediaAdref() ?? '').trim();
  let url =
    `https://expedia.com/affiliate?siteid=${siteId}` +
    `&camref=${camref}&creativeref=${creativeref}` +
    `&landingPage=${landingPage}`;
  if (adref) {
    url += `&adref=${encodeURIComponent(adref)}`;
  }
  return url;
}

/**
 * Vereinfachte Expedia Hotel-Suche (ohne Link-Builder-Rattenschwanz).
 * destination + optional chkin/chkout/adults.
 */
export function getExpediaHotelSearchUrl(
  destination: string,
  opts?: { checkin?: string; checkout?: string; adults?: number },
): string {
  const dest = (destination || '').trim() || 'Germany';
  const q = new URLSearchParams({
    destination: dest,
    locale: 'de_DE',
    currency: 'EUR',
  });
  if (opts?.checkin) q.set('chkin', opts.checkin);
  if (opts?.checkout) q.set('chkout', opts.checkout);
  const adults = opts?.adults != null && opts.adults > 0 ? opts.adults : 2;
  q.set('rm1', `a${adults}`);
  return `https://www.expedia.de/Hotel-Search?${q.toString()}`;
}

/** Hotel-Suche bereits als Affiliate-Link. */
export function getExpediaAccommodationUrl(
  destination: string,
  opts?: { checkin?: string; checkout?: string; adults?: number },
): string {
  return buildExpediaAffiliateLink(
    getExpediaHotelSearchUrl(destination, opts),
  );
}

export async function openExpediaAccommodation(
  destination: string,
  opts?: {
    checkin?: string;
    checkout?: string;
    adults?: number;
    url?: string;
  },
): Promise<boolean> {
  const url =
    opts?.url?.trim() ||
    getExpediaAccommodationUrl(destination, {
      checkin: opts?.checkin,
      checkout: opts?.checkout,
      adults: opts?.adults,
    });
  const tracked = buildExpediaAffiliateLink(url);
  const can = await Linking.canOpenURL(tracked);
  if (!can) return false;
  await openAffiliateUrl(tracked, 'EXPEDIA');
  return true;
}

/**
 * Primäre Unterkunfts-Action: Expedia (höhere Hotel-Marge), Stay22 bleibt Backup.
 */
export function buildExpediaAccommodationAction(
  destination: string,
  opts?: { checkin?: string; checkout?: string; adults?: number },
): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string; destination: string };
} {
  const dest = (destination || '').trim() || 'Germany';
  return {
    type: 'OPEN_URL',
    label: '🏨 Hotels suchen',
    payload: {
      url: getExpediaAccommodationUrl(dest, opts),
      destination: dest,
    },
  };
}

/** Expedia wenn camref da, sonst Stay22. */
export function buildPrimaryAccommodationAction(destination: string): {
  type: 'OPEN_URL' | 'BOOK_STAY22';
  label: string;
  payload: { url: string; destination: string };
} {
  if (getExpediaCamref()) {
    return buildExpediaAccommodationAction(destination);
  }
  return buildStay22AccommodationAction(destination);
}

function isGygHost(hostname: string): boolean {
  const h = hostname.replace(/^www\./i, '').toLowerCase();
  return h === 'getyourguide.com' || h.endsWith('.getyourguide.com');
}

function isMusementHost(hostname: string): boolean {
  const h = hostname.replace(/^www\./i, '').toLowerCase();
  return (
    h === 'musement.com' ||
    h.endsWith('.musement.com') ||
    h === 'tui.com' ||
    h.endsWith('.tui.com')
  );
}

function isViatorHost(hostname: string): boolean {
  const h = hostname.replace(/^www\./i, '').toLowerCase();
  return (
    h === 'viator.com' ||
    h.endsWith('.viator.com') ||
    h === 'tripadvisor.com' ||
    h.endsWith('.tripadvisor.com')
  );
}

/**
 * Hängt partner_id + cmp an beliebige GetYourGuide-URLs.
 * Andere Domains bleiben unverändert.
 */
export function withGygPartnerParams(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    if (!isGygHost(url.hostname)) return trimmed;
    url.searchParams.set('partner_id', getGygPartnerId());
    if (!url.searchParams.has('cmp')) {
      url.searchParams.set('cmp', GYG_CMP);
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Musement Affiliate-Parameter anhängen:
 * - aid=findus-8445 (offizielle Musement Referral-Syntax)
 * - client_id=findus-8445 (Findus/TUI-Konvention)
 * - cid=findus_app (Kanal)
 */
export function withMusementAffiliateParams(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    const id = getMusementAffiliateId();
    url.searchParams.set('aid', id);
    url.searchParams.set('client_id', id);
    if (!url.searchParams.has('cid')) {
      url.searchParams.set('cid', MUSEMENT_CID);
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Stellt sicher, dass jede Musement-Produkt-URL die Affiliate-ID trägt.
 * Akzeptiert volle URLs oder relative Pfade/Slugs.
 */
export function getMusementBookingUrl(activityUrl: string): string {
  const trimmed = (activityUrl || '').trim();
  if (!trimmed) {
    return withMusementAffiliateParams(`${MUSEMENT_HOST}/de-de/`);
  }

  try {
    let href = trimmed;
    if (!/^https?:\/\//i.test(href)) {
      href = href.startsWith('/')
        ? `${MUSEMENT_HOST}${href}`
        : `${MUSEMENT_HOST}/${href.replace(/^\/+/, '')}`;
    }
    const url = new URL(href);
    if (!isMusementHost(url.hostname) && !/musement/i.test(url.pathname)) {
      return withMusementAffiliateParams(
        `${MUSEMENT_HOST}/${trimmed.replace(/^\/+/, '')}`,
      );
    }
    return withMusementAffiliateParams(url.toString());
  } catch {
    return withMusementAffiliateParams(`${MUSEMENT_HOST}/`);
  }
}

/**
 * Deep-Link für eine Tour/Ticket-Empfehlung.
 * Unsichere/Fake-Slugs → Such-URL nach Stadt/Query statt kaputter Pfade.
 * https://www.getyourguide.com/[TOUR_SLUG]/?partner_id=ZVQGONB&cmp=findus_app
 */
export function buildGetYourGuideTourUrl(tourSlug: string): string {
  let path = (tourSlug || '').trim();
  path = path.replace(/^https?:\/\/(www\.)?getyourguide\.com\/?/i, '');
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  if (!path || looksLikeFakeTourSlug(path)) {
    const asQuery = path
      .replace(/[-_/]+/g, ' ')
      .replace(/\bl\d+\b/gi, '')
      .trim();
    return buildGetYourGuideSearchUrl(asQuery);
  }
  return withGygPartnerParams(`${GYG_HOST}/${path}/`);
}

/**
 * Erkennung erfundener / zu vager Tour-Slugs (keine echten GYG-Pfade).
 */
export function looksLikeFakeTourSlug(slugOrPath: string): boolean {
  const path = (slugOrPath || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?getyourguide\.com\/?/i, '')
    .replace(/^\/+|\/+$/g, '')
    .split('?')[0];
  if (!path) return true;
  if (
    /^(tour|tours?|ticket|tickets|aktivität|aktivitaet|stadtführung|stadtfuehrung|museum|activity|activities|ausflug|sightseeing)$/i.test(
      path,
    )
  ) {
    return true;
  }
  // Echte GYG-Pfade haben oft Zahlen (t123) oder Location-IDs (-l22) oder Mehrsegmente
  if (/\d/.test(path) || /-l\d+/i.test(path)) return false;
  if (path.includes('/') && path.split('/').filter(Boolean).length >= 2) {
    return false;
  }
  // Ein Segment ohne Zahl und ohne typisches Location-Pattern → Suche nutzen
  if (!/-/.test(path) && path.length < 24) return true;
  // Sehr kurze deutsche Wörter
  if (/^[a-zäöüß]{3,18}$/iu.test(path) && !/\d/.test(path)) return true;
  return false;
}

/** Suche / Location-Landing mit Partner-ID. */
export function buildGetYourGuideSearchUrl(query: string): string {
  const q = query.trim();
  const base = q
    ? `${GYG_HOST}/s/?q=${encodeURIComponent(q)}`
    : `${GYG_HOST}/`;
  return withGygPartnerParams(base);
}

/** Musement-Suche (Museen, Ausflüge) mit Affiliate-ID. */
export function buildMusementSearchUrl(query: string): string {
  const q = query.trim();
  const base = q
    ? `${MUSEMENT_HOST}/de-de/search/?q=${encodeURIComponent(q)}`
    : `${MUSEMENT_HOST}/de-de/`;
  return getMusementBookingUrl(base);
}

/**
 * Viator Affiliate-Parameter:
 * pid=P00311883 & mcid=42383 & medium=link
 */
export function withViatorAffiliateParams(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    url.searchParams.set('pid', getViatorPartnerId());
    url.searchParams.set('mcid', getViatorMcid());
    url.searchParams.set('medium', VIATOR_MEDIUM);
    return url.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Stellt sicher, dass jeder Viator-Link die Partner-Parameter trägt.
 * Akzeptiert volle URLs oder relative Pfade/Slugs.
 */
export function getViatorBookingUrl(tourUrl: string): string {
  const trimmed = (tourUrl || '').trim();
  if (!trimmed) {
    return withViatorAffiliateParams(`${VIATOR_HOST}/`);
  }

  try {
    let href = trimmed;
    if (!/^https?:\/\//i.test(href)) {
      href = href.startsWith('/')
        ? `${VIATOR_HOST}${href}`
        : `${VIATOR_HOST}/${href.replace(/^\/+/, '')}`;
    }
    const url = new URL(href);
    if (!isViatorHost(url.hostname) && !/viator/i.test(url.pathname)) {
      return withViatorAffiliateParams(
        `${VIATOR_HOST}/${trimmed.replace(/^\/+/, '')}`,
      );
    }
    return withViatorAffiliateParams(url.toString());
  } catch {
    return withViatorAffiliateParams(`${VIATOR_HOST}/`);
  }
}

/** Viator-Suche (weltweite Touren, VIP-Erlebnisse). */
export function buildViatorSearchUrl(query: string): string {
  const q = query.trim();
  const base = q
    ? `${VIATOR_HOST}/searchResults/all?text=${encodeURIComponent(q)}`
    : `${VIATOR_HOST}/`;
  return getViatorBookingUrl(base);
}

export async function openViatorTour(tourUrl: string): Promise<boolean> {
  const url = getViatorBookingUrl(tourUrl);
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

export type GygWidgetOptions = {
  /** GetYourGuide Location-ID (z. B. „22“ für Hamburg) */
  locationId?: string;
  /** Tour-/Activity-URL oder Slug — Widget zeigt Verfügbarkeit */
  tourUrlOrSlug?: string;
  locale?: string;
  numberOfItems?: number;
  /** activities | availability | city | … */
  widget?: string;
};

/**
 * HTML-Einbettungscode mit data-gyg-partner-id für In-App-WebView.
 */
export function buildGygWidgetHtml(opts: GygWidgetOptions = {}): string {
  const partnerId = getGygPartnerId();
  const locale = opts.locale ?? 'de-DE';
  const n = Math.max(1, Math.min(12, opts.numberOfItems ?? 3));
  const widget =
    opts.widget ?? (opts.tourUrlOrSlug ? 'availability' : 'activities');

  const attrs: string[] = [
    `data-gyg-partner-id="${partnerId}"`,
    `data-gyg-locale-code="${locale}"`,
    `data-gyg-widget="${widget}"`,
    `data-gyg-number-of-items="${n}"`,
  ];

  if (opts.locationId) {
    attrs.push(`data-gyg-location-id="${opts.locationId}"`);
  }

  if (opts.tourUrlOrSlug) {
    const href = buildGetYourGuideTourUrl(opts.tourUrlOrSlug);
    attrs.push(`data-gyg-href="${href.replace(/"/g, '&quot;')}"`);
  }

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>GetYourGuide</title>
  <style>
    html, body { margin: 0; padding: 0; background: #0F2C24; color: #F4EFE6; font-family: -apple-system, system-ui, sans-serif; }
    .wrap { padding: 12px; }
    .hint { font-size: 13px; opacity: 0.75; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="hint">Verfügbarkeit & Tickets · Partner Findus</p>
    <div ${attrs.join(' ')}></div>
  </div>
  <script async defer src="${GYG_WIDGET_SCRIPT}" onerror="document.body.insertAdjacentHTML('beforeend','<p style=\\'padding:16px;color:#C4A35A\\'>Widget konnte nicht geladen werden. Öffne den Link im Browser.</p>')"></script>
</body>
</html>`;
}

export async function openGetYourGuideTour(tourSlug: string): Promise<boolean> {
  const url = buildGetYourGuideTourUrl(tourSlug);
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

export async function openMusementActivity(
  activityUrl: string,
): Promise<boolean> {
  const url = getMusementBookingUrl(activityUrl);
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

/**
 * Ticket-Quelle wählen:
 * - Museum/Ausstellung → Musement
 * - VIP / weltweite Touren → Viator
 * - Asien-Query ohne Slug → Klook (Travelpayouts)
 * - sonst GetYourGuide
 */
export function preferTicketSource(input: {
  kind?: 'museum' | 'tour' | 'attraction' | 'vip' | 'worldwide' | 'generic';
  gygSlug?: string;
  musementUrl?: string;
  viatorUrl?: string;
  query?: string;
}): {
  provider: 'musement' | 'getyourguide' | 'viator' | 'klook' | 'tiqets';
  url: string;
} {
  const kind = input.kind ?? 'generic';
  const preferMusement =
    kind === 'museum' ||
    (input.musementUrl != null && input.musementUrl.length > 0);
  const preferViator =
    kind === 'vip' ||
    kind === 'worldwide' ||
    (input.viatorUrl != null && input.viatorUrl.length > 0);

  if (preferViator && !preferMusement) {
    if (input.viatorUrl) {
      return {
        provider: 'viator',
        url: getViatorBookingUrl(input.viatorUrl),
      };
    }
    if (input.query) {
      return {
        provider: 'viator',
        url: buildViatorSearchUrl(input.query),
      };
    }
  }

  if (preferMusement) {
    if (input.musementUrl) {
      return {
        provider: 'musement',
        url: getMusementBookingUrl(input.musementUrl),
      };
    }
    if (input.query) {
      return {
        provider: 'musement',
        url: buildMusementSearchUrl(input.query),
      };
    }
  }

  if (input.gygSlug) {
    return {
      provider: 'getyourguide',
      url: buildGetYourGuideTourUrl(input.gygSlug),
    };
  }
  if (input.viatorUrl) {
    return {
      provider: 'viator',
      url: getViatorBookingUrl(input.viatorUrl),
    };
  }
  if (input.query) {
    const tpxId = pickTourPartnerId({ cityOrQuery: input.query });
    if (tpxId === 'klook') {
      return { provider: 'klook', url: getTravelpayoutsUrl('klook') };
    }
    // EU / Rest: Tiqets AWIN (bis ~6 %) vor nackter GYG-Suche
    return {
      provider: 'tiqets',
      url: getTiqetsUrl(null, input.query),
    };
  }
  if (input.musementUrl) {
    return {
      provider: 'musement',
      url: getMusementBookingUrl(input.musementUrl),
    };
  }
  return {
    provider: 'tiqets',
    url: getTiqetsUrl(),
  };
}

/**
 * Concierge-Action aus preferTicketSource — immer valide Search-/Booking-URL.
 * Bei GYG ohne echten Slug → OPEN_GYG_WIDGET optional, sonst OPEN_URL Suche.
 */
export function buildTourBookingAction(input: {
  kind?: 'museum' | 'tour' | 'attraction' | 'vip' | 'worldwide' | 'generic';
  gygSlug?: string;
  musementUrl?: string;
  viatorUrl?: string;
  query?: string;
  city?: string;
}): {
  type: 'OPEN_URL' | 'OPEN_GYG_WIDGET';
  label: string;
  payload: {
    url?: string;
    gygTourSlug?: string;
    gygLocationId?: string;
  };
} {
  const query = (input.query || input.city || '').trim();
  const gygSlug = input.gygSlug?.trim();
  const useSlug = gygSlug && !looksLikeFakeTourSlug(gygSlug) ? gygSlug : undefined;

  const picked = preferTicketSource({
    kind: input.kind,
    gygSlug: useSlug,
    musementUrl: input.musementUrl,
    viatorUrl: input.viatorUrl,
    query: query || useSlug || undefined,
  });

  if (picked.provider === 'getyourguide' && !useSlug && query) {
    return {
      type: 'OPEN_URL',
      label: '🎟️ Touren suchen',
      payload: { url: buildGetYourGuideSearchUrl(query) },
    };
  }

  const label =
    picked.provider === 'musement'
      ? '🎟️ Ticket bei Musement'
      : picked.provider === 'viator'
        ? '🌍 Tour bei Viator'
        : picked.provider === 'klook'
          ? '🎟️ Touren bei Klook'
          : picked.provider === 'tiqets'
            ? '🎫 Tickets bei Tiqets'
            : '🎟️ Tour bei GetYourGuide';

  return {
    type: 'OPEN_URL',
    label,
    payload: { url: picked.url },
  };
}

/** GYG-, Musement- oder Viator-URL → Partner-Parameter erzwingen. */
export function normalizeAffiliateUrl(url: string): string {
  if (/getyourguide\.com/i.test(url)) {
    return withGygPartnerParams(url);
  }
  if (/musement\.com|tui\.com/i.test(url)) {
    return getMusementBookingUrl(url);
  }
  if (/viator\.com|tripadvisor\.com/i.test(url)) {
    return getViatorBookingUrl(url);
  }
  if (/discovercars\.com/i.test(url)) {
    return getCarRentalUrl();
  }
  if (/economybookings\.com/i.test(url)) {
    return getEconomyBookingsUrl();
  }
  if (/travelsecure\.de|awin1\.com\/cread\.php.*106517/i.test(url)) {
    return getTravelSecureUrl();
  }
  if (/travsim\.com|awin1\.com\/cread\.php.*15561/i.test(url)) {
    return getTravSimUrl();
  }
  if (/tiqets\.com/i.test(url)) {
    return getTiqetsUrl(url);
  }
  if (/bounce\.com|go\.bounce\.com/i.test(url)) {
    return getBounceLuggageUrl();
  }
  if (/stay22\.com/i.test(url)) {
    try {
      const u = new URL(url);
      const address = u.searchParams.get('address') || '';
      return getStay22AccommodationUrl(address);
    } catch {
      return getStay22AccommodationUrl('');
    }
  }
  if (/expedia\.(com|de|at|ch)\b/i.test(url)) {
    return buildExpediaAffiliateLink(url);
  }
  return url;
}

/**
 * Uber Deep-Link (App / Universal Link) zum Dropoff-Ziel.
 * Optional Pickup — Button ist dann voll vorbereitet.
 * https://m.uber.com/ul/?action=setPickup&client_id=…&pickup[…]&dropoff[…]
 */
export function getUberRideUrl(
  destLat: number,
  destLng: number,
  destName: string,
  pickup?: { lat: number; lng: number } | null,
): string {
  const clientId = encodeURIComponent(getUberClientId());
  if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
    return `https://m.uber.com/ul/?action=setPickup&client_id=${clientId}`;
  }
  const nickname = encodeURIComponent((destName || 'Ziel').trim() || 'Ziel');
  let url =
    `https://m.uber.com/ul/?action=setPickup` +
    `&client_id=${clientId}` +
    `&dropoff[latitude]=${destLat}` +
    `&dropoff[longitude]=${destLng}` +
    `&dropoff[nickname]=${nickname}`;
  if (
    pickup &&
    Number.isFinite(pickup.lat) &&
    Number.isFinite(pickup.lng)
  ) {
    url +=
      `&pickup[latitude]=${pickup.lat}` +
      `&pickup[longitude]=${pickup.lng}`;
  }
  return url;
}

export async function openUberRide(
  destLat: number,
  destLng: number,
  destName: string,
  pickup?: { lat: number; lng: number } | null,
): Promise<boolean> {
  let from = pickup ?? null;
  if (!from) {
    try {
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { lat: number | null; lng: number | null };
        };
      };
      const gps = useGpsStore.getState();
      if (
        gps.lat != null &&
        gps.lng != null &&
        Number.isFinite(gps.lat) &&
        Number.isFinite(gps.lng)
      ) {
        from = { lat: gps.lat, lng: gps.lng };
      }
    } catch {
      /* soft */
    }
  }
  const url = getUberRideUrl(destLat, destLng, destName, from);
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

/** Quick-Action-Helper für Concierge-Karten. */
export function buildUberRideAction(
  destLat: number,
  destLng: number,
  destName: string,
  targetPoiId?: string | number,
): {
  type: 'BOOK_UBER';
  label: string;
  payload: {
    destLat: number;
    destLng: number;
    destName: string;
    targetPoiId?: string | number;
    url: string;
  };
} {
  const name = (destName || 'Ziel').trim() || 'Ziel';
  let pickup: { lat: number; lng: number } | null = null;
  try {
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: {
        getState: () => { lat: number | null; lng: number | null };
      };
    };
    const gps = useGpsStore.getState();
    if (
      gps.lat != null &&
      gps.lng != null &&
      Number.isFinite(gps.lat) &&
      Number.isFinite(gps.lng)
    ) {
      pickup = { lat: gps.lat, lng: gps.lng };
    }
  } catch {
    /* soft */
  }
  return {
    type: 'BOOK_UBER',
    label: '🚗 Fahrt mit Uber buchen',
    payload: {
      destLat,
      destLng,
      destName: name,
      targetPoiId,
      url: getUberRideUrl(destLat, destLng, name, pickup),
    },
  };
}

export type AffiliatePartnerStatus =
  | 'ready'
  | 'partial'
  | 'configured_only'
  | 'placeholder';

export type AffiliatePartnerCatalogEntry = {
  id: string;
  name: string;
  category: string;
  envKeys: string[];
  /** Primärer Credential-/Link-Wert (dynamisch aus Env/Defaults). */
  value: string;
  helperFns: string[];
  conciergeActions: string[];
  status: AffiliatePartnerStatus;
  notes: string;
};

/**
 * Zentrale Bestandsaufnahme aller Affiliate-/Monetarisierungs-Partner.
 * Werte kommen dynamisch aus Env (+ Code-Defaults).
 */
export function getAffiliateCatalog(): AffiliatePartnerCatalogEntry[] {
  return [
    {
      id: 'getyourguide',
      name: 'GetYourGuide',
      category: 'Touren & Aktivitäten',
      envKeys: ['EXPO_PUBLIC_GYG_PARTNER_ID'],
      value: getGygPartnerId(),
      helperFns: [
        'getGygPartnerId',
        'buildGetYourGuideTourUrl',
        'buildGetYourGuideSearchUrl',
        'buildGygWidgetHtml',
        'withGygPartnerParams',
      ],
      conciergeActions: ['OPEN_URL', 'OPEN_GYG_WIDGET'],
      status: 'ready',
      notes:
        'Partner-Stempel + Widget; Auto-Enrich bei Tour-Intent → Such-URL (keine Fake-Slugs).',
    },
    {
      id: 'musement',
      name: 'Musement / TUI',
      category: 'Museen & Tickets',
      envKeys: ['EXPO_PUBLIC_MUSEMENT_AFFILIATE_ID'],
      value: getMusementAffiliateId(),
      helperFns: [
        'getMusementAffiliateId',
        'getMusementBookingUrl',
        'buildMusementSearchUrl',
        'withMusementAffiliateParams',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes: 'aid + client_id; Auto-Enrich via preferTicketSource / buildTourBookingAction.',
    },
    {
      id: 'uber',
      name: 'Uber',
      category: 'Lokale Mobilität',
      envKeys: ['EXPO_PUBLIC_UBER_CLIENT_ID'],
      value: getUberClientId(),
      helperFns: ['getUberClientId', 'getUberRideUrl', 'openUberRide', 'buildUberRideAction'],
      conciergeActions: ['BOOK_UBER'],
      status: 'ready',
      notes: 'Auto-Enrich bei Food/Infra/General mit Ziel-POI.',
    },
    {
      id: 'viator',
      name: 'Viator (TripAdvisor)',
      category: 'Weltweite / VIP-Touren',
      envKeys: ['EXPO_PUBLIC_VIATOR_PARTNER_ID', 'EXPO_PUBLIC_VIATOR_MCID'],
      value: `${getViatorPartnerId()} / mcid=${getViatorMcid()}`,
      helperFns: [
        'getViatorPartnerId',
        'getViatorMcid',
        'getViatorBookingUrl',
        'buildViatorSearchUrl',
        'withViatorAffiliateParams',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'pid+mcid+medium; Auto-Enrich bei VIP/Tour-Intent → Such-URL wenn kein Produktlink.',
    },
    {
      id: 'travel_secure',
      name: 'TravelSecure DE',
      category: 'Reiseversicherung',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_TRAVELSECURE_AFFILIATE_URL',
      ],
      value: getTravelSecureUrl(),
      helperFns: [
        'getTravelSecureUrl',
        'buildTravelInsuranceAction',
        'buildAwinClickUrl',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'AWIN mid=106517 / aff=3021215 · bis ~16 % · Cookie 30 Tage · Primär Reiseversicherung DE.',
    },
    {
      id: 'discover_cars',
      name: 'DiscoverCars',
      category: 'Mietwagen',
      envKeys: ['EXPO_PUBLIC_DISCOVER_CARS_AFFILIATE_URL'],
      value: getCarRentalUrl(),
      helperFns: ['getCarRentalUrl', 'openCarRental', 'buildCarRentalAction'],
      conciergeActions: ['BOOK_CAR_RENTAL'],
      status: 'ready',
      notes:
        'Primär für BOOK_CAR_RENTAL (a_aid=Findus-Ai). ~$20 avg / Booking laut Partner.',
    },
    {
      id: 'economy_bookings',
      name: 'Economy Bookings',
      category: 'Mietwagen',
      envKeys: ['EXPO_PUBLIC_ECONOMY_BOOKINGS_REFERRAL_URL'],
      value: getEconomyBookingsUrl(),
      helperFns: ['getEconomyBookingsUrl'],
      conciergeActions: [],
      status: 'ready',
      notes: 'Backup-Referral; Primär ist DiscoverCars.',
    },
    {
      id: 'bounce',
      name: 'Bounce',
      category: 'Gepäckaufbewahrung',
      envKeys: ['EXPO_PUBLIC_BOUNCE_LUGGAGE_URL'],
      value: getBounceLuggageUrl(),
      helperFns: [
        'getBounceLuggageUrl',
        'openBounceLuggage',
        'buildBounceLuggageAction',
      ],
      conciergeActions: ['BOOK_BOUNCE_LUGGAGE'],
      status: 'ready',
      notes: 'Auto-Enrich bei luggage-Intent / Früheinchecken / Spätabflug.',
    },
    {
      id: 'expedia',
      name: 'Expedia (Partnerize)',
      category: 'Unterkünfte',
      envKeys: [
        'EXPO_PUBLIC_EXPEDIA_CAMREF',
        'EXPO_PUBLIC_EXPEDIA_CREATIVEREF',
        'EXPO_PUBLIC_EXPEDIA_SITE_ID',
        'EXPO_PUBLIC_EXPEDIA_ADREF',
      ],
      value: getExpediaCamref(),
      helperFns: [
        'buildExpediaAffiliateLink',
        'getExpediaHotelSearchUrl',
        'getExpediaAccommodationUrl',
        'openExpediaAccommodation',
        'buildExpediaAccommodationAction',
        'buildPrimaryAccommodationAction',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'Primär für Hotels: affiliate?camref=&landingPage=. Einfache Hotel-Search ohne PWA-Rattenschwanz.',
    },
    {
      id: 'stay22',
      name: 'Stay22',
      category: 'Unterkünfte',
      envKeys: ['EXPO_PUBLIC_STAY22_AFFILIATE_ID'],
      value: getStay22AffiliateId(),
      helperFns: [
        'getStay22AffiliateId',
        'getStay22AccommodationUrl',
        'openStay22Accommodation',
        'buildStay22AccommodationAction',
      ],
      conciergeActions: ['BOOK_STAY22'],
      status: 'ready',
      notes:
        'Backup + Live-Preis-API; Expedia ist Primär-Buchungspfad für Unterkunft.',
    },
    {
      id: 'opentable',
      name: 'OpenTable',
      category: 'Restaurant-Reservierung',
      envKeys: ['EXPO_PUBLIC_OPENTABLE_AFFILIATE_ID'],
      value: env.openTableAffiliateId() || '(leer)',
      helperFns: ['getOpenTableAffiliateId', 'getOpenTableBookingUrl'],
      // Placeholder: nie Booking-Actions emitten, solange URL null ist
      conciergeActions: [],
      status: 'placeholder',
      notes:
        'PLACEHOLDER: Env-Slot + Reservation-Tier; getOpenTableBookingUrl() → null — keine Buttons bis Deep-Link-API.',
    },
    {
      id: 'quandoo',
      name: 'Quandoo',
      category: 'Restaurant-Reservierung',
      envKeys: ['EXPO_PUBLIC_QUANDOO_PARTNER_ID'],
      value: env.quandooPartnerId() || '(leer)',
      helperFns: ['getQuandooPartnerId', 'getQuandooBookingUrl'],
      conciergeActions: [],
      status: 'placeholder',
      notes:
        'PLACEHOLDER: Env-Slot + Reservation-Tier; getQuandooBookingUrl() → null — keine Buttons bis Deep-Link-API.',
    },
    {
      id: 'travsim',
      name: 'travSIM (AWIN DACH)',
      category: 'eSIM / Travel-SIM',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_TRAVSIM_AFFILIATE_URL',
      ],
      value: getTravSimUrl(),
      helperFns: [
        'getTravSimUrl',
        'getEsimAffiliateUrl',
        'buildEsimAction',
        'openEsim',
        'buildAwinClickUrl',
      ],
      conciergeActions: ['BOOK_ESIM'],
      status: 'ready',
      notes:
        'AWIN mid=15561 / publisher 3021215. Primär für BOOK_ESIM (DACH). Airalo = Fallback.',
    },
    {
      id: 'tiqets_awin',
      name: 'Tiqets (AWIN)',
      category: 'Touren & Tickets',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_TIQETS_AWIN_MID',
        'EXPO_PUBLIC_TIQETS_AFFILIATE_URL',
      ],
      value: getTiqetsUrl(),
      helperFns: [
        'getTiqetsUrl',
        'getTiqetsLandingUrl',
        'buildTiqetsAction',
        'buildAwinClickUrl',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'AWIN bis ~6 % vom Buchungswert. Default mid=12428 (Intl/US). Bei anderer Mid: EXPO_PUBLIC_TIQETS_AWIN_MID. Primär für EU-Attraktionen; GYG bei bekanntem Slug; Asien → Klook.',
    },
    (() => {
      const airaloUrl = getAiraloAffiliateUrl();
      const airaloId = getAiraloAffiliateId();
      return {
        id: 'airalo' as const,
        name: 'Airalo',
        category: 'eSIM',
        envKeys: [
          'EXPO_PUBLIC_AIRALO_AFFILIATE_ID',
          'EXPO_PUBLIC_TRAVELPAYOUTS_MARKER',
        ],
        value: airaloId || getTravelpayoutsUrl('airalo'),
        helperFns: [
          'getAiraloAffiliateId',
          'getAiraloAffiliateUrl',
          'buildEsimAction',
        ],
        conciergeActions: [] as string[],
        status: (airaloUrl ? 'ready' : 'placeholder') as AffiliatePartnerStatus,
        notes: airaloId
          ? 'Fallback hinter travSIM. Env-Deep-Link (ref=).'
          : 'Fallback hinter travSIM. Travelpayouts-Shortlink Marker 760293.',
      };
    })(),
    ...TRAVELPAYOUTS_PARTNERS.filter((p) => p.id !== 'airalo').map((p) => ({
      id: `tpx_${p.id}`,
      name: p.name,
      category: `TPX · ${p.category}`,
      envKeys: ['EXPO_PUBLIC_TRAVELPAYOUTS_MARKER'],
      value: `${TRAVELPAYOUTS_MARKER} · ${p.url}`,
      helperFns: ['getTravelpayoutsUrl', 'buildTravelpayoutsCategoryAction'],
      conciergeActions: ['OPEN_URL'] as string[],
      status: 'ready' as AffiliatePartnerStatus,
      notes: `${p.commissionNote} · ${p.geo} · ${p.whenUseful}`,
    })),
  ];
}

/** Schnellzugriff: Partner-ID / Link nach Katalog-ID. */
export function getAffiliatePartnerValue(id: string): string {
  const entry = getAffiliateCatalog().find((p) => p.id === id);
  return entry?.value ?? '';
}

// ---------------------------------------------------------------------------
// PLACEHOLDER — OpenTable / Quandoo (Env vorhanden, Deep-Links noch nicht)
// ---------------------------------------------------------------------------

/** @returns Partner-ID oder null, wenn Slot leer (noch kein Deep-Link). */
export function getOpenTableAffiliateId(): string | null {
  const id = env.openTableAffiliateId().trim();
  return id.length > 0 ? id : null;
}

/**
 * PLACEHOLDER: Noch keine offizielle Affiliate-Deep-Link-Formel verdrahtet.
 * Reservation-Tier kann POI-bookingUrl nutzen; diese Helper liefern null.
 */
export function getOpenTableBookingUrl(_restaurantId?: string): string | null {
  if (!getOpenTableAffiliateId()) return null;
  return null;
}

/** @returns Partner-ID oder null, wenn Slot leer. */
export function getQuandooPartnerId(): string | null {
  const id = env.quandooPartnerId().trim();
  return id.length > 0 ? id : null;
}

/** PLACEHOLDER: Deep-Link-API noch nicht hinterlegt. */
export function getQuandooBookingUrl(_placeId?: string): string | null {
  if (!getQuandooPartnerId()) return null;
  return null;
}

// ---------------------------------------------------------------------------
// eSIM — Airalo (Travelpayouts Shortlink + optional Env-Deep-Link)
// ---------------------------------------------------------------------------

/** @returns Affiliate-ID oder null, wenn Slot leer. */
export function getAiraloAffiliateId(): string | null {
  const id = env.airaloAffiliateId().trim();
  return id.length > 0 ? id : null;
}

/**
 * Airalo Partner-URL.
 * Prefer Env-Deep-Link mit ref=; sonst Travelpayouts-Shortlink (Marker 760293).
 */
export function getAiraloAffiliateUrl(countrySlug?: string): string | null {
  const id = getAiraloAffiliateId();
  if (id) {
    const base = 'https://www.airalo.com';
    const path = countrySlug?.trim()
      ? `/${encodeURIComponent(countrySlug.trim().toLowerCase())}`
      : '';
    const url = new URL(`${base}${path}`);
    url.searchParams.set('ref', id);
    return url.toString();
  }
  return getTravelpayoutsUrl('airalo') || null;
}

export async function openAiraloEsim(countrySlug?: string): Promise<boolean> {
  const url = getAiraloAffiliateUrl(countrySlug);
  if (!url) return false;
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

/** Quick-Action: eSIM — Primär travSIM (AWIN), Fallback Airalo. */
export function buildEsimAction(opts?: { countrySlug?: string }): {
  type: 'BOOK_ESIM';
  label: string;
  payload: { url: string };
} | null {
  const url = getEsimAffiliateUrl(opts?.countrySlug);
  if (!url) return null;
  return {
    type: 'BOOK_ESIM',
    label: '📱 eSIM holen',
    payload: { url },
  };
}

export async function openEsim(countrySlug?: string): Promise<boolean> {
  const url = getEsimAffiliateUrl(countrySlug);
  if (!url) return false;
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

/** Travelpayouts Marker (Findus). */
export function getTravelpayoutsMarker(): string {
  return env.travelpayoutsMarker() || TRAVELPAYOUTS_MARKER;
}

/**
 * OPEN_URL für eine Travelpayouts-Kategorie (primärer Partner).
 */
export function buildTravelpayoutsCategoryAction(
  category: Parameters<typeof pickPrimaryPartner>[0],
  opts?: { cityOrQuery?: string | null; label?: string },
): { type: 'OPEN_URL'; label: string; payload: { url: string } } {
  const p = pickPrimaryPartner(category, opts);
  const url =
    p.id === 'tiqets'
      ? getTiqetsUrl(null, opts?.cityOrQuery)
      : p.url;
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || p.label,
    payload: { url },
  };
}

export {
  buildAffiliateSpeechBlueprint,
  pickAffiliateOffer,
  enrichPartnerCandidate,
  travelpayoutsCandidates,
  type AffiliateOfferCandidate,
  type DeepLinkLevel,
} from './affiliateRegistry';

/** Künftige Monetarisierungs-Kategorien (Vorbereitung). */
export type PlannedAffiliateCategory =
  | 'flights' // Aviasales live via TPX; Kiwi / Skyscanner optional
  | 'travel_insurance' // Ekta live via TPX
  | 'esim' // Airalo / Saily / Yesim / Drimsim via TPX
  | 'rail_bus' // Trainline / Omio
  | 'events'; // Eventim / Ticketmaster

export type PlannedAffiliateSlot = {
  category: PlannedAffiliateCategory;
  examplePartners: string[];
  /** Vorgesehene Env-Keys (noch nicht in .env.example Pflicht) */
  proposedEnvKeys: string[];
  status: 'planned' | 'ready_via_travelpayouts';
};

/** Vorbereitende Slots — TPX-ready wo vorhanden. */
export const PLANNED_AFFILIATE_SLOTS: PlannedAffiliateSlot[] = [
  {
    category: 'flights',
    examplePartners: ['Aviasales', 'Kiwi', 'Skyscanner'],
    proposedEnvKeys: [
      'EXPO_PUBLIC_TRAVELPAYOUTS_MARKER',
      'EXPO_PUBLIC_KIWI_AFFILIATE_ID',
    ],
    status: 'ready_via_travelpayouts',
  },
  {
    category: 'travel_insurance',
    examplePartners: ['TravelSecure (AWIN)', 'Ekta Traveling', 'SafetyWing'],
    proposedEnvKeys: [
      'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
      'EXPO_PUBLIC_TRAVELSECURE_AFFILIATE_URL',
    ],
    status: 'ready_via_travelpayouts',
  },
  {
    category: 'esim',
    examplePartners: ['travSIM (AWIN)', 'Airalo', 'Saily', 'Yesim', 'Drimsim', 'Holafly'],
    proposedEnvKeys: [
      'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
      'EXPO_PUBLIC_TRAVSIM_AFFILIATE_URL',
      'EXPO_PUBLIC_AIRALO_AFFILIATE_ID',
      'EXPO_PUBLIC_TRAVELPAYOUTS_MARKER',
    ],
    status: 'ready_via_travelpayouts',
  },
  {
    category: 'rail_bus',
    examplePartners: ['Trainline', 'Omio'],
    proposedEnvKeys: [
      'EXPO_PUBLIC_TRAINLINE_AFFILIATE_ID',
      'EXPO_PUBLIC_OMIO_AFFILIATE_ID',
    ],
    status: 'planned',
  },
  {
    category: 'events',
    examplePartners: ['Eventim', 'Ticketmaster'],
    proposedEnvKeys: [
      'EXPO_PUBLIC_EVENTIM_AFFILIATE_ID',
      'EXPO_PUBLIC_TICKETMASTER_AFFILIATE_ID',
    ],
    status: 'planned',
  },
];

/** Stub — liefert null, bis die Kategorie verdrahtet ist. */
export function getPlannedAffiliateUrl(
  _category: PlannedAffiliateCategory,
  _query?: string,
): string | null {
  return null;
}

/** Alle Travelpayouts-Partner als Katalog-Zeilen. */
export function getTravelpayoutsCatalogEntries(): AffiliatePartnerCatalogEntry[] {
  return TRAVELPAYOUTS_PARTNERS.map((p) => ({
    id: `tpx_${p.id}` as AffiliatePartnerCatalogEntry['id'],
    name: p.name,
    category: `TPX · ${p.category}`,
    envKeys: ['EXPO_PUBLIC_TRAVELPAYOUTS_MARKER'],
    value: `${TRAVELPAYOUTS_MARKER} · ${p.url}`,
    helperFns: ['getTravelpayoutsUrl', 'buildTravelpayoutsCategoryAction'],
    conciergeActions: ['OPEN_URL', ...(p.category === 'esim' ? ['BOOK_ESIM'] : [])],
    status: 'ready' as AffiliatePartnerStatus,
    notes: `${p.commissionNote} · ${p.geo} · ${p.whenUseful}`,
  }));
}
