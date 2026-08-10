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
  const city =
    getCachedUserProfile()?.cityName?.trim() ||
    offer.name.replace(/^hotel\s+/i, '').trim() ||
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

    actions.push({
      type: 'OPEN_URL',
      label: `🏨 Zimmer ab ${Math.round(m.priceTotal ?? 0)} ${m.currency}`,
      payload: { url: m.bookUrl, targetPoiId: offer.poiId },
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

  const alts = availability.alternatives;
  if (alts.length) {
    speechExtra = `${soldHint} Stattdessen frei: ${alts
      .slice(0, 2)
      .map(
        (a) =>
          `${a.name} ab ${Math.round(a.priceTotal ?? 0)} ${a.currency}`,
      )
      .join('; ')}.`;
    for (const a of alts.slice(0, 2)) {
      actions.push({
        type: 'OPEN_URL',
        label: shortenActionLabel(
          `🏨 ${a.name.split(/[|,]/)[0]!.trim()} · ${Math.round(a.priceTotal ?? 0)}€`,
        ),
        payload: { url: a.bookUrl },
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
