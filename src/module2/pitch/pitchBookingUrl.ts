/**
 * Hotel-Buchungs-URL für Pitch-Karten (Expedia Property / Stay22).
 */

export function buildPitchHotelBookingUrl(
  hotelName: string,
  contextBlob: string,
  cityHint?: string | null,
): string | null {
  try {
    const {
      finalizeHotelBookAffiliateUrl,
    } = require('../../services/affiliate/hotelPropertyDeepLink') as {
      finalizeHotelBookAffiliateUrl: (o: {
        hotelName: string;
        city?: string | null;
        bookUrl?: string | null;
        checkin: string;
        checkout: string;
        adults?: number;
      }) => string;
    };
    const { parseHotelAdults } = require('../../services/concierge/hotelAvailabilityService') as {
      parseHotelAdults: (t: string) => number;
    };
    const { parseHotelStayDatesForPlan } = require('../planning/planStayDates') as {
      parseHotelStayDatesForPlan: (
        blob: string,
        dayKey?: string | null,
      ) => { checkin: string; checkout: string };
    };
    const blob = `${hotelName} ${contextBlob} ${cityHint ?? ''}`;
    const { checkin, checkout } = parseHotelStayDatesForPlan(blob);
    const adults = parseHotelAdults(blob);
    const name =
      hotelName.split(/[|,·•]/)[0]!.trim() || hotelName;
    const url = finalizeHotelBookAffiliateUrl({
      hotelName: name,
      city: cityHint,
      checkin,
      checkout,
      adults,
    });
    return url && /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

export function isHotelBookingUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /expedia|stay22|booking\.com|hotels\.com|vrbo|hoteis\.com|affiliate|partnerize|camref/i.test(
    url,
  );
}
