/**
 * Stay22-Livehotels für Pitch — Hard-Amenities vor Ranking (Pool/Sauna/Blick…).
 */

import { haversineMeters } from '../../db/database';
import type { PitchCandidate, PitchRequest } from './types';
import { buildPitchHotelBookingUrl } from './pitchBookingUrl';

function mapsUrlFor(name: string, _lat: number, _lng: number): string {
  return '';
}

export async function stay22HotelCandidates(
  req: PitchRequest,
): Promise<PitchCandidate[]> {
  const blob = `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`;
  const {
    parseHotelStayDates,
    parseHotelAdults,
    searchStay22HotelsInCity,
  } = await import('../../services/concierge/hotelAvailabilityService');
  const {
    nightsBetween,
    parseHotelAmenityNeeds,
    filterHotelsByAmenityNeeds,
    enrichHotelStaysForAmenityNeeds,
    pricePerNight,
  } = await import('../../services/concierge/hotelHardMatch');

  const { checkin, checkout } = parseHotelStayDates(blob);
  const nights = nightsBetween(checkin, checkout);
  const adults = parseHotelAdults(blob);
  const cityRaw = (req.cityHint || '').trim();
  const namedCity =
    Boolean(cityRaw) &&
    !/\bhier\b/i.test(cityRaw) &&
    !/nähe|naehe/i.test(cityRaw) &&
    !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(cityRaw);
  let city = namedCity ? cityRaw : '';
  // GPS-Umland ohne Stadthinweis: Stay22 braucht oft eine Stadtadresse
  if (!city && Number.isFinite(req.anchor.lat) && Number.isFinite(req.anchor.lng)) {
    try {
      const { nearestCommercialAirport } = require('../../services/flights/airportIata') as {
        nearestCommercialAirport: (
          lat: number,
          lng: number,
        ) => { city?: string } | null;
      };
      const near = nearestCommercialAirport(req.anchor.lat, req.anchor.lng);
      if (near?.city) city = near.city;
    } catch {
      /* soft — lat/lng alone */
    }
  }

  const amenityNeeds = parseHotelAmenityNeeds(blob);
  // Wish-Amenities aus PitchRequest nachziehen (falls Parser Text anders schnitt)
  for (const w of req.wishes) {
    if (w.hardness !== 'must') continue;
    if (w.kind !== 'amenity' && w.kind !== 'vibe') continue;
    if (/spa_or_sauna/i.test(w.text)) {
      if (!amenityNeeds.some((n) => n.id === 'spa_or_sauna')) {
        amenityNeeds.push({
          id: 'spa_or_sauna',
          label: 'Spa/Sauna',
          trigger: /\b(spa|sauna|wellness)\b/i,
          evidence:
            /\b(spa|wellness|sauna|dampfbad|steam|jacuzzi|whirlpool|thermal)\b/i,
        });
      }
      for (let i = amenityNeeds.length - 1; i >= 0; i--) {
        if (amenityNeeds[i]!.id === 'spa' || amenityNeeds[i]!.id === 'sauna') {
          amenityNeeds.splice(i, 1);
        }
      }
      continue;
    }
    if (amenityNeeds.some((n) => n.trigger.test(w.text))) continue;
    const extra = parseHotelAmenityNeeds(w.text);
    for (const n of extra) {
      if (!amenityNeeds.some((x) => x.id === n.id)) amenityNeeds.push(n);
    }
  }
  const amenityHint = amenityNeeds.map((n) => n.label).join(' ').toLowerCase();

  let stays: Array<{
    id: string;
    name: string;
    priceTotal: number | null;
    bookUrl: string;
    lat?: number;
    lng?: number;
    rating?: number | null;
    address?: string;
    amenities?: string[];
  }> = [];
  try {
    const live = await searchStay22HotelsInCity({
      city,
      checkin,
      checkout,
      adults,
      amenityHint: amenityHint || null,
      pageSize: amenityNeeds.length ? 40 : 24,
      lat: req.anchor.lat,
      lng: req.anchor.lng,
    });
    stays = live.stays.filter((s) => s.priceTotal != null && s.priceTotal > 0);
  } catch {
    return [];
  }
  if (!stays.length) return [];

  if (amenityNeeds.length) {
    stays = await enrichHotelStaysForAmenityNeeds(
      stays as never,
      amenityNeeds,
      city || cityRaw || '',
      req.signal,
    );
  }

  const filtered = filterHotelsByAmenityNeeds(stays as never, amenityNeeds);
  // Hard-Reject ohne Voll-Match — aber benannte Optionen statt generischer Karte
  let inventory =
    amenityNeeds.length > 0 ? filtered.matched : (stays as never[]);
  if (!inventory.length && amenityNeeds.length > 0 && stays.length > 0) {
    inventory = [...stays].sort(
      (a, b) => (a.priceTotal ?? 1e9) - (b.priceTotal ?? 1e9),
    ) as never[];
  }
  if (!inventory.length) return [];

  // Bis zu 8 für Ranking (Preis → Bewertung → Distanz), Pitch nimmt Top 2
  const ranked = [...inventory].sort((a, b) => {
    const pa = a.priceTotal ?? 1e9;
    const pb = b.priceTotal ?? 1e9;
    if (Math.abs(pa - pb) > 8) return pa - pb;
    const ra = a.rating ?? 0;
    const rb = b.rating ?? 0;
    if (Math.abs(rb - ra) > 0.05) return rb - ra;
    return 0;
  });

  return ranked.slice(0, 8).map((s) => {
    const lat =
      typeof s.lat === 'number' && Number.isFinite(s.lat)
        ? s.lat
        : req.anchor.lat;
    const lng =
      typeof s.lng === 'number' && Number.isFinite(s.lng)
        ? s.lng
        : req.anchor.lng;
    const bookingUrl =
      (s.bookUrl && /^https?:\/\//i.test(s.bookUrl) ? s.bookUrl : null) ||
      buildPitchHotelBookingUrl(s.name, blob, namedCity ? cityRaw : null);
    const perNight =
      s.priceTotal != null ? pricePerNight(s as never, nights) : null;
    const amenityTags = (s.amenities ?? [])
      .map((a) => String(a).trim())
      .filter(Boolean)
      .slice(0, 8);
    const hardEvidence = amenityNeeds
      .filter((n) => n.evidence.test(amenityTags.join(' ') || s.name))
      .map((n) => n.label);
    return {
      name: s.name.split(/[|,]/)[0]!.trim() || s.name,
      lat,
      lng,
      placeId: null,
      rating: typeof s.rating === 'number' ? s.rating : null,
      address: s.address ?? null,
      mapsUrl: mapsUrlFor(s.name, lat, lng),
      openNow: true,
      softTags: ['hotel', ...amenityTags.map((a) => a.toLowerCase())],
      hardEvidence: hardEvidence.length ? hardEvidence : amenityTags.slice(0, 4),
      source: 'stay22' as const,
      distFromAnchorM: haversineMeters(
        req.anchor.lat,
        req.anchor.lng,
        lat,
        lng,
      ),
      bookingUrl,
      priceTotalEur: s.priceTotal,
      pricePerNightEur: perNight,
      nights,
      checkin,
      checkout,
    };
  });
}
