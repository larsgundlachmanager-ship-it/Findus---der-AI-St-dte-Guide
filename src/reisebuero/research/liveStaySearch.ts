/**
 * Multi-Provider Stay-Suche für die App (direkt im Enrich):
 * Hotellook → Stay22 → Grounding (Hotel/Fewo/Villa/Resort) →
 * Check24/AIDU-Katalog → Expedia/Stay22-Affiliate-Links am Preis.
 */

import type { HotelLiveStay } from '../../services/concierge/hotelAvailabilityService';
import { searchStay22HotelsInCity } from '../../services/concierge/hotelAvailabilityService';
import {
  stayLodgingSearchOrder,
  type StayLodgingType,
} from './stayLodgingSearchOrder';
import { cityStayQueryAliases } from './cityStayAliases';
import { searchHotellookStaysInCity } from './hotellookStaySearch';
import { searchGroundedStaysInCity, attachStayAffiliateUrls } from './groundedStayFallback';
import { lodgingLanesForSearch, type StayLodgingLane } from './lodgingLanes';

export type LiveStaySearchOpts = {
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
  preferredLodging: StayLodgingType;
  lodgingFallback?: StayLodgingType | null;
  researchPath?: string;
  amenityHint?: string | null;
  amenityBlob?: string | null;
  preferAllInclusive?: boolean;
  maxStayTotalEur?: number | null;
  lat?: number | null;
  lng?: number | null;
  pageSize?: number;
  allowGrounded?: boolean;
  originIata?: string | null;
};

export type LiveStaySearchResult = {
  stays: HotelLiveStay[];
  source: 'hotellook' | 'stay22' | 'grounded' | 'partner' | 'none';
  detail?: string;
};

function mergeUnique(batches: HotelLiveStay[][]): HotelLiveStay[] {
  const seen = new Set<string>();
  const out: HotelLiveStay[] = [];
  for (const batch of batches) {
    for (const s of batch) {
      const key = `${(s.name || '').toLowerCase()}|${Math.round(s.priceTotal ?? 0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  out.sort((a, b) => (a.priceTotal ?? 9e9) - (b.priceTotal ?? 9e9));
  return out;
}

async function ensureAffiliateLinks(
  stays: HotelLiveStay[],
  opts: LiveStaySearchOpts,
): Promise<HotelLiveStay[]> {
  const out: HotelLiveStay[] = [];
  for (const s of stays) {
    if (s.bookUrl && /expedia|check24|stay22|awin|hotellook/i.test(s.bookUrl)) {
      out.push(s);
      continue;
    }
    const preferPackage =
      opts.preferAllInclusive ||
      /resort|all.?inclusive|pauschal|check24/i.test(
        `${s.name} ${(s.amenities ?? []).join(' ')} ${s.supplier || ''}`,
      );
    const { bookUrl, supplier } = await attachStayAffiliateUrls({
      city: opts.city,
      hotelName: s.name,
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults,
      preferPackage,
      originIata: opts.originIata,
    });
    out.push({ ...s, bookUrl, supplier: s.supplier || supplier });
  }
  return out;
}

/**
 * Hotel · Fewo/Airbnb · Villa · Resort über alle Provider + Partner.
 */
export async function searchLiveStaysMulti(
  opts: LiveStaySearchOpts,
): Promise<LiveStaySearchResult> {
  const aliases = cityStayQueryAliases(opts.city);
  const lodgingTypes = stayLodgingSearchOrder({
    preferred: opts.preferredLodging,
    fallback: opts.lodgingFallback ?? null,
    researchPath: opts.researchPath,
    preferAllInclusive: opts.preferAllInclusive,
  });
  const lanes = lodgingLanesForSearch({
    preferred: opts.preferredLodging,
    preferAllInclusive: opts.preferAllInclusive,
    amenityBlob: `${opts.amenityBlob || ''} ${opts.amenityHint || ''}`,
    maxLanes: 3,
  });

  let lastErr = '';

  // 1) Hotellook zuerst (Travelpayouts-Token — günstig, strukturiert)
  try {
    const hl = await searchHotellookStaysInCity({
      city: opts.city,
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults,
      lat: opts.lat,
      lng: opts.lng,
      limit: 16,
    });
    if (hl.stays.length) {
      const stays = await ensureAffiliateLinks(hl.stays, opts);
      return { stays, source: 'hotellook', detail: 'Travelpayouts/Hotellook' };
    }
    if (hl.error) lastErr = hl.error;
  } catch (e) {
    lastErr = String(e).slice(0, 60);
  }

  // 2) Stay22 API — Hotel + Fewo (wenn Key wieder da)
  const stay22Batches: HotelLiveStay[][] = [];
  for (const city of aliases.slice(0, 2)) {
    const batches = await Promise.all(
      lodgingTypes.map((lt) =>
        searchStay22HotelsInCity({
          city,
          checkin: opts.checkin,
          checkout: opts.checkout,
          adults: opts.adults,
          lodgingType: lt,
          lat: opts.lat,
          lng: opts.lng,
          pageSize: opts.pageSize ?? 24,
          amenityHint: opts.amenityHint,
        }),
      ),
    );
    for (const b of batches) {
      if (b.error) lastErr = b.error;
      if (b.stays.length) stay22Batches.push(b.stays);
    }
    if (stay22Batches.length) break;
  }
  const stay22 = mergeUnique(stay22Batches);
  if (stay22.length) {
    const stays = await ensureAffiliateLinks(stay22, opts);
    return { stays, source: 'stay22', detail: lastErr || undefined };
  }

  if (opts.allowGrounded === false) {
    return { stays: [], source: 'none', detail: lastErr || 'no_stay_provider' };
  }

  // 3) Grounding Multi-Lane (Hotel / Fewo-Airbnb / Villa / Resort)
  const groundedBatches: HotelLiveStay[][] = [];
  const cityForGnd = aliases[0] || opts.city;
  for (const lane of lanes) {
    const gnd = await searchGroundedStaysInCity({
      city: cityForGnd,
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults,
      lodgingLane: lane,
      catalog: 'ota',
      preferAllInclusive: opts.preferAllInclusive || lane === 'resort',
      preferApartment: lane === 'apartment' || lane === 'villa',
      amenityHint: opts.amenityHint,
      maxStayTotalEur: opts.maxStayTotalEur,
      lat: opts.lat,
      lng: opts.lng,
      originIata: opts.originIata,
    });
    if (gnd.stays.length) groundedBatches.push(gnd.stays);
    else if (gnd.error) lastErr = gnd.error;
    if (mergeUnique(groundedBatches).length >= 4) break;
  }
  // Zweiter Alias wenn noch dünn
  if (!groundedBatches.length && aliases[1]) {
    for (const lane of lanes.slice(0, 2)) {
      const gnd = await searchGroundedStaysInCity({
        city: aliases[1]!,
        checkin: opts.checkin,
        checkout: opts.checkout,
        adults: opts.adults,
        lodgingLane: lane,
        catalog: 'ota',
        amenityHint: opts.amenityHint,
        maxStayTotalEur: opts.maxStayTotalEur,
        lat: opts.lat,
        lng: opts.lng,
        originIata: opts.originIata,
      });
      if (gnd.stays.length) groundedBatches.push(gnd.stays);
    }
  }
  const grounded = mergeUnique(groundedBatches);
  if (grounded.length) {
    return {
      stays: grounded,
      source: 'grounded',
      detail: `lanes ${lanes.join('+')} · alias ${cityForGnd}`,
    };
  }

  // 4) Partner-Katalog: Check24 / ab-in-den-urlaub — Preis web-belegt, Affiliate-Link
  const partner = await searchGroundedStaysInCity({
    city: cityForGnd,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults,
    lodgingLane: (opts.preferAllInclusive ? 'resort' : 'hotel') as StayLodgingLane,
    catalog: 'check24',
    preferAllInclusive: opts.preferAllInclusive,
    amenityHint: opts.amenityHint,
    maxStayTotalEur: opts.maxStayTotalEur,
    lat: opts.lat,
    lng: opts.lng,
    originIata: opts.originIata,
  });
  if (partner.stays.length) {
    return {
      stays: partner.stays,
      source: 'partner',
      detail: 'CHECK24/AIDU grounded · Affiliate',
    };
  }

  // 5) Letzte Kontrolle: Stay22-Allez + Expedia Suche mit günstigstem Grounding-Retry mixed
  const mixed = await searchGroundedStaysInCity({
    city: cityForGnd,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults,
    lodgingLane: 'hotel',
    catalog: 'mixed',
    amenityHint: opts.amenityHint,
    maxStayTotalEur: opts.maxStayTotalEur,
    lat: opts.lat,
    lng: opts.lng,
    originIata: opts.originIata,
  });
  if (mixed.stays.length) {
    const stays = await ensureAffiliateLinks(mixed.stays, opts);
    return { stays, source: 'partner', detail: 'Expedia/Stay22 Kontrolle · mixed' };
  }

  return {
    stays: [],
    source: 'none',
    detail: lastErr || 'all_providers_empty',
  };
}
