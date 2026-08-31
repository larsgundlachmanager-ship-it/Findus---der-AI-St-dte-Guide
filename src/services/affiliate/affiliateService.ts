/**
 * Affiliate-Links & Widgets (Yorro Monetarisierungs-Kern):
 * - GetYourGuide Partner ZVQGONB (partner_id)
 * - Musement / TUI Affiliate findus-8445 (aid + client_id)
 * - Viator / TripAdvisor Partner P00311883 (pid + mcid + medium)
 * - Uber Client ID 4a6yecXWLriTzMd4uqp41cVz2dDdlpSB
 * - DiscoverCars Mietwagen a_aid=Yorro-Ai (Primär BOOK_CAR_RENTAL)
 * - Economy Bookings Mietwagen Referral 16yupj/l0j2ln (Backup)
 * - TravelSecure DE AWIN mid=106517 / publisher 3021215
 * - travSIM DACH AWIN mid=15561 / publisher 3021215 (Primär eSIM)
 * - Reservix DE AWIN mid=31293 (Live-Events: Konzert, Theater, Sport)
 * - camping.info AWIN mid=44063 (Campingplatz ~5 %)
 * - Solmar DE AWIN mid=114510 (Spanien Bus-/Pauschal)
 * - CHECK24 DE AWIN mid=9364 (Pauschal ~5,5 % · Mietwagen ~5,5 %, Primär Pauschal)
 * - ab-in-den-urlaub DE AWIN mid=9369 (Pauschal / Last Minute / Kurztrips, wenn explizit)
 * - weg.de DE AWIN mid=12224 (Pauschal / Last Minute / Kurztrips, wenn explizit)
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
import {
  buildAutoEuropeResultsUrl,
  buildBikesbookingSearchUrl,
  buildGetRentacarRequestUrl,
  buildGetTransferNewUrl,
  buildGoCityExplorerUrl,
  buildLocalrentSearchUrl,
  buildWelcomePickupsTransferUrl,
  buildRadicalStorageUrl,
  buildAirhelpClaimUrl,
  buildCompensairCheckUrl,
  buildQeeqSearchMapUrl,
  buildSailyCountryPageUrl,
  withSailyAffiliate,
  buildYesimCountryPageUrl,
  stampTpxPartnerTracking,
} from './partnerTpxDeepLink';
import {
  buildAbInDenUrlaubOffersUrl,
  buildCheck24CarCompareUrl,
  buildCheck24PackageSearchUrl,
  buildSolmarHotelUrl,
  buildWegDeSearchUrl,
  extractAbInDenUrlaubDestinationId,
  extractAbInDenUrlaubGiataId,
  parseOriginIata,
  sanitizeWegDeUrl,
  TRAVELSECURE_TARIFRECHNER_URL,
} from './partnerAwinHolidayDeepLink';
import {
  encodeUriBrackets,
  roundClockHmmDownTo5,
  slugifyCampingplatz,
} from './partnerDeepPrefill';
import {
  buildAiraloCountryPageUrl,
  buildAiraloTravelpayoutsUrl,
  buildBounceBookUrl,
  bounceLocationIdFromUrl,
  buildDiscoverCarsSearchUrl,
  buildEconomyBookingsResultsUrl,
  sanitizeEconomyBookingsUrl,
  buildUberGoUrl,
  campingInfoCityHubPath,
  extractBounceAffiliateRef,
  toTiqetsDeepLanding,
  uberPlaceFromAddress,
  withCampingInfoStayParams,
  withGygDateAdults,
  withViatorDateAdults,
} from './partnerBookingDeepLink';
import { pickAffiliateOffer, type AffiliateOfferCandidate } from './affiliatePickOffer';
import {
  ticketIdentity,
  ticketProductKey,
  userWantsCheapest,
} from './quoteIdentity';
import {
  classifyTicketPartner,
  pickQuotedTicket,
} from './quoteCollector';
import {
  isHollowPartnerUrl,
  mayShowAsPartnerBookAction,
  unwrapPartnerLandingUrl,
} from './hollowPartnerUrl';

export {
  isHollowPartnerUrl,
  isHollowTicketPartnerUrl,
  looksLikePartnerBookClaim,
  mayShowAsPartnerBookAction,
  rejectHollowPartnerBookAction,
  unwrapPartnerLandingUrl,
} from './hollowPartnerUrl';

/** Yorro GetYourGuide Partner-ID (Affiliate). */
export const GYG_PARTNER_ID = 'ZVQGONB';

/** Yorro Musement / TUI Affiliate-ID. */
export const MUSEMENT_AFFILIATE_ID = 'findus-8445';

/** Yorro Viator (TripAdvisor) Partner-ID. */
export const VIATOR_PARTNER_ID = 'P00311883';

/** Viator Media Campaign ID (Affiliate Tracking). */
export const VIATOR_MCID = '42383';

/** Yorro Uber Client-ID (Deep Links). */
export const UBER_CLIENT_ID = '4a6yecXWLriTzMd4uqp41cVz2dDdlpSB';

/** Economy Bookings Mietwagen-Referral (Yorro) — Backup. */
export const ECONOMY_BOOKINGS_REFERRAL_URL =
  'https://www.economybookings.com/de/referral/16yupj/l0j2ln';

/** DiscoverCars Mietwagen Affiliate (Yorro) — Primär (~$20 avg / Booking). */
export const DISCOVER_CARS_AFFILIATE_URL =
  'https://www.discovercars.com/?a_aid=Yorro-Ai';

/** AWIN Publisher-ID (Yorro). */
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

/** konfetti / gokonfetti DE — AWIN Advertiser (Workshops). */
export const KONFETTI_AWIN_MID = '31804';

/** Reservix DE — AWIN Advertiser (Live-Events: Konzert, Theater, Sport). */
export const RESERVIX_AWIN_MID = '31293';

/** camping.info DE/AT — AWIN Advertiser (Campingplatz-Buchung ~5 %). */
export const CAMPING_INFO_AWIN_MID = '44063';

/** Solmar DE — AWIN Advertiser (Spanien-Bus-/Pauschalreisen). */
export const SOLMAR_AWIN_MID = '114510';

/** CHECK24 DE — AWIN Advertiser (Pauschalreise / Mietwagen-Vergleich). */
export const CHECK24_AWIN_MID = '9364';

/** ab-in-den-urlaub DE — AWIN Advertiser (mid=9369). AT=15612 · CH=15613. */
export const AB_IN_DEN_URLAUB_AWIN_MID = '9369';
export const AB_IN_DEN_URLAUB_AT_AWIN_MID = '15612';
export const AB_IN_DEN_URLAUB_CH_AWIN_MID = '15613';

export type AbInDenUrlaubMarket = 'de' | 'at' | 'ch';

/** weg.de DE — AWIN Advertiser (Pauschal / Last Minute / Kurztrips). */
export const WEG_DE_AWIN_MID = '12224';

/** Bounce Gepäckaufbewahrung Affiliate-Link (Yorro). */
export const BOUNCE_LUGGAGE_URL =
  'https://go.bounce.com/FINDUS64751223710664';

/** Yorro Stay22 Affiliate-ID (Unterkünfte). */
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

export type CarRentalDeepOpts = {
  /** Stadt / Ort Pickup. */
  pickupLocation?: string | null;
  /** Flughafen-IATA wenn bekannt (z. B. HAM). */
  pickupIata?: string | null;
  dropoffLocation?: string | null;
  dropoffIata?: string | null;
  /** YYYY-MM-DD */
  pickupDate?: string | null;
  /** YYYY-MM-DD */
  dropoffDate?: string | null;
  /** HH:mm */
  pickupTime?: string | null;
  dropoffTime?: string | null;
  /** Fahreralter (DiscoverCars Default 24). */
  driverAge?: number | null;
};

/**
 * Mietwagen — DiscoverCars primär (Suche mit Datum/Uhr/Alter).
 * Economy/CHECK24 nicht gegeneinander tippen ohne Live-Quote.
 * Ohne Prefill: Affiliate-Start (Env/Default).
 */
export function getCarRentalUrl(opts?: CarRentalDeepOpts): string {
  const baseRaw =
    env.discoverCarsAffiliateUrl().trim() || DISCOVER_CARS_AFFILIATE_URL;
  const hasPrefill = !!(
    opts?.pickupLocation?.trim() ||
    opts?.pickupIata?.trim() ||
    opts?.pickupDate?.trim() ||
    opts?.dropoffDate?.trim()
  );
  if (!hasPrefill) return baseRaw;

  let aid = 'Yorro-Ai';
  try {
    const u = new URL(
      /^https?:\/\//i.test(baseRaw) ? baseRaw : `https://${baseRaw}`,
    );
    aid = u.searchParams.get('a_aid')?.trim() || aid;
  } catch {
    /* default aid */
  }
  return buildDiscoverCarsSearchUrl({
    pickupLocation: opts?.pickupLocation,
    pickupIata: opts?.pickupIata,
    dropoffLocation: opts?.dropoffLocation,
    dropoffIata: opts?.dropoffIata,
    pickupDate: opts?.pickupDate,
    dropoffDate: opts?.dropoffDate,
    pickupTime: opts?.pickupTime || '10:00',
    dropoffTime: opts?.dropoffTime || '10:00',
    driverAge: opts?.driverAge ?? 24,
    affiliateAid: aid,
  });
}

/** Economy Bookings — Ergebnis-Liste mit Daten, Tracking 16yupj. */
export function getEconomyBookingsUrl(opts?: {
  pickupDate?: string | null;
  dropoffDate?: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
  driverAge?: number | null;
  pickupCountry?: string | null;
  pickupLocationCode?: string | null;
  dropoffLocationCode?: string | null;
  destinationUrl?: string | null;
}): string {
  const dest = opts?.destinationUrl?.trim() || '';
  if (dest && /economybookings\.com/i.test(dest)) {
    try {
      const inner = /tpx\.li|c111\.travelpayouts/i.test(dest)
        ? unwrapPartnerLandingUrl(dest) || dest
        : dest;
      if (!opts?.pickupDate && !opts?.pickupLocationCode) {
        return sanitizeEconomyBookingsUrl(inner);
      }
      const u = new URL(inner);
      const ymdFrom = (y: string | null, m: string | null, d: string | null) =>
        y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
      const compactTime = (raw: string | null): string | null => {
        const m = String(raw || '').match(/^(\d{1,2})(\d{2})$/);
        if (!m) return null;
        return `${m[1].padStart(2, '0')}:${m[2]}`;
      };
      return buildEconomyBookingsResultsUrl({
        pickupDate:
          opts.pickupDate ||
          ymdFrom(
            u.searchParams.get('py'),
            u.searchParams.get('pm'),
            u.searchParams.get('pd'),
          ),
        dropoffDate:
          opts.dropoffDate ||
          ymdFrom(
            u.searchParams.get('dy'),
            u.searchParams.get('dm'),
            u.searchParams.get('dd'),
          ),
        pickupTime: opts.pickupTime || compactTime(u.searchParams.get('pt')),
        dropoffTime: opts.dropoffTime || compactTime(u.searchParams.get('dt')),
        driverAge:
          opts.driverAge ?? (Number(u.searchParams.get('age') || '') || null),
        pickupCountry: opts.pickupCountry || u.searchParams.get('pcntry'),
        pickupLocationCode:
          opts.pickupLocationCode || u.searchParams.get('plc'),
        dropoffLocationCode:
          opts.dropoffLocationCode || u.searchParams.get('dlc'),
        countryCode: u.searchParams.get('cr'),
      });
    } catch {
      return sanitizeEconomyBookingsUrl(dest);
    }
  }
  const hasPrefill = !!(
    opts?.pickupDate?.trim() ||
    opts?.pickupLocationCode?.trim()
  );
  if (!hasPrefill) {
    const fromEnv = env.economyBookingsReferralUrl().trim();
    if (fromEnv && /economybookings\.com/i.test(fromEnv)) {
      return sanitizeEconomyBookingsUrl(fromEnv);
    }
    if (fromEnv) return fromEnv;
  }
  return buildEconomyBookingsResultsUrl({
    pickupDate: opts?.pickupDate,
    dropoffDate: opts?.dropoffDate,
    pickupTime: opts?.pickupTime,
    dropoffTime: opts?.dropoffTime,
    driverAge: opts?.driverAge,
    pickupCountry: opts?.pickupCountry,
    pickupLocationCode: opts?.pickupLocationCode,
    dropoffLocationCode: opts?.dropoffLocationCode,
  });
}

export function buildEconomyBookingsAction(opts?: {
  pickupDate?: string | null;
  dropoffDate?: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
  driverAge?: number | null;
  pickupLocationCode?: string | null;
  destinationUrl?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '🚗 Mietwagen Economy',
    payload: { url: getEconomyBookingsUrl(opts) },
  };
}

export async function openCarRental(opts?: CarRentalDeepOpts): Promise<boolean> {
  const url = getCarRentalUrl(opts);
  try {
    await openAffiliateUrl(url, 'BOOK_CAR');
    return true;
  } catch {
    return false;
  }
}

/** Quick-Action: Mietwagen bei DiscoverCars (mit Prefill wenn möglich). */
export function buildCarRentalAction(opts?: CarRentalDeepOpts & { label?: string }): {
  type: 'BOOK_CAR_RENTAL';
  label: string;
  payload: { url: string };
} {
  const url = getCarRentalUrl(opts);
  const deep = !isHollowPartnerUrl(url);
  return {
    type: 'BOOK_CAR_RENTAL',
    label:
      opts?.label?.trim() ||
      (deep ? '🚗 Mietwagen — Termine prüfen' : '🚗 Mietwagen suchen'),
    payload: { url },
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

/** TravelSecure Reiseversicherung (AWIN mid=106517) — Tarifrechner. */
export function getTravelSecureUrl(destinationUrl?: string): string {
  const dest = destinationUrl?.trim();
  if (!dest) {
    const fromEnv = env.travelSecureAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  const landing =
    dest || TRAVELSECURE_TARIFRECHNER_URL;
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return buildAwinClickUrl({
    merchantId: TRAVELSECURE_AWIN_MID,
    destinationUrl: landing,
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
  // Env-Override nur für leere Starts — sonst verlieren wir Country-Deep-Links
  const dest = destinationUrl?.trim();
  if (!dest) {
    const fromEnv = env.travSimAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  return buildAwinClickUrl({
    merchantId: TRAVSIM_AWIN_MID,
    destinationUrl: dest || 'https://travsim.com/',
  });
}

/** travSIM Produktseite für Land (Tarifwahl — letzter sinnvoller Prefill). */
export function getTravSimCountryProductUrl(travsimSlug: string): string {
  const slug = travsimSlug.trim().toLowerCase();
  return `https://travsim.com/de/products/${encodeURIComponent(slug)}-esim`;
}

/**
 * eSIM-Partner-URL — Land vorgewählt (Expedia-Analog).
 * Primär travSIM Produkt + AWIN. Airalo = getrackte Landesseite als Fallback.
 */
export function getEsimAffiliateUrl(countrySlug?: string): string | null {
  const slug = countrySlug?.trim().toLowerCase();
  if (slug) {
    return getTravSimUrl(getTravSimCountryProductUrl(slug));
  }
  const trav = getTravSimUrl();
  if (trav) return trav;
  return getAiraloAffiliateUrl();
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
 * Env-Override gilt nur als Fallback ohne konkretes Ziel — sonst landet jeder Tap auf der Partner-Startseite.
 */
export function getTiqetsUrl(
  destinationUrl?: string | null,
  cityOrQuery?: string | null,
  prefill?: {
    dateIso?: string | null;
    timeHm?: string | null;
    adults?: number | null;
    variantId?: string | null;
    preferCheckout?: boolean;
  },
): string {
  const destRaw = (destinationUrl ?? '').trim();
  const query = (cityOrQuery ?? '').trim();
  const dest = /awin1\.com\/cread\.php/i.test(destRaw)
    ? unwrapPartnerLandingUrl(destRaw)
    : destRaw;
  let landing = dest || getTiqetsLandingUrl(query || null);
  if (dest && /tiqets\.com/i.test(dest)) {
    landing = toTiqetsDeepLanding(dest, {
      dateIso: prefill?.dateIso,
      timeHm: prefill?.timeHm,
      adults: prefill?.adults,
      variantId: prefill?.variantId,
      preferCheckout: prefill?.preferCheckout ?? Boolean(prefill?.dateIso),
    });
  }
  // Schon AWIN → nicht doppelt
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;

  const mid = (env.tiqetsAwinMid() || TIQETS_AWIN_MID).trim();
  if (mid && (dest || query)) {
    return buildAwinClickUrl({
      merchantId: mid,
      destinationUrl: landing,
    });
  }

  // Nur ohne Ziel: optionaler Env-Shortlink / Travelpayouts
  if (!dest && !query) {
    const fromEnv = env.tiqetsAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
    return getTravelpayoutsUrl('tiqets') || landing;
  }

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
  dateIso?: string | null;
  timeHm?: string | null;
  adults?: number | null;
  variantId?: string | null;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '🎫 Tickets bei Tiqets',
    payload: {
      url: getTiqetsUrl(opts?.destinationUrl, opts?.cityOrQuery, {
        dateIso: opts?.dateIso,
        timeHm: opts?.timeHm,
        adults: opts?.adults,
        variantId: opts?.variantId,
        preferCheckout: true,
      }),
    },
  };
}

export type CampingDeepOpts = {
  cityOrQuery?: string | null;
  /** Konkreter Platz → Detailseite (nicht Stadt-Suche). */
  campsiteName?: string | null;
  campsiteSlug?: string | null;
  destinationUrl?: string | null;
  /** YYYY-MM-DD Anreise / Abreise wenn bekannt. */
  arrival?: string | null;
  departure?: string | null;
  adults?: number | null;
  label?: string;
};

/** camping.info Landing: Portal, Ortssuche oder Stadt-Hub. */
export function getCampingInfoLandingUrl(
  cityOrQuery?: string | null,
  opts?: { arrival?: string | null; departure?: string | null; adults?: number | null },
): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return 'https://www.camping.info/de/';
  const hub = campingInfoCityHubPath(q);
  const base = hub
    ? `https://www.camping.info/de/campingplatz/${encodeURIComponent(hub)}`
    : (() => {
        const u = new URL('https://www.camping.info/de/search');
        u.searchParams.set('q', q);
        return u.toString();
      })();
  return withCampingInfoStayParams(base, {
    arrival: opts?.arrival,
    departure: opts?.departure,
    adults: opts?.adults ?? 2,
    flex: 3,
  });
}

/** camping.info Platz-Detail (Buchung/Anfrage am Platz). */
export function getCampingInfoCampsiteLandingUrl(
  slugOrName: string,
  opts?: { arrival?: string | null; departure?: string | null; adults?: number | null },
): string {
  const slug = slugifyCampingplatz(slugOrName);
  if (!slug) return 'https://www.camping.info/de/';
  return withCampingInfoStayParams(
    `https://www.camping.info/de/campingplatz/${encodeURIComponent(slug)}`,
    {
      arrival: opts?.arrival,
      departure: opts?.departure,
      adults: opts?.adults ?? 2,
      flex: 3,
    },
  );
}

/**
 * camping.info Affiliate (AWIN mid=44063).
 * ~5 % auf Campingplatz-Buchung. Env-Override nur ohne konkretes Ziel.
 */
export function getCampingInfoUrl(
  destinationUrl?: string | null,
  cityOrQuery?: string | null,
  opts?: { arrival?: string | null; departure?: string | null; adults?: number | null },
): string {
  const destRaw = destinationUrl?.trim() || '';
  const dest = /awin1\.com\/cread\.php/i.test(destRaw)
    ? unwrapPartnerLandingUrl(destRaw)
    : destRaw;
  const query = (cityOrQuery ?? '').trim();
  if (!dest && !query) {
    const fromEnv = env.campingInfoAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  let landing =
    dest || getCampingInfoLandingUrl(query || null, opts);
  if (/camping\.info/i.test(landing)) {
    landing = withCampingInfoStayParams(landing, {
      arrival: opts?.arrival,
      departure: opts?.departure,
      adults: opts?.adults,
      flex: 3,
    });
  }
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return buildAwinClickUrl({
    merchantId: CAMPING_INFO_AWIN_MID,
    destinationUrl: landing,
  });
}

/** Quick-Action: Campingplatz bei camping.info — Platz vor Zielsuche. */
export function buildCampingInfoAction(opts?: CampingDeepOpts): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  const campsite =
    opts?.campsiteSlug?.trim() || opts?.campsiteName?.trim() || '';
  let destinationUrl = opts?.destinationUrl?.trim() || null;
  if (!destinationUrl && campsite) {
    destinationUrl = getCampingInfoCampsiteLandingUrl(campsite, {
      arrival: opts?.arrival,
      departure: opts?.departure,
      adults: opts?.adults,
    });
  }
  const url = getCampingInfoUrl(destinationUrl, opts?.cityOrQuery, {
    arrival: opts?.arrival,
    departure: opts?.departure,
    adults: opts?.adults ?? 2,
  });
  const deepCamp = campsite.length > 0;
  return {
    type: 'OPEN_URL',
    label:
      opts?.label?.trim() ||
      (deepCamp
        ? `⛺ ${opts?.campsiteName?.trim() || 'Campingplatz'} öffnen`
        : '⛺ Camping suchen'),
    payload: { url },
  };
}

/**
 * Solmar DE Affiliate (AWIN mid=114510) — Spanien-Bus-/Pauschalreisen.
 */
export function getSolmarUrl(
  destinationUrl?: string | null,
  opts?: { citySlug?: string | null; hotelSlug?: string | null },
): string {
  const dest = destinationUrl?.trim() || '';
  if (!dest && !opts?.citySlug) {
    const fromEnv = env.solmarAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  const landing =
    dest ||
    buildSolmarHotelUrl({
      citySlug: opts?.citySlug,
      hotelSlug: opts?.hotelSlug,
    });
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return buildAwinClickUrl({
    merchantId: SOLMAR_AWIN_MID,
    destinationUrl: landing,
  });
}

/** Quick-Action: Spanien-Reise bei Solmar. */
export function buildSolmarAction(opts?: {
  destinationUrl?: string | null;
  citySlug?: string | null;
  hotelSlug?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '🚌 Spanien-Reise',
    payload: {
      url: getSolmarUrl(opts?.destinationUrl, {
        citySlug: opts?.citySlug,
        hotelSlug: opts?.hotelSlug,
      }),
    },
  };
}

export type Check24Prefill = {
  departureDate?: string | null;
  returnDate?: string | null;
  airport?: string | null;
  adults?: number | null;
};

function isBareCheck24Home(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/check24\.(de|net)$/i.test(u.hostname)) return false;
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return (
      path === '/' &&
      !u.searchParams.has('c24pp_departure_date') &&
      !u.searchParams.has('c24pp_airport')
    );
  } catch {
    return false;
  }
}

/** CHECK24 Reisen — Pauschal-Vergleich (Daten/Airport, keine city_id). */
export function getCheck24PackageLandingUrl(prefill?: Check24Prefill): string {
  return buildCheck24PackageSearchUrl(prefill);
}

/** CHECK24 Mietwagen-Vergleich. */
export function getCheck24CarRentalLandingUrl(): string {
  return buildCheck24CarCompareUrl();
}

export function getCheck24Url(
  destinationUrl?: string | null,
  product: 'package' | 'car' = 'package',
  prefill?: Check24Prefill,
): string {
  const destRaw = destinationUrl?.trim() || '';
  const dest = /awin1\.com\/cread\.php/i.test(destRaw)
    ? unwrapPartnerLandingUrl(destRaw)
    : destRaw;
  const fromEnv =
    product === 'car'
      ? env.check24CarAffiliateUrl().trim()
      : env.check24PackageAffiliateUrl().trim();
  if (fromEnv && !dest && !prefill?.departureDate && !prefill?.airport) {
    return fromEnv;
  }
  let landing = dest;
  if (!landing || isBareCheck24Home(landing)) {
    landing =
      product === 'car'
        ? getCheck24CarRentalLandingUrl()
        : getCheck24PackageLandingUrl(prefill);
  }
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return buildAwinClickUrl({
    merchantId: CHECK24_AWIN_MID,
    destinationUrl: landing,
  });
}

export function buildCheck24PackageAction(opts?: {
  destinationUrl?: string | null;
  label?: string;
  departureDate?: string | null;
  returnDate?: string | null;
  airport?: string | null;
  adults?: number | null;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '✈️ Urlaub vergleichen',
    payload: {
      url: getCheck24Url(opts?.destinationUrl, 'package', {
        departureDate: opts?.departureDate,
        returnDate: opts?.returnDate,
        airport: opts?.airport,
        adults: opts?.adults,
      }),
    },
  };
}

export function buildCheck24CarRentalAction(opts?: {
  destinationUrl?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '🚗 Mietwagen vergleichen',
    payload: { url: getCheck24Url(opts?.destinationUrl, 'car') },
  };
}

/** ab-in-den-urlaub Markt aus URL/Text (DE Default). */
export function resolveAbInDenUrlaubMarket(hint?: string | null): AbInDenUrlaubMarket {
  const b = (hint ?? '').toLowerCase();
  if (/ab-in-den-urlaub\.at|\.at\/|österreich|oesterreich|\baustria\b/.test(b)) {
    return 'at';
  }
  if (/ab-in-den-urlaub\.ch|\.ch\/|schweiz|\bswitzerland\b/.test(b)) {
    return 'ch';
  }
  return 'de';
}

function getAbInDenUrlaubAwinMid(market: AbInDenUrlaubMarket): string {
  if (market === 'at') return AB_IN_DEN_URLAUB_AT_AWIN_MID;
  if (market === 'ch') return AB_IN_DEN_URLAUB_CH_AWIN_MID;
  return AB_IN_DEN_URLAUB_AWIN_MID;
}

export type AbInDenUrlaubPrefill = {
  dateMin?: string | null;
  dateMax?: string | null;
  airports?: string | null;
  adults?: number | null;
  hotelGiataId?: string | null;
  destinationId?: string | null;
};

function isBareAbInDenUrlaubHome(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/ab-in-den-urlaub\.(de|at|ch)$/i.test(u.hostname)) return false;
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return path === '/' && ![...u.searchParams.keys()].length;
  } catch {
    return false;
  }
}

/** ab-in-den-urlaub Landing — Offers-Suche mit Daten/Airport wenn bekannt. */
export function getAbInDenUrlaubLandingUrl(
  market: AbInDenUrlaubMarket = 'de',
  prefill?: AbInDenUrlaubPrefill,
): string {
  if (prefill?.dateMin || prefill?.airports || prefill?.hotelGiataId) {
    const offers = buildAbInDenUrlaubOffersUrl(prefill);
    if (market === 'at') {
      return offers.replace('ab-in-den-urlaub.de', 'ab-in-den-urlaub.at');
    }
    if (market === 'ch') {
      return offers.replace('ab-in-den-urlaub.de', 'ab-in-den-urlaub.ch');
    }
    return offers;
  }
  if (market === 'at') return 'https://www.ab-in-den-urlaub.at/';
  if (market === 'ch') return 'https://www.ab-in-den-urlaub.ch/';
  return 'https://www.ab-in-den-urlaub.de/';
}

/**
 * ab-in-den-urlaub — Pauschal 3 % · Hotel/Eigenanreise 0,5 % · Cookie 30 Tage.
 * Ø Warenkorb ~2.158 € (2024). Gutschein → 0,5 % (Closed Group).
 * GIATA/destinationId nur durchreichen, nie erfinden.
 */
export function getAbInDenUrlaubUrl(
  destinationUrl?: string | null,
  marketHint?: string | null,
  prefill?: AbInDenUrlaubPrefill,
): string {
  const fromEnv = env.abInDenUrlaubAffiliateUrl().trim();
  const destRaw = destinationUrl?.trim() || '';
  const dest = /awin1\.com\/cread\.php/i.test(destRaw)
    ? unwrapPartnerLandingUrl(destRaw)
    : destRaw;
  const market = resolveAbInDenUrlaubMarket(`${dest} ${marketHint ?? ''}`);
  if (fromEnv && !dest && !prefill?.dateMin && !prefill?.hotelGiataId) {
    return fromEnv;
  }
  let landing = dest;
  if (dest && /\/find\/(hotel|offers)/i.test(dest)) {
    landing = dest;
  } else if (dest && /ab-in-den-urlaub\.(de|at|ch)/i.test(dest)) {
    const giata = extractAbInDenUrlaubGiataId(dest) || prefill?.hotelGiataId;
    const destId =
      extractAbInDenUrlaubDestinationId(dest) || prefill?.destinationId;
    if (giata || destId || prefill?.dateMin || prefill?.airports) {
      landing = buildAbInDenUrlaubOffersUrl({
        hotelGiataId: giata,
        destinationId: destId,
        dateMin: prefill?.dateMin,
        dateMax: prefill?.dateMax,
        airports: prefill?.airports,
        adults: prefill?.adults,
      });
    }
  }
  if (!landing || isBareAbInDenUrlaubHome(landing)) {
    landing = getAbInDenUrlaubLandingUrl(market, prefill);
  }
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return buildAwinClickUrl({
    merchantId: getAbInDenUrlaubAwinMid(market),
    destinationUrl: landing,
  });
}

/** Quick-Action: Pauschal/Kurztrip bei ab-in-den-urlaub. */
export function buildAbInDenUrlaubAction(opts?: {
  destinationUrl?: string | null;
  marketHint?: string | null;
  label?: string;
  dateMin?: string | null;
  dateMax?: string | null;
  airports?: string | null;
  adults?: number | null;
  hotelGiataId?: string | null;
  destinationId?: string | null;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '✈️ Urlaub buchen',
    payload: {
      url: getAbInDenUrlaubUrl(opts?.destinationUrl, opts?.marketHint, {
        dateMin: opts?.dateMin,
        dateMax: opts?.dateMax,
        airports: opts?.airports,
        adults: opts?.adults,
        hotelGiataId: opts?.hotelGiataId,
        destinationId: opts?.destinationId,
      }),
    },
  };
}

export type PackageHolidayPrefill = {
  departureDate?: string | null;
  returnDate?: string | null;
  airport?: string | null;
  adults?: number | null;
};

/**
 * Pauschal/Last-Minute-Partner: CHECK24 (Default, ~5,5 %) · Brand-Override siehe blob.
 */
export function buildPackageHolidayAction(opts?: {
  cityOrQuery?: string | null;
  speechOrBlob?: string | null;
  label?: string;
  departureDate?: string | null;
  returnDate?: string | null;
  airport?: string | null;
  adults?: number | null;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  const blob = (opts?.speechOrBlob ?? '').toLowerCase();
  const airport = opts?.airport || parseOriginIata(opts?.speechOrBlob);
  if (/\bweg\.de\b/i.test(blob)) {
    return buildWegDeAction({
      cityOrQuery: opts?.cityOrQuery,
      label: opts?.label,
      dateFrom: opts?.departureDate,
      dateTo: opts?.returnDate,
      origin: airport,
      adults: opts?.adults,
    });
  }
  if (/\b(ab[\s-]?in[\s-]?den[\s-]?urlaub|invia)\b/i.test(blob)) {
    return buildAbInDenUrlaubAction({
      label: opts?.label,
      marketHint: blob,
      dateMin: opts?.departureDate,
      dateMax: opts?.returnDate,
      airports: airport,
      adults: opts?.adults,
    });
  }
  return buildCheck24PackageAction({
    label: opts?.label,
    departureDate: opts?.departureDate,
    returnDate: opts?.returnDate,
    airport,
    adults: opts?.adults,
  });
}

/** weg.de Landing: Städtetrip-Suche ohne Session-Token. */
export function getWegDeLandingUrl(
  cityOrQuery?: string | null,
  opts?: {
    dateFrom?: string | null;
    dateTo?: string | null;
    origin?: string | null;
    adults?: number | null;
  },
): string {
  return buildWegDeSearchUrl({
    cityOrQuery,
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
    origin: opts?.origin,
    adults: opts?.adults,
  });
}

/**
 * weg.de Affiliate (AWIN mid=12224) — Pauschal, Last Minute, Kurztrips.
 * Tote seed/searchId/rctx raus, Daten/Origin behalten.
 */
export function getWegDeUrl(
  destinationUrl?: string | null,
  cityOrQuery?: string | null,
  opts?: {
    dateFrom?: string | null;
    dateTo?: string | null;
    origin?: string | null;
    adults?: number | null;
  },
): string {
  const destRaw = destinationUrl?.trim() || '';
  const dest = /awin1\.com\/cread\.php/i.test(destRaw)
    ? unwrapPartnerLandingUrl(destRaw)
    : destRaw;
  if (!dest && !cityOrQuery && !opts?.dateFrom) {
    const fromEnv = env.wegDeAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  let landing = dest ? sanitizeWegDeUrl(dest) : '';
  if (!landing || /^https?:\/\/(www\.)?weg\.de\/?$/i.test(landing)) {
    landing = getWegDeLandingUrl(cityOrQuery, opts);
  }
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return buildAwinClickUrl({
    merchantId: WEG_DE_AWIN_MID,
    destinationUrl: landing,
  });
}

/** Quick-Action: Pauschal/Kurztrip bei weg.de. */
export function buildWegDeAction(opts?: {
  cityOrQuery?: string | null;
  destinationUrl?: string | null;
  label?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  origin?: string | null;
  adults?: number | null;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '✈️ Urlaub buchen',
    payload: {
      url: getWegDeUrl(opts?.destinationUrl, opts?.cityOrQuery, {
        dateFrom: opts?.dateFrom,
        dateTo: opts?.dateTo,
        origin: opts?.origin,
        adults: opts?.adults,
      }),
    },
  };
}

/**
 * Bounce Gepäckaufbewahrung — Affiliate + Stadt/Koordinaten soweit möglich.
 */
export function getBounceLuggageUrl(opts?: {
  cityName?: string | null;
  lat?: number | null;
  lng?: number | null;
  locationId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  standardBags?: number | null;
}): string {
  const tracked = env.bounceLuggageUrl() || BOUNCE_LUGGAGE_URL;
  const ref = extractBounceAffiliateRef(tracked);
  const city = (opts?.cityName || '').trim();
  const loc = (opts?.locationId || '').trim();
  const hasGeo =
    opts?.lat != null &&
    opts?.lng != null &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng);
  if (loc || city || hasGeo || opts?.fromDate || opts?.standardBags) {
    return buildBounceBookUrl({
      ref,
      query: city || null,
      lat: opts?.lat,
      lng: opts?.lng,
      locationId: loc || null,
      fromDate: opts?.fromDate,
      toDate: opts?.toDate || opts?.fromDate,
      standardBags: opts?.standardBags,
    });
  }
  // Nur reiner Shortlink, wenn wirklich kein Prefill
  return tracked;
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

export async function openBounceLuggage(opts?: {
  cityName?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<boolean> {
  const url = getBounceLuggageUrl(opts);
  try {
    await openAffiliateUrl(url);
    return true;
  } catch {
    return false;
  }
}

/** Quick-Action: Gepäck-Spot bei Bounce — nur wenn Abdeckung plausibel. */
export function buildBounceLuggageAction(opts?: {
  cityId?: string | null;
  cityName?: string | null;
  lat?: number | null;
  lng?: number | null;
  locationId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  standardBags?: number | null;
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
  let lat = opts?.lat ?? null;
  let lng = opts?.lng ?? null;
  if (lat == null || lng == null) {
    try {
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { lat: number | null; lng: number | null };
        };
      };
      const gps = useGpsStore.getState();
      if (gps.lat != null && gps.lng != null) {
        lat = gps.lat;
        lng = gps.lng;
      }
    } catch {
      /* soft */
    }
  }
  const fromDate = opts?.fromDate || null;
  return {
    type: 'BOOK_BOUNCE_LUGGAGE',
    label: cityName
      ? `🧳 Gepäck in ${cityName}`
      : '🧳 Gepäck-Spot buchen',
    payload: {
      url: getBounceLuggageUrl({
        cityName,
        lat,
        lng,
        locationId: opts?.locationId,
        fromDate,
        toDate: opts?.toDate || fromDate,
        standardBags: opts?.standardBags ?? 2,
      }),
    },
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
  // canOpenURL ist auf Android oft falsch-negativ — direkt öffnen
  try {
    await openAffiliateUrl(url);
    return true;
  } catch {
    return false;
  }
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
export const EXPEDIA_DEFAULT_SITE_ID = '20';

export function getExpediaCamref(): string {
  return env.expediaCamref() || EXPEDIA_DEFAULT_CAMREF;
}

export function getExpediaCreativeref(): string {
  return env.expediaCreativeref() || EXPEDIA_DEFAULT_CREATIVEREF;
}

export function getExpediaSiteId(): string {
  return env.expediaSiteId() || EXPEDIA_DEFAULT_SITE_ID;
}

function localizeExpediaTarget(raw: string): string {
  try {
    const u = new URL(raw);
    if (/^(www\.)?expedia\.com$/i.test(u.hostname)) {
      u.hostname = 'www.expedia.de';
      const loc = u.searchParams.get('locale');
      if (loc && /^en[_-]US$/i.test(loc)) u.searchParams.set('locale', 'de_DE');
    }
    return u.toString();
  } catch {
    return raw.replace(
      /https?:\/\/(www\.)?expedia\.com\b/i,
      'https://www.expedia.de',
    );
  }
}

/**
 * Beliebige Expedia-Ziel-URL → provisionsfähiger Affiliate-Link.
 * landingPage = encodeURIComponent(normale expedia.de URL).
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
  const landingPage = encodeURIComponent(localizeExpediaTarget(raw));
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
  try {
    await openAffiliateUrl(tracked, 'EXPEDIA');
    return true;
  } catch {
    return false;
  }
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
export function withGygPartnerParams(
  rawUrl: string,
  opts?: { adults?: number | null; dateIso?: string | null; query?: string | null },
): string {
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
    return withGygDateAdults(url.toString(), {
      adults: opts?.adults,
      dateIso: opts?.dateIso,
      query: opts?.query,
    });
  } catch {
    return trimmed;
  }
}

/**
 * Musement Affiliate-Parameter anhängen:
 * - aid=findus-8445 (offizielle Musement Referral-Syntax)
 * - client_id=findus-8445 (Yorro/TUI-Konvention)
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
export function buildGetYourGuideTourUrl(
  tourSlug: string,
  opts?: { adults?: number | null; dateIso?: string | null },
): string {
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
    return buildGetYourGuideSearchUrl(asQuery, opts);
  }
  return withGygPartnerParams(`${GYG_HOST}/${path}/`, opts);
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
export function buildGetYourGuideSearchUrl(
  query: string,
  opts?: { adults?: number | null; dateIso?: string | null },
): string {
  const q = query.trim();
  const base = q
    ? `${GYG_HOST}/s/?q=${encodeURIComponent(q)}`
    : `${GYG_HOST}/`;
  return withGygPartnerParams(base, { ...opts, query: q || undefined });
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
export function withViatorAffiliateParams(
  rawUrl: string,
  opts?: { adults?: number | null; dateIso?: string | null },
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    url.searchParams.set('pid', getViatorPartnerId());
    url.searchParams.set('mcid', getViatorMcid());
    url.searchParams.set('medium', VIATOR_MEDIUM);
    return withViatorDateAdults(url.toString(), {
      adults: opts?.adults,
      dateIso: opts?.dateIso,
    });
  } catch {
    return trimmed;
  }
}

/**
 * Stellt sicher, dass jeder Viator-Link die Partner-Parameter trägt.
 * Akzeptiert volle URLs oder relative Pfade/Slugs.
 */
export function getViatorBookingUrl(
  tourUrl: string,
  opts?: { adults?: number | null; dateIso?: string | null },
): string {
  const trimmed = (tourUrl || '').trim();
  if (!trimmed) {
    return withViatorAffiliateParams(`${VIATOR_HOST}/`, opts);
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
        opts,
      );
    }
    return withViatorAffiliateParams(url.toString(), opts);
  } catch {
    return withViatorAffiliateParams(`${VIATOR_HOST}/`, opts);
  }
}

/** Viator-Suche (weltweite Touren, VIP-Erlebnisse). */
export function buildViatorSearchUrl(
  query: string,
  opts?: { adults?: number | null; dateIso?: string | null },
): string {
  const q = query.trim();
  const base = q
    ? `${VIATOR_HOST}/searchResults/all?text=${encodeURIComponent(q)}`
    : `${VIATOR_HOST}/`;
  return getViatorBookingUrl(base, opts);
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
    <p class="hint">Verfügbarkeit & Tickets · Partner Yorro</p>
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

export type TicketSourceProvider =
  | 'musement'
  | 'getyourguide'
  | 'viator'
  | 'klook'
  | 'tiqets'
  | 'konfetti'
  | 'reservix'
  | 'direct';

export type PreferTicketSourceInput = {
  kind?: 'museum' | 'tour' | 'attraction' | 'vip' | 'worldwide' | 'generic';
  gygSlug?: string;
  musementUrl?: string;
  viatorUrl?: string;
  tiqetsUrl?: string;
  konfettiUrl?: string;
  query?: string;
  priced?: Array<{ url: string; priceEur?: number | null }>;
  userText?: string;
  dateIso?: string | null;
  adults?: number | null;
};

function ticketProviderFromId(id: string): TicketSourceProvider {
  const base = id.split(':')[0] || id;
  if (base === 'musement') return 'musement';
  if (base === 'viator') return 'viator';
  if (base === 'klook') return 'klook';
  if (base === 'tiqets') return 'tiqets';
  if (base === 'konfetti') return 'konfetti';
  if (base === 'reservix') return 'reservix';
  if (base === 'direct') return 'direct';
  return 'getyourguide';
}

function trackTicketUrl(url: string): string {
  const meta = classifyTicketPartner(url);
  if (meta.id === 'tiqets') return getTiqetsUrl(url);
  if (meta.id === 'viator') return getViatorBookingUrl(url);
  if (meta.id === 'musement') return getMusementBookingUrl(url);
  if (meta.id === 'konfetti') {
    try {
      const { getKonfettiUrl } = require('./konfettiAffiliate') as {
        getKonfettiUrl: (d?: string | null) => string;
      };
      return getKonfettiUrl(url);
    } catch {
      return url;
    }
  }
  if (meta.id === 'reservix') {
    try {
      const { getReservixUrl } = require('./reservixAffiliate') as {
        getReservixUrl: (d?: string | null, q?: string | null) => string;
      };
      return getReservixUrl(url);
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * Ticket-Quelle: Produkt-URLs → pickAffiliateOffer (Preis vs. Provision).
 * Suche nur als Fallback (Museum → Musement, VIP → Viator, Asien → Klook).
 */
export function preferTicketSource(input: PreferTicketSourceInput): {
  provider: TicketSourceProvider;
  url: string;
} {
  const kind = input.kind ?? 'generic';
  const candidates: AffiliateOfferCandidate[] = [];
  const pushTracked = (id: string, url: string, price?: number | null) => {
    const u = String(url || '').trim();
    if (!u) return;
    const meta = classifyTicketPartner(u);
    candidates.push({
      id,
      label: id,
      url: u,
      commissionScore: meta.commissionScore,
      deepLinkLevel: ticketProductKey(u) ? 'deep' : 'search',
      partnerPriceEur: price ?? null,
      identity: ticketIdentity({
        url: u,
        dateIso: input.dateIso,
        adults: input.adults,
      }),
    });
  };

  if (input.gygSlug) {
    pushTracked('getyourguide', buildGetYourGuideTourUrl(input.gygSlug));
  }
  if (input.musementUrl) {
    pushTracked('musement', getMusementBookingUrl(input.musementUrl));
  }
  if (input.viatorUrl) {
    pushTracked('viator', getViatorBookingUrl(input.viatorUrl));
  }
  if (input.tiqetsUrl) {
    pushTracked(
      'tiqets',
      getTiqetsUrl(input.tiqetsUrl, null, {
        dateIso: input.dateIso,
        adults: input.adults,
      }),
    );
  }
  if (input.konfettiUrl) {
    pushTracked('konfetti', trackTicketUrl(input.konfettiUrl));
  }
  for (const p of input.priced ?? []) {
    const meta = classifyTicketPartner(p.url);
    pushTracked(meta.id, trackTicketUrl(p.url), p.priceEur);
  }

  const products = candidates.filter((c) => c.deepLinkLevel === 'deep');
  if (products.length) {
    const pick = pickAffiliateOffer(products, {
      userWantsCheapest: userWantsCheapest(input.userText),
    });
    if (pick) {
      return { provider: ticketProviderFromId(pick.id), url: pick.url };
    }
  }

  const preferMusement = kind === 'museum';
  const preferViator = kind === 'vip' || kind === 'worldwide';

  if (preferViator && input.query) {
    return { provider: 'viator', url: buildViatorSearchUrl(input.query) };
  }
  if (preferMusement && input.query) {
    return { provider: 'musement', url: buildMusementSearchUrl(input.query) };
  }
  if (input.query) {
    const tpxId = pickTourPartnerId({ cityOrQuery: input.query });
    if (tpxId === 'klook') {
      return { provider: 'klook', url: getTravelpayoutsUrl('klook') };
    }
    return {
      provider: 'getyourguide',
      url: buildGetYourGuideSearchUrl(input.query),
    };
  }
  return {
    provider: 'getyourguide',
    url: buildGetYourGuideSearchUrl('tickets'),
  };
}

/** Produkt-URLs parallel quoten (Timeout = kein Preis). Suche wird nicht gefetcht. */
export async function preferTicketSourceQuoted(
  input: PreferTicketSourceInput & {
    fetchHtml?: (url: string, ms: number) => Promise<string | null>;
    timeoutMs?: number;
  },
): Promise<{ provider: TicketSourceProvider; url: string }> {
  const fallback = preferTicketSource(input);
  const productUrls = [
    input.gygSlug ? buildGetYourGuideTourUrl(input.gygSlug) : '',
    input.musementUrl ? getMusementBookingUrl(input.musementUrl) : '',
    input.viatorUrl ? getViatorBookingUrl(input.viatorUrl) : '',
    input.tiqetsUrl ? getTiqetsUrl(input.tiqetsUrl) : '',
    input.konfettiUrl ? trackTicketUrl(input.konfettiUrl) : '',
    ...(input.priced ?? []).map((p) => p.url),
  ].filter((u) => ticketProductKey(u));
  if (productUrls.length < 1) return fallback;
  const picked = await pickQuotedTicket(
    productUrls.map((url) => ({
      url,
      priceEur: input.priced?.find((p) => p.url === url)?.priceEur,
    })),
    {
      userWantsCheapest: userWantsCheapest(input.userText),
      dateIso: input.dateIso,
      adults: input.adults,
      fetchHtml: input.fetchHtml,
      timeoutMs: input.timeoutMs,
    },
  );
  if (!picked) return fallback;
  return {
    provider: ticketProviderFromId(picked.id),
    url: trackTicketUrl(picked.url),
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

  // Leere Partner-Portale nie als Ticket-Button
  if (isHollowPartnerUrl(picked.url)) {
    const fallbackQ = query || 'tickets';
    return {
      type: 'OPEN_URL',
      label: '🎟️ Touren suchen',
      payload: { url: buildGetYourGuideSearchUrl(fallbackQ) },
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
            : picked.provider === 'konfetti'
              ? '🎫 Probe buchen'
              : picked.provider === 'reservix'
                ? '🎫 Tickets bei Reservix'
                : picked.provider === 'direct'
                ? '🎫 Tickets'
                : '🎟️ Tour bei GetYourGuide';

  // Buchungs-Wortlaut nur bei echtem Produkt-Deep-Link
  if (
    !mayShowAsPartnerBookAction({ label, url: picked.url })
  ) {
    return {
      type: 'OPEN_URL',
      label: '🎟️ Touren suchen',
      payload: {
        url: query
          ? buildGetYourGuideSearchUrl(query)
          : picked.url,
      },
    };
  }

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
    try {
      const u = new URL(url);
      if (!u.searchParams.get('a_aid')) u.searchParams.set('a_aid', 'Yorro-Ai');
      if (/\/search/i.test(u.pathname) || u.searchParams.get('sq')) {
        return u.toString();
      }
      return getCarRentalUrl({
        pickupIata: u.searchParams.get('pickup_iata'),
        pickupLocation: u.searchParams.get('pickup_location'),
        pickupDate: u.searchParams.get('pickup_date'),
        dropoffDate: u.searchParams.get('dropoff_date'),
        pickupTime: u.searchParams.get('pickup_time'),
        dropoffTime: u.searchParams.get('dropoff_time'),
        driverAge: Number(u.searchParams.get('driver_age') || '') || 24,
      });
    } catch {
      return getCarRentalUrl();
    }
  }

  if (/klook\.com|affiliate\.klook\.com|kkday\.com|invl\.me|wegotrip\.com|gocity\.com|prf\.hn\/click|welcomepickups\.com|gettransfer\.com|kiwitaxi\.com|intui\.travel|localrent\.com|getrentacar\.com|autoeurope\.(eu|com)|bikesbooking\.com|radicalstorage\.com|airhelp\.com|compensair\.com|qeeq\.com|saily\.com|go\.saily\.site|yesim\.tech/i.test(
    url,
  )) {
    return stampTpxPartnerTracking(url);
  }
  if (/economybookings\.com/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    return getEconomyBookingsUrl({
      destinationUrl: /^https?:\/\//i.test(inner) ? inner : url,
    });
  }
  if (/gokonfetti\.com|awin1\.com\/cread\.php.*31804/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    const { getKonfettiUrl } = require('./konfettiAffiliate') as {
      getKonfettiUrl: (d?: string | null, q?: string | null) => string;
    };
    return getKonfettiUrl(/^https?:\/\//i.test(inner) ? inner : url);
  }
  if (/reservix\.(de|at|ch)|awin1\.com\/cread\.php.*31293/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    const { getReservixUrl } = require('./reservixAffiliate') as {
      getReservixUrl: (d?: string | null, q?: string | null) => string;
    };
    return getReservixUrl(/^https?:\/\//i.test(inner) ? inner : url);
  }
  if (/travelsecure\.de|awin1\.com\/cread\.php.*106517/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    return getTravelSecureUrl(
      /travelsecure\.de/i.test(inner) && /tarifrechner/i.test(inner)
        ? inner
        : undefined,
    );
  }
  if (/travsim\.com|awin1\.com\/cread\.php.*15561/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    if (/travsim\.com/i.test(inner) && /\/products\//i.test(inner)) {
      return getTravSimUrl(inner);
    }
    return getTravSimUrl(inner.startsWith('http') ? inner : undefined);
  }
  if (/airalo\.com|tp\.media\/r\?[^?\s]*p=8310|airalo\.tpx\.li/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    let slug = '';
    try {
      const path = new URL(
        /airalo\.com/i.test(inner) ? inner : url,
      ).pathname.replace(/^\/+|\/+$/g, '');
      slug = path.replace(/-esim$/i, '').split('/')[0] || '';
    } catch {
      slug = '';
    }
    return getAiraloAffiliateUrl(slug || undefined) || url;
  }
  if (/tiqets\.com/i.test(url)) {
    return getTiqetsUrl(url);
  }
  if (/camping\.info|awin1\.com\/cread\.php.*44063/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    try {
      const u = new URL(inner);
      return getCampingInfoUrl(inner, null, {
        arrival: u.searchParams.get('arrival'),
        departure: u.searchParams.get('departure'),
        adults: Number(u.searchParams.get('adults') || '') || 2,
      });
    } catch {
      return getCampingInfoUrl(inner);
    }
  }
  if (/solmar\.de|awin1\.com\/cread\.php.*114510/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    return getSolmarUrl(/solmar\.de/i.test(inner) ? inner : url);
  }
  if (/check24\.(de|net)|awin1\.com\/cread\.php.*9364/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    const dest = /^https?:\/\//i.test(inner) ? inner : url;
    if (/mietwagen|mietwagen-preisvergleich/i.test(dest)) {
      return getCheck24Url(dest, 'car');
    }
    return getCheck24Url(dest, 'package');
  }
  if (/ab-in-den-urlaub\.(de|at|ch)|awin1\.com\/cread\.php.*(9369|15612|15613)/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    return getAbInDenUrlaubUrl(/^https?:\/\//i.test(inner) ? inner : url);
  }
  if (/\bweg\.de\b|awin1\.com\/cread\.php.*12224/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    return getWegDeUrl(/^https?:\/\//i.test(inner) ? inner : url);
  }
  if (/bounce\.com|go\.bounce\.com/i.test(url)) {
    try {
      const inner = unwrapPartnerLandingUrl(url);
      const u = new URL(/^https?:\/\//i.test(inner) ? inner : url);
      const from = u.searchParams.get('from') || '';
      const to = u.searchParams.get('to') || '';
      const bags = Number(u.searchParams.get('standardBags') || '');
      return getBounceLuggageUrl({
        cityName: u.searchParams.get('query'),
        lat: Number(u.searchParams.get('latitude') || '') || null,
        lng: Number(u.searchParams.get('longitude') || '') || null,
        locationId: bounceLocationIdFromUrl(u.toString()),
        fromDate: from.slice(0, 10) || null,
        toDate: to.slice(0, 10) || null,
        standardBags: Number.isFinite(bags) && bags > 0 ? bags : 2,
      });
    } catch {
      return getBounceLuggageUrl();
    }
  }
  if (/stay22\.com/i.test(url)) {
    try {
      const u = new URL(url);
      // Property-/Hotel-Deep-Links nicht zu Stadt-Suche kollabieren
      const address = (u.searchParams.get('address') || '').trim();
      const hotelish =
        address.length >= 8 &&
        !/^(germany|deutschland|europe|europa)$/i.test(address);
      if (hotelish || u.pathname.includes('/hotel')) {
        const aid = getStay22AffiliateId();
        u.searchParams.set('aid', aid);
        return u.toString();
      }
      const adultsRaw = u.searchParams.get('adults');
      const adultsN = adultsRaw ? Number(adultsRaw) : NaN;
      return getStay22AccommodationUrl(address, {
        checkin: u.searchParams.get('checkin') || undefined,
        checkout: u.searchParams.get('checkout') || undefined,
        adults: Number.isFinite(adultsN) && adultsN > 0 ? adultsN : undefined,
      });
    } catch {
      return getStay22AccommodationUrl('');
    }
  }
  if (/expedia\.(com|de|at|ch)\b/i.test(url) || /expedia\.com\/affiliate\?/i.test(url)) {
    try {
      const {
        extractExpediaPropertyId,
        buildExpediaHotelPropertyDeepLink,
        injectExpediaStayDates,
        isExpediaHotelPropertyUrl,
      } = require('./hotelPropertyDeepLink') as {
        extractExpediaPropertyId: (u: string) => string | null;
        buildExpediaHotelPropertyDeepLink: (
          id: string,
          o: { checkin: string; checkout: string; adults?: number },
        ) => string;
        injectExpediaStayDates: (
          u: string,
          a: string,
          b: string,
          adults?: number,
        ) => string;
        isExpediaHotelPropertyUrl: (u: string) => boolean;
      };
      // Affiliate-Wrapper: innere landingPage upgraden wenn Property-ID
      if (/expedia\.com\/affiliate\?/i.test(url)) {
        return url;
      }
      const pid = extractExpediaPropertyId(url);
      if (pid) {
        try {
          const u = new URL(url);
          const chkin = u.searchParams.get('chkin') || '';
          const chkout = u.searchParams.get('chkout') || '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(chkin) && /^\d{4}-\d{2}-\d{2}$/.test(chkout)) {
            return buildExpediaAffiliateLink(
              buildExpediaHotelPropertyDeepLink(pid, {
                checkin: chkin,
                checkout: chkout,
              }),
            );
          }
        } catch {
          /* soft */
        }
      }
      if (isExpediaHotelPropertyUrl(url)) {
        return buildExpediaAffiliateLink(url);
      }
    } catch {
      /* soft */
    }
    return buildExpediaAffiliateLink(url);
  }
  return url;
}

export type UberRideDeepOpts = {
  pickup?: {
    lat: number;
    lng: number;
    nickname?: string | null;
    formattedAddress?: string | null;
  } | null;
  /** true = pickup=my_location (Uber GPS). */
  pickupMyLocation?: boolean;
  dropoffFormattedAddress?: string | null;
  /** HH:mm — mit Wert → Reserve-URL inkl. Abholzeit. */
  pickupTimeLabel?: string | null;
  /** YYYY-MM-DD für Reserve. */
  pickupDateIso?: string | null;
};

/**
 * Uber: Produktwahl (Preis + ETA) oder Reserve mit Abholzeit.
 * client_id bleibt für Affiliate-Tracking.
 */
export function getUberRideUrl(
  destLat: number,
  destLng: number,
  destName: string,
  pickupOrOpts?: { lat: number; lng: number } | null | UberRideDeepOpts,
): string {
  const opts: UberRideDeepOpts =
    pickupOrOpts &&
    typeof pickupOrOpts === 'object' &&
    ('pickupMyLocation' in pickupOrOpts ||
      'dropoffFormattedAddress' in pickupOrOpts ||
      'pickupTimeLabel' in pickupOrOpts ||
      'pickupDateIso' in pickupOrOpts ||
      (pickupOrOpts as UberRideDeepOpts).pickup !== undefined)
      ? (pickupOrOpts as UberRideDeepOpts)
      : { pickup: pickupOrOpts as { lat: number; lng: number } | null };

  const dropAddr = (opts.dropoffFormattedAddress || destName || 'Ziel').trim();
  if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
    return buildUberGoUrl({
      clientId: getUberClientId(),
      dropoff: uberPlaceFromAddress(0, 0, 'Ziel'),
      pickupMyLocation: true,
    }).replace(/drop%5B0%5D=[^&]+&?/, '');
  }
  const dropoff = uberPlaceFromAddress(destLat, destLng, dropAddr);
  const pu = opts.pickup;
  const pickup =
    pu && Number.isFinite(pu.lat) && Number.isFinite(pu.lng)
      ? uberPlaceFromAddress(
          pu.lat,
          pu.lng,
          pu.formattedAddress || pu.nickname || 'Mein Standort',
        )
      : null;

  return buildUberGoUrl({
    clientId: getUberClientId(),
    dropoff,
    pickup,
    pickupMyLocation: opts.pickupMyLocation,
    pickupTimeHm: opts.pickupTimeLabel
      ? roundClockHmmDownTo5(opts.pickupTimeLabel)
      : null,
    pickupDateIso: opts.pickupDateIso,
  });
}

export async function openUberRide(
  destLat: number,
  destLng: number,
  destName: string,
  pickup?: { lat: number; lng: number } | null,
  opts?: Omit<UberRideDeepOpts, 'pickup'>,
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
  const url = getUberRideUrl(destLat, destLng, destName, {
    pickup: from,
    pickupMyLocation: !from,
    dropoffFormattedAddress: opts?.dropoffFormattedAddress ?? destName,
    pickupTimeLabel: opts?.pickupTimeLabel,
    pickupDateIso: opts?.pickupDateIso,
  });
  // canOpenURL ist auf Android oft falsch-negativ (Klammern, Package-Visibility)
  try {
    await openAffiliateUrl(url);
    return true;
  } catch {
    // Zweiter Versuch: nativer Uber-Scheme, gleicher Deep-Link (Pickup + Dropoff)
    try {
      const native = url.replace(
        /^https:\/\/m\.uber\.com\/ul\/?/i,
        'uber://riders',
      );
      if (native !== url) {
        await openAffiliateUrl(native);
        return true;
      }
    } catch {
      /* keep fail */
    }
    return false;
  }
}

/** Quick-Action-Helper für Concierge-Karten. */
export function buildUberRideAction(
  destLat: number,
  destLng: number,
  destName: string,
  targetPoiId?: string | number,
  opts?: {
    dropoffFormattedAddress?: string | null;
    pickupTimeLabel?: string | null;
    pickupNickname?: string | null;
    pickupFormattedAddress?: string | null;
  },
): {
  type: 'BOOK_UBER';
  label: string;
  payload: {
    destLat: number;
    destLng: number;
    destName: string;
    targetPoiId?: string | number;
    url: string;
    dropoffFormattedAddress?: string;
    pickupTimeLabel?: string;
  };
} {
  const name = (destName || 'Ziel').trim() || 'Ziel';
  let pickup: {
    lat: number;
    lng: number;
    nickname?: string;
    formattedAddress?: string;
  } | null = null;
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
      pickup = {
        lat: gps.lat,
        lng: gps.lng,
        nickname: opts?.pickupNickname?.trim() || 'Mein Standort',
        formattedAddress: opts?.pickupFormattedAddress?.trim() || undefined,
      };
    }
  } catch {
    /* soft */
  }
  const timeRaw = opts?.pickupTimeLabel?.trim();
  const time = timeRaw ? roundClockHmmDownTo5(timeRaw) : '';
  const url = getUberRideUrl(destLat, destLng, name, {
    pickup,
    pickupMyLocation: !pickup,
    dropoffFormattedAddress: opts?.dropoffFormattedAddress ?? name,
    pickupTimeLabel: time,
  });
  return {
    type: 'BOOK_UBER',
    label: time ? `🚗 Uber · ${time}` : '🚗 Fahrt mit Uber buchen',
    payload: {
      destLat,
      destLng,
      destName: name,
      targetPoiId,
      url,
      dropoffFormattedAddress: opts?.dropoffFormattedAddress ?? name,
      pickupTimeLabel: time || undefined,
    },
  };
}

/** Uber Eats — Deep-Link (App/Web). Kein In-App-Checkout; User schließt in Uber Eats ab. */
export function getUberEatsUrl(opts?: {
  cityHint?: string | null;
  query?: string | null;
}): string {
  const q = (opts?.query || opts?.cityHint || '').trim();
  if (q) {
    return `https://www.ubereats.com/de/search?q=${encodeURIComponent(q)}`;
  }
  return 'https://www.ubereats.com/de';
}

export function buildUberEatsAction(opts?: {
  cityHint?: string | null;
  query?: string | null;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string; destName: string };
} {
  return {
    type: 'OPEN_URL',
    label: '🍔 Uber Eats',
    payload: { url: getUberEatsUrl(opts), destName: 'Uber Eats' },
  };
}

export function wantsUberEatsExplicitly(text: string): boolean {
  return /\b(uber\s*eats|lieferung\s+(?:bestell|essen)|essen\s+liefern\s+lassen|lieferservice)\b/iu.test(
    text,
  );
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
        'Primär für BOOK_CAR_RENTAL (a_aid=Yorro-Ai). ~$20 avg / Booking laut Partner.',
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
      // Deep-Links aus Pack-IDs (ot:/qd:); Affiliate optional
      conciergeActions: [],
      status: 'ready',
      notes:
        'Pack-Tags ot:<id> → OpenTable-Profil-URL; optional EXPO_PUBLIC_OPENTABLE_AFFILIATE_ID als ref=.',
    },
    {
      id: 'quandoo',
      name: 'Quandoo',
      category: 'Restaurant-Reservierung',
      envKeys: ['EXPO_PUBLIC_QUANDOO_PARTNER_ID'],
      value: env.quandooPartnerId() || '(leer)',
      helperFns: ['getQuandooPartnerId', 'getQuandooBookingUrl'],
      conciergeActions: [],
      status: 'ready',
      notes:
        'Pack-Tags qd:<id> → Quandoo-Place-URL; optional Partner-Tracking-Param.',
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
    {
      id: 'reservix_awin',
      name: 'Reservix DE (AWIN)',
      category: 'Live-Events & Tickets',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_RESERVIX_AWIN_MID',
        'EXPO_PUBLIC_RESERVIX_AFFILIATE_URL',
      ],
      value: (() => {
        const { getReservixUrl } = require('./reservixAffiliate') as {
          getReservixUrl: () => string;
        };
        return getReservixUrl();
      })(),
      helperFns: [
        'getReservixUrl',
        'getReservixLandingUrl',
        'buildReservixAction',
        'buildAwinClickUrl',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'AWIN mid=31293. ~2,5 % Warenkorb + VVK-Anteil · Cookie 30 Tage. Konzert/Theater/Festival/Sport DE; Museen → Tiqets.',
    },
    {
      id: 'camping_info',
      name: 'camping.info (AWIN DE/AT)',
      category: 'Camping',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_CAMPING_INFO_AFFILIATE_URL',
      ],
      value: getCampingInfoUrl(),
      helperFns: [
        'getCampingInfoUrl',
        'getCampingInfoLandingUrl',
        'buildCampingInfoAction',
        'buildAwinClickUrl',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'AWIN mid=44063. ~5 % auf Campingplatz-Buchung (Ø ~€244), App 0,50 €, Shop 30 %. Button bei Camping-Intent.',
    },
    {
      id: 'solmar',
      name: 'Solmar DE (AWIN)',
      category: 'Pauschal / Busreisen Spanien',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_SOLMAR_AFFILIATE_URL',
      ],
      value: getSolmarUrl(),
      helperFns: ['getSolmarUrl', 'buildSolmarAction', 'buildAwinClickUrl'],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'AWIN mid=114510. Spanien-Spezialist (Bus/Flug/Pauschal, Costa). Button bei Spanien-Bus-/Pauschal-Intent.',
    },
    {
      id: 'weg_de',
      name: 'weg.de DE (AWIN)',
      category: 'Pauschal / Last Minute / Kurztrips',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_WEG_DE_AFFILIATE_URL',
      ],
      value: getWegDeUrl(),
      helperFns: [
        'getWegDeUrl',
        'getWegDeLandingUrl',
        'buildWegDeAction',
        'buildAwinClickUrl',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'AWIN mid=12224. Pauschal, Last Minute, Städtetrips, Hotels/Flüge. Button bei Pauschal-/Kurztrip-Intent.',
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
// OpenTable / Quandoo — Deep-Links aus Pack-IDs (ot:/qd:) + optional Env-Affiliate
// ---------------------------------------------------------------------------

/** @returns Partner-ID oder null, wenn Slot leer. */
export function getOpenTableAffiliateId(): string | null {
  const id = env.openTableAffiliateId().trim();
  return id.length > 0 ? id : null;
}

/**
 * OpenTable Restaurant-Profil / Restref — Prefill bleibt dem Partner überlassen.
 * Affiliate-ID optional als `ref=` (wenn Env gesetzt).
 */
export function getOpenTableBookingUrl(restaurantId?: string): string | null {
  const id = restaurantId?.trim();
  if (!id) return null;
  const aff = getOpenTableAffiliateId();
  const base = /^\d+$/.test(id)
    ? `https://www.opentable.de/restaurant/profile/${encodeURIComponent(id)}`
    : `https://www.opentable.de/r/${encodeURIComponent(id)}`;
  if (aff) {
    const join = base.includes('?') ? '&' : '?';
    return `${base}${join}ref=${encodeURIComponent(aff)}`;
  }
  return base;
}

/** @returns Partner-ID oder null, wenn Slot leer. */
export function getQuandooPartnerId(): string | null {
  const id = env.quandooPartnerId().trim();
  return id.length > 0 ? id : null;
}

/**
 * Quandoo Place-Deep-Link. Partner-ID optional als Tracking-Param.
 */
export function getQuandooBookingUrl(placeId?: string): string | null {
  const id = placeId?.trim();
  if (!id) return null;
  const partner = getQuandooPartnerId();
  const base = `https://www.quandoo.de/place/${encodeURIComponent(id)}`;
  if (partner) {
    return `${base}?tracking=${encodeURIComponent(partner)}`;
  }
  return base;
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
 * Airalo Partner-URL: Landesseite `/greece` + Travelpayouts (Provision).
 * Nicht `/greece-esim?selected-segment=unlimited` (bricht).
 */
export function getAiraloAffiliateUrl(countrySlug?: string): string | null {
  const slug = countrySlug?.trim().toLowerCase();
  const page = slug
    ? buildAiraloCountryPageUrl(slug)
    : 'https://www.airalo.com/';
  const id = getAiraloAffiliateId();
  if (id) {
    const url = new URL(page);
    url.searchParams.set('ref', id);
    return url.toString();
  }
  return buildAiraloTravelpayoutsUrl(page, getTravelpayoutsMarker());
}

export async function openAiraloEsim(countrySlug?: string): Promise<boolean> {
  const url = getAiraloAffiliateUrl(countrySlug);
  if (!url) return false;
  const can = await Linking.canOpenURL(url);
  if (!can) return false;
  await openAffiliateUrl(url);
  return true;
}

/** Quick-Action: eSIM — Land vorgewählt wenn erkennbar. */
export function buildEsimAction(opts?: {
  countrySlug?: string;
  countryLabel?: string;
  textHint?: string;
}): {
  type: 'BOOK_ESIM';
  label: string;
  payload: { url: string };
} | null {
  let slug = opts?.countrySlug?.trim().toLowerCase() || '';
  let labelDe = opts?.countryLabel?.trim() || '';
  if (!slug) {
    try {
      const { resolveEsimCountry } = require('./partnerDeepPrefill') as {
        resolveEsimCountry: (o: {
          text?: string | null;
          cityName?: string | null;
          countryHint?: string | null;
        }) => { airaloSlug: string; labelDe: string } | null;
      };
      const profile = getCachedUserProfile();
      const hit = resolveEsimCountry({
        text: opts?.textHint,
        cityName: profile?.cityName,
        countryHint: (profile as { country?: string } | null)?.country,
      });
      if (hit) {
        slug = hit.airaloSlug;
        labelDe = hit.labelDe;
      }
    } catch {
      /* soft */
    }
  }
  const url = getEsimAffiliateUrl(slug || undefined);
  if (!url) return null;
  return {
    type: 'BOOK_ESIM',
    label: labelDe
      ? `📱 eSIM ${labelDe} — Tarif wählen`
      : '📱 eSIM holen',
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

/** Travelpayouts Marker (Yorro). */
export function getTravelpayoutsMarker(): string {
  return env.travelpayoutsMarker() || TRAVELPAYOUTS_MARKER;
}

/**
 * OPEN_URL für eine Travelpayouts-Kategorie (primärer Partner).
 */
export function buildTravelpayoutsCategoryAction(
  category: Parameters<typeof pickPrimaryPartner>[0],
  opts?: {
    cityOrQuery?: string | null;
    label?: string;
    dateIso?: string | null;
    endDateIso?: string | null;
    adults?: number | null;
    luggage?: number | null;
    timeHm?: string | null;
    pickupLocation?: string | null;
    countrySlug?: string | null;
    lat?: number | null;
    lng?: number | null;
    bags?: number | null;
    dropOffTimeHm?: string | null;
    pickUpTimeHm?: string | null;
    spotPath?: string | null;
  },
): { type: 'OPEN_URL'; label: string; payload: { url: string } } {
  const p = pickPrimaryPartner(category, opts);
  const city = (opts?.cityOrQuery ?? '').trim();
  let url = p.url;
  if (p.id === 'tiqets') {
    url = getTiqetsUrl(null, city || null);
  } else if (p.id === 'welcome_pickups' && city) {
    url = buildWelcomePickupsTransferUrl({
      citySlug: city,
      dateIso: opts?.dateIso,
      timeHm: opts?.timeHm,
      passengers: opts?.adults,
      luggage: opts?.luggage,
    });
  } else if (p.id === 'gocity' && city) {
    url = buildGoCityExplorerUrl({
      citySlug: city,
      adults: opts?.adults,
    });
  } else if (p.id === 'bikesbooking') {
    url = buildBikesbookingSearchUrl({
      beginIso: opts?.dateIso,
      endIso: opts?.endDateIso,
    });
  } else if (p.id === 'gettransfer') {
    url = buildGetTransferNewUrl();
  } else if (p.id === 'localrent' && (opts?.countrySlug || city)) {
    url = buildLocalrentSearchUrl({
      countrySlug: opts?.countrySlug || city,
      pickupDate: opts?.dateIso,
      dropoffDate: opts?.endDateIso,
    });
  } else if (p.id === 'getrentacar' && (opts?.pickupLocation || city)) {
    url = buildGetRentacarRequestUrl({
      pickupLocation: opts?.pickupLocation || city,
      pickupDate: opts?.dateIso,
      returnDate: opts?.endDateIso,
    });
  } else if (p.id === 'autoeurope') {
    url = buildAutoEuropeResultsUrl();
  } else if (p.id === 'klook' && /klook\.com\/activity\//i.test(url)) {
    url = stampTpxPartnerTracking(url);
  } else if (p.id === 'radicalstorage') {
    url = buildRadicalStorageUrl({
      citySlug: city || null,
      spotPath: opts?.spotPath,
      lat: opts?.lat,
      lng: opts?.lng,
      dropOffIso: opts?.dateIso,
      pickUpIso: opts?.endDateIso || opts?.dateIso,
      dropOffTimeHm: opts?.dropOffTimeHm || opts?.timeHm,
      pickUpTimeHm: opts?.pickUpTimeHm,
      bags: opts?.bags ?? opts?.luggage,
    });
  } else if (p.id === 'airhelp') {
    url = buildAirhelpClaimUrl();
  } else if (p.id === 'compensair') {
    url = buildCompensairCheckUrl();
  } else if (
    p.id === 'qeeq' &&
    opts?.lat != null &&
    opts?.lng != null &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng)
  ) {
    url = buildQeeqSearchMapUrl({ lat: opts.lat, lng: opts.lng });
  } else if (p.id === 'saily' && (opts?.countrySlug || city)) {
    url = withSailyAffiliate(
      buildSailyCountryPageUrl(opts?.countrySlug || city),
    );
  } else if (p.id === 'yesim' && (opts?.countrySlug || city)) {
    url = buildYesimCountryPageUrl(opts?.countrySlug || city);
  }
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
