/**
 * 1-Nacht-Hotel in einer Stadt (Hotellook → Expedia-Fallback).
 * Gemeinsam für Hub-Vornacht und Night-Train/Tour-Bookends.
 */

import type { StayChoice } from '../types';

export type CityNightPrefer = 'airport' | 'station' | 'any';

function rankScore(name: string, prefer: CityNightPrefer): number {
  const n = name || '';
  if (prefer === 'airport') {
    return /airport|flughafen|aeropuerto|aeroport|terminal|aeroporto/i.test(n) ? 0 : 1;
  }
  if (prefer === 'station') {
    return /bahnhof|hauptbahnhof|hbf|station|central|gare|stazione/i.test(n) ? 0 : 1;
  }
  return 1;
}

async function cityHotelBookUrl(opts: {
  city: string;
  hotelName: string;
  checkin: string;
  checkout: string;
  adults: number;
}): Promise<string> {
  const q = `${opts.hotelName}, ${opts.city}`.slice(0, 120);
  try {
    const { getExpediaAccommodationUrl } = await import('../../services/affiliate/affiliateService');
    const raw = getExpediaAccommodationUrl(q, {
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults,
    });
    const { finalizeHotelBookAffiliateUrl } = await import(
      '../../services/affiliate/hotelPropertyDeepLink'
    );
    return finalizeHotelBookAffiliateUrl({
      hotelName: opts.hotelName,
      city: opts.city,
      bookUrl: raw,
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults,
      expediaPropertyId: null,
    });
  } catch {
    return `https://www.google.com/search?q=${encodeURIComponent(
      `Hotel ${opts.city} ${opts.checkin}`,
    )}`;
  }
}

export function cityNightStayChoice(opts: {
  id: string;
  name: string;
  city: string;
  priceEur: number | null;
  bookUrl: string | null;
  photoUrl?: string | null;
  lat?: number;
  lng?: number;
  why: string;
}): StayChoice {
  return {
    id: opts.id,
    name: opts.name,
    priceEur: opts.priceEur,
    bookUrl: opts.bookUrl,
    photoUrl: opts.photoUrl ?? null,
    why: opts.why,
    lat: opts.lat,
    lng: opts.lng,
  };
}

export async function lookupCityNightStay(opts: {
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
  prefer?: CityNightPrefer;
  idPrefix?: string;
  why?: string;
  fallbackName?: string;
}): Promise<StayChoice | null> {
  const city = (opts.city || '').trim();
  const checkin = (opts.checkin || '').slice(0, 10);
  const checkout = (opts.checkout || '').slice(0, 10);
  if (!city || !/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
    return null;
  }
  const adults = Math.max(1, opts.adults || 1);
  const prefer = opts.prefer ?? 'any';
  const prefix = opts.idPrefix || 'city-night';
  const why =
    opts.why || `1 Nacht ${checkin} → ${checkout} · ${city}`;

  try {
    const { searchHotellookStaysInCity } = await import('./hotellookStaySearch');
    const queries =
      prefer === 'airport'
        ? [`${city} Airport`, `${city} Flughafen`, city]
        : prefer === 'station'
          ? [`${city} Hauptbahnhof`, `${city} Bahnhof`, city]
          : [city];
    for (const q of queries) {
      const { stays } = await searchHotellookStaysInCity({
        city: q,
        checkin,
        checkout,
        adults,
        limit: 8,
      });
      const ranked = stays.slice().sort((a, b) => {
        const sa = rankScore(a.name, prefer);
        const sb = rankScore(b.name, prefer);
        if (sa !== sb) return sa - sb;
        return (a.priceTotal ?? 9e6) - (b.priceTotal ?? 9e6);
      });
      const hit = ranked[0];
      if (hit?.name) {
        return cityNightStayChoice({
          id: `${prefix}-${hit.id}`,
          name: hit.name,
          city,
          priceEur: hit.priceTotal ?? null,
          bookUrl: hit.bookUrl ?? null,
          photoUrl: hit.photoUrl ?? null,
          lat: hit.lat,
          lng: hit.lng,
          why,
        });
      }
    }
  } catch {
    /* fallback */
  }

  const fallbackName =
    opts.fallbackName ||
    (prefer === 'airport'
      ? `${city} Flughafen Hotel`
      : prefer === 'station'
        ? `${city} Bahnhof Hotel`
        : `${city} Hotel`);
  const bookUrl = await cityHotelBookUrl({
    city,
    hotelName: fallbackName,
    checkin,
    checkout,
    adults,
  });
  return cityNightStayChoice({
    id: `${prefix}-${city.slice(0, 24)}`,
    name: fallbackName,
    city,
    priceEur: null,
    bookUrl,
    why,
  });
}

/** Sync-Deeplink ohne Live-Preis — zweites Hotel trotzdem klickbar. */
export function cityNightSearchUrl(opts: {
  city: string;
  checkin?: string | null;
  checkout?: string | null;
  adults?: number;
  hint?: string;
}): string {
  const city = (opts.city || '').trim();
  try {
    const { getExpediaAccommodationUrl } = require('../../services/affiliate/affiliateService') as {
      getExpediaAccommodationUrl: (
        dest: string,
        o?: { checkin?: string; checkout?: string; adults?: number },
      ) => string;
    };
    return getExpediaAccommodationUrl(`${opts.hint || 'Hotel'} ${city}`.slice(0, 120), {
      checkin: opts.checkin || undefined,
      checkout: opts.checkout || undefined,
      adults: opts.adults,
    });
  } catch {
    return `https://www.google.com/search?q=${encodeURIComponent(
      `Hotel ${city} ${opts.checkin || ''}`.trim(),
    )}`;
  }
}
