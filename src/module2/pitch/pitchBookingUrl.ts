/**
 * Hotel-Buchungs-URL für Pitch-Karten (Expedia/Stay22).
 */

export function buildPitchHotelBookingUrl(
  hotelName: string,
  contextBlob: string,
  cityHint?: string | null,
): string | null {
  try {
    const {
      getExpediaAccommodationUrl,
      getStay22AccommodationUrl,
      getExpediaCamref,
    } = require('../../services/affiliate/affiliateService') as {
      getExpediaAccommodationUrl: (
        d: string,
        o?: { checkin?: string; checkout?: string; adults?: number },
      ) => string;
      getStay22AccommodationUrl: (
        d: string,
        o?: { checkin?: string; checkout?: string; adults?: number },
      ) => string;
      getExpediaCamref: () => string;
    };
    const {
      parseHotelStayDates,
      parseHotelAdults,
    } = require('../../services/concierge/hotelAvailabilityService') as {
      parseHotelStayDates: (t: string) => {
        checkin: string;
        checkout: string;
      };
      parseHotelAdults: (t: string) => number;
    };
    const blob = `${hotelName} ${contextBlob} ${cityHint ?? ''}`;
    const { checkin, checkout } = parseHotelStayDates(blob);
    const adults = parseHotelAdults(blob);
    const dest =
      hotelName.split(/[|,·•]/)[0]!.trim() ||
      (cityHint || '').trim() ||
      hotelName;
    const url = getExpediaCamref()
      ? getExpediaAccommodationUrl(dest, { checkin, checkout, adults })
      : getStay22AccommodationUrl(dest, { checkin, checkout, adults });
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
