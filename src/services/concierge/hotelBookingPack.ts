/**
 * Hotel recommendation gate: live Stay22 availability ONLY.
 * Never attach „Zimmer buchen“ unless a live price exists for the date window.
 */

import type { QuickAction } from '../../types/concierge';
import type { PendingNavOffer } from '../navigation/navigationTypes';
import { shortenActionLabel } from './actionLabelShorten';
import { getCachedUserProfile } from '../userProfileService';
import {
  lookupHotelAvailability,
  parseHotelStayDates,
  type HotelAvailabilityResult,
} from './hotelAvailabilityService';
import {
  finalizeHotelBookAffiliateUrl,
  hotelBookOpenUrlPayload,
  resolveHotelBookTarget,
} from '../affiliate/hotelPropertyDeepLink';
import { pickAffiliateOffer } from '../affiliate/affiliatePickOffer';
import { hotelIdentity, userWantsCheapest } from '../affiliate/quoteIdentity';

export type HotelBookingPack = {
  speechExtra: string;
  actions: QuickAction[];
  /** true = live price found; false = sold out / unpriced; null = API error */
  available: boolean | null;
  availability: HotelAvailabilityResult | null;
};

export async function buildHotelBookingPack(
  offer: PendingNavOffer,
  opts?: { userText?: string; suggestWhy?: boolean },
): Promise<HotelBookingPack> {
  const namedCity = (() => {
    try {
      const { extractCityFromText } = require('../../module2/context/shortTermContext') as {
        extractCityFromText: (t: string) => string | null;
      };
      return extractCityFromText(opts?.userText || '') || null;
    } catch {
      return null;
    }
  })();
  const target = resolveHotelBookTarget({
    hotelName: offer.name,
    destination: namedCity,
  });
  const city =
    target.city ||
    getCachedUserProfile()?.cityName?.trim() ||
    'Germany';
  const { checkin, checkout } = parseHotelStayDates(opts?.userText);

  let availability: HotelAvailabilityResult;
  try {
    availability = await lookupHotelAvailability({
      hotelName: offer.name,
      city,
      checkin,
      checkout,
      adults: 2,
      lat: offer.lat,
      lng: offer.lng,
    });
  } catch (err) {
    return {
      speechExtra:
        'Die Live-Zimmerprüfung ist gerade nicht erreichbar — ich zeige dir deshalb keine Buchungs-Buttons für dieses Hotel.',
      actions: [],
      available: null,
      availability: null,
    };
  }

  if (availability.source === 'stay22_error') {
    return {
      speechExtra: `Live-Verfügbarkeit gerade nicht prüfbar (${availability.error ?? 'API'}). Buchungs-Button lasse ich weg, bis die Prüfung wieder geht.`,
      actions: [],
      available: null,
      availability,
    };
  }

  const cheapestAsk = userWantsCheapest(opts?.userText);
  const adults = 2;

  const bookStayUrl = (stay: {
    name: string;
    bookUrl: string;
    priceTotal: number | null;
    expediaPropertyId?: string | null;
  }) => {
    const identity = hotelIdentity({
      propertyId: stay.expediaPropertyId,
      name: stay.name,
      city,
      checkin,
      checkout,
      adults,
    });
    const stay22 = {
      id: 'stay22',
      label: stay.name,
      url: stay.bookUrl,
      commissionScore: 68,
      deepLinkLevel: 'deep' as const,
      partnerPriceEur: stay.priceTotal,
      identity,
    };
    const picked = pickAffiliateOffer([stay22], {
      userWantsCheapest: cheapestAsk,
    });
    return finalizeHotelBookAffiliateUrl({
      hotelName: stay.name || offer.name,
      city,
      bookUrl: picked?.url || stay.bookUrl,
      checkin,
      checkout,
      adults,
      expediaPropertyId: stay.expediaPropertyId,
    });
  };

  const actions: QuickAction[] = [];
  let speechExtra = '';

  if (availability.matched) {
    const m = availability.matched;
    speechExtra = [
      opts?.suggestWhy !== false
        ? `${m.name} hat für ${checkin} → ${checkout} live noch Zimmer`
        : '',
      m.priceTotal != null
        ? `ab etwa ${Math.round(m.priceTotal)} ${m.currency} für den Aufenthalt`
        : '',
      m.rating != null ? `Bewertung ${m.rating.toFixed(1)}` : '',
      '— Button öffnet die Buchung mit diesen Daten.',
    ]
      .filter(Boolean)
      .join(' ');

    const bookUrl = bookStayUrl(m);
    actions.push({
      type: 'OPEN_URL',
      label: `🏨 Zimmer ab ${Math.round(m.priceTotal ?? 0)} ${m.currency}`,
      payload: {
        ...hotelBookOpenUrlPayload({
          url: bookUrl,
          hotelName: m.name || offer.name,
          city,
          checkin,
          checkout,
          adults,
        }),
        targetPoiId: offer.poiId,
      },
    });

    return {
      speechExtra,
      actions,
      available: true,
      availability,
    };
  }

  // Not available as primary
  const soldHint = availability.matchedUnpricedName
    ? `${availability.matchedUnpricedName} ist für ${checkin} → ${checkout} online nicht buchbar (kein Live-Preis / vermutlich ausgebucht).`
    : `${offer.name} kann ich für ${checkin} → ${checkout} nicht als frei bestätigen.`;

  const alts = cheapestAsk
    ? [...availability.alternatives].sort(
        (a, b) => (a.priceTotal ?? 1e9) - (b.priceTotal ?? 1e9),
      )
    : availability.alternatives;
  const showAlts = cheapestAsk ? alts.slice(0, 1) : alts.slice(0, 2);
  if (alts.length) {
    speechExtra = `${soldHint} Stattdessen frei: ${showAlts
      .map(
        (a) =>
          `${a.name} ab ${Math.round(a.priceTotal ?? 0)} ${a.currency}`,
      )
      .join('; ')}.`;
    for (const a of showAlts) {
      const bookUrl = bookStayUrl(a);
      actions.push({
        type: 'OPEN_URL',
        label: shortenActionLabel(
          `🏨 ${a.name.split(/[|,]/)[0]!.trim()} · ${Math.round(a.priceTotal ?? 0)}€`,
        ),
        payload: hotelBookOpenUrlPayload({
          url: bookUrl,
          hotelName: a.name,
          city,
          checkin,
          checkout,
          adults,
        }),
      });
    }
  } else {
    speechExtra = `${soldHint} In der Nähe finde ich gerade auch keine klar bepreisbaren Alternativen — soll ich morgen oder andere Daten prüfen?`;
  }

  return {
    speechExtra,
    actions,
    available: false,
    availability,
  };
}
