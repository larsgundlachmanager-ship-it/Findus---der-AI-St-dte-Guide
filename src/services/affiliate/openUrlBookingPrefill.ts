/**
 * Last-Mile: OPEN_URL so weit vorbefüllen, wie der Partner öffentlich erlaubt.
 * Hotels → Property + Check-in/out bis Zimmerwahl.
 * Tisch → Name/E-Mail/Personen/Zeit in Query oder Mailto.
 * Uber → Pickup/Dropoff (Uhrzeit nicht im Deeplink).
 * Tickets → Produkt + Datum/Personen (GYG/Tiqets Checkout/Viator), Affiliate bleibt.
 * Uber → Produktwahl jetzt oder Reserve mit Abholzeit.
 */

import type { QuickActionPayload } from '../../types/concierge';

export type PrefillPatch = {
  url: string;
  checkin?: string;
  checkout?: string;
  adults?: number;
};

function blobOf(label: string, url: string): string {
  return `${label} ${url}`;
}

export function looksLikeHotelBookOpenUrl(label: string, url: string): boolean {
  const b = blobOf(label, url);
  if (/opentable|quandoo|resmio|speisekarte|ticketmaster|eventim/i.test(b)) {
    return false;
  }
  return /expedia|stay22|booking\.com|hotels\.com|vrbo|hoteis\.com|\/go\/hotel\/|\.h\d{5,}\.Hotel|🏨|zimmer\s*buch|hotel\s*buch/i.test(
    b,
  );
}

export function looksLikeReservationOpenUrl(label: string, url: string): boolean {
  const b = blobOf(label, url);
  if (/expedia|stay22|booking\.com\/hotel/i.test(b)) return false;
  return /opentable|quandoo|resmio|bookatable|tischreserv|tisch\s+online|reservier/i.test(
    b,
  );
}

export function looksLikeUberOpenUrl(url: string): boolean {
  return /m\.uber\.com|uber\.com\/ul/i.test(url);
}

/**
 * Sync: Daten in die URL hängen. Kein Fake-Checkout bei Partnern ohne API.
 */
export function applyOpenUrlBookingPrefill(opts: {
  url: string;
  label?: string;
  payload?: QuickActionPayload;
  userText?: string | null;
}): PrefillPatch {
  const url = String(opts.url ?? '').trim();
  const label = opts.label ?? '';
  const payload = opts.payload ?? {};
  if (!url || /^(mailto|tel):/i.test(url)) return { url };
  if (/google\.[^/\s]+\/search/i.test(url)) return { url };
  if (/maps\.google|google\.[^/\s]+\/maps/i.test(url)) return { url };

  if (looksLikeUberOpenUrl(url)) {
    const lat = payload.destLat;
    const lng = payload.destLng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      try {
        const { getUberRideUrl } = require('./affiliateService') as {
          getUberRideUrl: (
            a: number,
            b: number,
            n: string,
            o?: {
              dropoffFormattedAddress?: string | null;
              pickupMyLocation?: boolean;
              pickupTimeLabel?: string | null;
              pickupDateIso?: string | null;
            },
          ) => string;
        };
        return {
          url: getUberRideUrl(lat, lng, payload.destName || 'Ziel', {
            dropoffFormattedAddress:
              payload.dropoffFormattedAddress || payload.destName,
            pickupMyLocation: true,
            pickupTimeLabel: payload.pickupTimeLabel,
            pickupDateIso: payload.dateIso,
          }),
        };
      } catch {
        return { url };
      }
    }
    return { url };
  }

  if (looksLikeReservationOpenUrl(label, url)) {
    try {
      const { withReservationPrefill, parsePartySize, parseTimeHm, parseDateIso, parseReservationOccasion } =
        require('../reservation/reservationPrefill') as typeof import('../reservation/reservationPrefill');
      const { getCachedUserProfile } = require('../userProfileService') as {
        getCachedUserProfile: () => import('../../types/userProfile').UserProfile | null;
      };
      const { getReservationContact } = require('../../types/userProfile') as {
        getReservationContact: (
          p: import('../../types/userProfile').UserProfile | null,
        ) => {
          fullName: string;
          email: string;
          phoneNumber: string;
        };
      };
      const contact = getReservationContact(getCachedUserProfile());
      const text = `${opts.userText ?? ''} ${label}`;
      const next = withReservationPrefill(url, {
        partySize: payload.partySize ?? parsePartySize(text) ?? 2,
        dateIso: payload.dateIso ?? parseDateIso(text),
        timeHm: parseTimeHm(text),
        guestName: contact.fullName || null,
        guestEmail: contact.email || null,
        guestPhone: contact.phoneNumber || null,
        notes: parseReservationOccasion(text),
      });
      return { url: next };
    } catch {
      return { url };
    }
  }

  if (looksLikeHotelBookOpenUrl(label, url)) {
    try {
      const {
        extractExpediaPropertyId,
        buildExpediaHotelPropertyDeepLink,
        injectExpediaStayDates,
        isExpediaHotelPropertyUrl,
        finalizeHotelBookAffiliateUrl,
      } = require('./hotelPropertyDeepLink') as {
        extractExpediaPropertyId: (u: string) => string | null;
        buildExpediaHotelPropertyDeepLink: (
          id: string,
          o: { checkin: string; checkout: string; adults?: number },
        ) => string;
        injectExpediaStayDates: (
          u: string,
          checkin: string,
          checkout: string,
          adults?: number,
        ) => string;
        isExpediaHotelPropertyUrl: (u: string) => boolean;
        finalizeHotelBookAffiliateUrl: (o: {
          hotelName: string;
          city?: string | null;
          bookUrl?: string | null;
          checkin: string;
          checkout: string;
          adults?: number;
        }) => string;
      };
      const hotelName =
        (payload.destName || payload.entityName || '').trim();
      const target = (() => {
        try {
          const { resolveHotelBookTarget } =
            require('./hotelPropertyDeepLink') as {
              resolveHotelBookTarget: (o: {
                hotelName?: string | null;
                city?: string | null;
                destination?: string | null;
              }) => { hotelName: string; city: string | null };
            };
          return resolveHotelBookTarget({
            hotelName,
            destination: payload.destination,
            city: payload.destination,
          });
        } catch {
          return {
            hotelName: hotelName || payload.destination || 'Hotel',
            city: payload.destination || null,
          };
        }
      })();
      let city: string | null = target.city;
      if (!city) {
        try {
          const { getCachedUserProfile } = require('../userProfileService') as {
            getCachedUserProfile: () => { cityName?: string | null } | null;
          };
          city = getCachedUserProfile()?.cityName ?? null;
        } catch {
          city = null;
        }
      }
      const blob = `${opts.userText ?? ''} ${target.hotelName} ${city ?? ''}`;
      let dates =
        payload.checkin && payload.checkout
          ? { checkin: payload.checkin, checkout: payload.checkout }
          : null;
      let adults = payload.adults;
      if (!dates || adults == null) {
        const { parseHotelAdults, parseHotelStayDates } =
          require('../concierge/hotelAvailabilityService') as {
            parseHotelAdults: (t: string) => number;
            parseHotelStayDates: (t: string) => { checkin: string; checkout: string };
          };
        if (!dates) {
          try {
            const { parseHotelStayDatesForPlan } = require('../../module2/planning/planStayDates') as {
              parseHotelStayDatesForPlan: (
                b: string,
                dayKey?: string | null,
              ) => { checkin: string; checkout: string };
            };
            dates = parseHotelStayDatesForPlan(blob);
          } catch {
            dates = parseHotelStayDates(blob);
          }
        }
        if (adults == null) adults = parseHotelAdults(blob);
      }
      adults = adults ?? 2;
      const pid = extractExpediaPropertyId(url);
      const next = pid
        ? buildExpediaHotelPropertyDeepLink(pid, {
            checkin: dates.checkin,
            checkout: dates.checkout,
            adults,
          })
        : isExpediaHotelPropertyUrl(url)
          ? injectExpediaStayDates(url, dates.checkin, dates.checkout, adults)
          : (() => {
              try {
                return finalizeHotelBookAffiliateUrl({
                  hotelName: target.hotelName,
                  city,
                  bookUrl: url,
                  checkin: dates.checkin,
                  checkout: dates.checkout,
                  adults,
                });
              } catch {
                return url;
              }
            })();
      return {
        url: next || url,
        checkin: dates.checkin,
        checkout: dates.checkout,
        adults,
      };
    } catch {
      return { url };
    }
  }

  const adults = payload.adults ?? payload.partySize ?? null;
  const dateIso = payload.dateIso ?? payload.checkin ?? null;
  const timeHm = payload.timeLabel ?? payload.pickupTimeLabel ?? null;

  if (/getyourguide\.com/i.test(url)) {
    try {
      const { withGygPartnerParams } = require('./affiliateService') as {
        withGygPartnerParams: (
          u: string,
          o?: { adults?: number | null; dateIso?: string | null },
        ) => string;
      };
      return { url: withGygPartnerParams(url, { adults, dateIso }), adults: adults ?? undefined };
    } catch {
      return { url };
    }
  }

  if (/tiqets\.com|awin1\.com\/cread\.php/i.test(url) && /tiqets|12428/i.test(url)) {
    try {
      const { getTiqetsUrl } = require('./affiliateService') as {
        getTiqetsUrl: (
          dest?: string | null,
          q?: string | null,
          p?: {
            dateIso?: string | null;
            timeHm?: string | null;
            adults?: number | null;
            preferCheckout?: boolean;
          },
        ) => string;
      };
      return {
        url: getTiqetsUrl(url, null, {
          dateIso,
          timeHm,
          adults,
          preferCheckout: Boolean(dateIso),
        }),
        adults: adults ?? undefined,
      };
    } catch {
      return { url };
    }
  }

  if (/viator\.com|tripadvisor\.com/i.test(url)) {
    try {
      const { getViatorBookingUrl } = require('./affiliateService') as {
        getViatorBookingUrl: (
          u: string,
          o?: { adults?: number | null; dateIso?: string | null },
        ) => string;
      };
      return { url: getViatorBookingUrl(url, { adults, dateIso }), adults: adults ?? undefined };
    } catch {
      return { url };
    }
  }

  if (/discovercars\.com/i.test(url)) {
    try {
      const { getCarRentalUrl } = require('./affiliateService') as {
        getCarRentalUrl: (o?: {
          pickupIata?: string | null;
          pickupLocation?: string | null;
          pickupDate?: string | null;
          dropoffDate?: string | null;
          pickupTime?: string | null;
          dropoffTime?: string | null;
          driverAge?: number | null;
        }) => string;
      };
      const u = new URL(url);
      if (/\/search/i.test(u.pathname) || u.searchParams.get('sq')) {
        if (!u.searchParams.get('a_aid')) u.searchParams.set('a_aid', 'Yorro-Ai');
        return { url: u.toString() };
      }
      return {
        url: getCarRentalUrl({
          pickupIata: u.searchParams.get('pickup_iata') || payload.destination || null,
          pickupLocation: u.searchParams.get('pickup_location') || payload.destName || payload.destination,
          pickupDate: payload.checkin || dateIso || u.searchParams.get('pickup_date'),
          dropoffDate: payload.checkout || u.searchParams.get('dropoff_date'),
          pickupTime: timeHm || u.searchParams.get('pickup_time') || '10:00',
          dropoffTime: u.searchParams.get('dropoff_time') || '10:00',
          driverAge: 24,
        }),
      };
    } catch {
      return { url };
    }
  }

  if (/kiwi\.com|c111\.travelpayouts\.com/i.test(url)) {
    try {
      const { unwrapPartnerLandingUrl } = require('./hollowPartnerUrl') as {
        unwrapPartnerLandingUrl: (u: string) => string;
      };
      const { buildKiwiTravelpayoutsUrl } = require('./travelpayoutsPartners') as {
        buildKiwiTravelpayoutsUrl: (u: string, o?: { subId?: string }) => string;
      };
      let inner = unwrapPartnerLandingUrl(url);
      if (!/kiwi\.com/i.test(inner)) inner = url;
      let u = new URL(inner);
      const from = u.searchParams.get('from');
      const to = u.searchParams.get('to');
      const dep = u.searchParams.get('departure');
      if (from && to && dep) {
        const { buildKiwiResultsPageUrl } = require('./partnerBookingDeepLink') as {
          buildKiwiResultsPageUrl: (o: {
            fromIata: string;
            toIata: string;
            dateKey: string;
            adults?: number;
          }) => string;
        };
        inner = buildKiwiResultsPageUrl({
          fromIata: from,
          toIata: to,
          dateKey: dep,
          adults: adults ?? 1,
        });
        u = new URL(inner);
      }
      if (adults != null) u.searchParams.set('adults', String(adults));
      if (!u.searchParams.get('children')) u.searchParams.set('children', '0');
      if (!u.searchParams.get('infants')) u.searchParams.set('infants', '0');
      return {
        url: buildKiwiTravelpayoutsUrl(u.toString(), { subId: 'prefill' }),
        adults: adults ?? undefined,
      };
    } catch {
      return { url };
    }
  }

  return { url };
}

/** Tap: Hotel-Suche → Live-Property-Deep-Link (Zimmerwahl). */
export async function upgradeHotelUrlOnTap(opts: {
  url: string;
  label?: string;
  destName?: string | null;
  destination?: string | null;
  checkin?: string;
  checkout?: string;
  adults?: number;
  userText?: string | null;
}): Promise<string> {
  const url = String(opts.url ?? '').trim();
  if (!looksLikeHotelBookOpenUrl(opts.label ?? '', url)) return url;
  try {
    const { resolveHotelPropertyAffiliateUrl } = await import('./hotelPropertyDeepLink');
    const { parseHotelStayDatesForPlan } = await import(
      '../../module2/planning/planStayDates'
    );
    const { parseHotelAdults } = await import('../concierge/hotelAvailabilityService');
    const { getCachedUserProfile } = await import('../userProfileService');
    const { resolveHotelBookTarget } = await import('./hotelPropertyDeepLink');
    const target = resolveHotelBookTarget({
      hotelName: opts.destName,
      destination: opts.destination,
      city: opts.destination,
    });
    const hotelName = target.hotelName;
    const city =
      target.city || getCachedUserProfile()?.cityName || null;
    const blob = `${opts.userText ?? ''} ${hotelName} ${city ?? ''}`;
    const dates =
      opts.checkin && opts.checkout
        ? { checkin: opts.checkin, checkout: opts.checkout }
        : parseHotelStayDatesForPlan(blob);
    const adults = opts.adults ?? parseHotelAdults(blob);
    return await resolveHotelPropertyAffiliateUrl({
      hotelName,
      city,
      bookUrl: url,
      checkin: dates.checkin,
      checkout: dates.checkout,
      adults,
    });
  } catch {
    return url;
  }
}
