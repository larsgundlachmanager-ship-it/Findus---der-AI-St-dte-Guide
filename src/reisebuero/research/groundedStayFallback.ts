/**
 * Stay-Fallback / Multi-Lane: Grounded Web-Preise + Affiliate-Links
 * (Expedia primär, Stay22 Allez Backup, Check24 bei Pauschal/Resort).
 * Keine erfundenen Preise. Max. 2 parallele Calls (Quota).
 */

import type { HotelLiveStay } from '../../services/concierge/hotelAvailabilityService';
import { groundedJsonLite, hasGroundedJsonKey } from './groundedJsonLite';
import {
  lodgingLanePromptHint,
  type StayLodgingLane,
} from './lodgingLanes';

export type GroundedStayQuery = {
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
  preferAllInclusive?: boolean;
  preferApartment?: boolean;
  lodgingLane?: StayLodgingLane;
  /** check24 = Pauschal/Resort-Portale; ota = Hotel/Airbnb/Expedia */
  catalog?: 'ota' | 'check24' | 'mixed';
  amenityHint?: string | null;
  maxStayTotalEur?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** Flughafen für Check24-Prefill */
  originIata?: string | null;
};

type RawStay = {
  name?: string;
  priceTotalEur?: number;
  amenities?: string[];
  rating?: number;
  stars?: number;
  sourceHint?: string;
  kind?: string;
};

let groundedInflight = 0;
const groundedWaiters: Array<() => void> = [];

async function withGroundedSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (groundedInflight >= 2) {
    await new Promise<void>((resolve) => groundedWaiters.push(resolve));
  }
  groundedInflight += 1;
  try {
    return await fn();
  } finally {
    groundedInflight -= 1;
    const next = groundedWaiters.shift();
    if (next) next();
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function parseJsonArray(raw: string): RawStay[] {
  const t = (raw || '').trim();
  if (!t) return [];
  try {
    const p = JSON.parse(t) as unknown;
    if (Array.isArray(p)) return p as RawStay[];
    if (p && typeof p === 'object' && Array.isArray((p as { stays?: unknown }).stays)) {
      return (p as { stays: RawStay[] }).stays;
    }
  } catch {
    const m = t.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const p = JSON.parse(m[0]) as unknown;
        if (Array.isArray(p)) return p as RawStay[];
      } catch {
        /* soft */
      }
    }
  }
  return [];
}

/** Expedia + Stay22 Allez + optional Check24 — Preis kommt von Grounding/Hotellook. */
export async function attachStayAffiliateUrls(opts: {
  city: string;
  hotelName: string;
  checkin: string;
  checkout: string;
  adults: number;
  preferPackage?: boolean;
  originIata?: string | null;
}): Promise<{ bookUrl: string; supplier: string }> {
  const dest = `${opts.hotelName}, ${opts.city}`.slice(0, 120);
  try {
    const aff = await import('../../services/affiliate/affiliateService');
    if (opts.preferPackage) {
      const pkg = aff.getCheck24Url(undefined, 'package', {
        departureDate: opts.checkin,
        returnDate: opts.checkout,
        airport: opts.originIata,
        adults: opts.adults,
      });
      if (pkg) return { bookUrl: pkg, supplier: 'check24_awin' };
    }
    const expedia = aff.getExpediaAccommodationUrl(dest, {
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults,
    });
    if (expedia) return { bookUrl: expedia, supplier: 'expedia' };
    const stay22 = aff.getStay22AccommodationUrl(opts.city, {
      checkin: opts.checkin,
      checkout: opts.checkout,
      adults: opts.adults,
    });
    if (stay22) return { bookUrl: stay22, supplier: 'stay22_allez' };
  } catch {
    /* soft */
  }
  const q = new URLSearchParams({
    destination: `${opts.hotelName} ${opts.city}`.slice(0, 100),
    chkin: opts.checkin,
    chkout: opts.checkout,
    locale: 'de_DE',
    currency: 'EUR',
    rm1: `a${Math.max(1, opts.adults)}`,
  });
  return {
    bookUrl: `https://www.expedia.de/Hotel-Search?${q.toString()}`,
    supplier: 'expedia_raw',
  };
}

/**
 * 2–4 belegte Stays für Stadt + Fenster + Lane.
 */
export async function searchGroundedStaysInCity(
  opts: GroundedStayQuery,
): Promise<{ stays: HotelLiveStay[]; error?: string }> {
  if (!hasGroundedJsonKey()) {
    return { stays: [], error: 'no_gemini_key' };
  }
  const city = (opts.city || '').trim();
  if (!city || !opts.checkin || !opts.checkout) {
    return { stays: [], error: 'bad_query' };
  }

  const lane: StayLodgingLane =
    opts.lodgingLane ||
    (opts.preferApartment ? 'apartment' : opts.preferAllInclusive ? 'resort' : 'hotel');

  return withGroundedSlot(async () => {
    const catalog =
      opts.catalog ||
      (lane === 'resort' || opts.preferAllInclusive ? 'mixed' : 'ota');

    const sources =
      catalog === 'check24'
        ? 'CHECK24, ab-in-den-urlaub, weg.de package/hotel offers'
        : catalog === 'mixed'
          ? 'CHECK24, ab-in-den-urlaub, Expedia, Booking, Airbnb, VRBO, hotel sites'
          : 'Expedia, Booking, Airbnb, VRBO, Stay22/Allez listings, hotel sites';

    const prefer = [
      lodgingLanePromptHint(lane),
      opts.preferAllInclusive ? 'Prefer all-inclusive when priced.' : '',
      opts.amenityHint ? `Prefer places mentioning: ${opts.amenityHint}.` : '',
      opts.maxStayTotalEur != null && opts.maxStayTotalEur > 0
        ? `Strongly prefer total stay ≤ €${Math.round(opts.maxStayTotalEur)} for the whole group.`
        : 'Prefer cheaper bookable options first.',
    ]
      .filter(Boolean)
      .join(' ');

    const prompt = `Find 3 real bookable stays in ${city} for ${opts.adults} adults, check-in ${opts.checkin}, check-out ${opts.checkout}.
Look up live prices on: ${sources}.
Lodging focus: ${lane}.
${prefer}
Rules:
- ONLY include a stay if you found a concrete total EUR price for this stay window (or per-night × nights). Never invent prices.
- name = real property or package name as listed.
- priceTotalEur = total for the WHOLE stay for the group (all rooms needed), integer EUR.
- kind = hotel|apartment|villa|resort|package
- amenities = short tags (pool, all inclusive, airbnb, villa, …).
- sourceHint = which site showed the price (expedia, booking, airbnb, check24, …).
- Sort cheapest first.
Return JSON: {"stays":[{"name":"…","priceTotalEur":1234,"kind":"apartment","amenities":["pool"],"rating":8.2,"stars":4,"sourceHint":"booking.com"}]}
If nothing priced is found, return {"stays":[]}.`;

    try {
      const raw = await groundedJsonLite({
        prompt,
        maxTokens: 1200,
        temperature: 0.15,
        enableGoogleSearch: true,
      });
      const parsed = parseJsonArray(raw);
      const out: HotelLiveStay[] = [];
      for (const s of parsed) {
        const name = String(s.name || '').trim();
        const price = Number(s.priceTotalEur);
        if (!name || !Number.isFinite(price) || price <= 0) continue;
        const kind = String(s.kind || lane).toLowerCase();
        const preferPackage =
          catalog === 'check24' ||
          kind === 'package' ||
          /check24|pauschal|all.?inclusive/i.test(
            `${s.sourceHint || ''} ${(s.amenities || []).join(' ')}`,
          );
        const { bookUrl, supplier } = await attachStayAffiliateUrls({
          city,
          hotelName: name,
          checkin: opts.checkin,
          checkout: opts.checkout,
          adults: opts.adults,
          preferPackage,
          originIata: opts.originIata,
        });
        // Zweite Kontrolle: Stay22-Allez immer als Name-Suche bereitstellen wenn Expedia
        let finalUrl = bookUrl;
        let finalSupplier = supplier;
        if (!preferPackage) {
          try {
            const aff = await import('../../services/affiliate/affiliateService');
            // Expedia behalten; Stay22 nur wenn Expedia fehlt
            if (!/expedia/i.test(supplier)) {
              finalUrl = aff.getStay22AccommodationUrl(city, {
                checkin: opts.checkin,
                checkout: opts.checkout,
                adults: opts.adults,
              });
              finalSupplier = 'stay22_allez';
            }
          } catch {
            /* soft */
          }
        }
        out.push({
          id: `gnd-${slug(name)}`,
          name,
          priceTotal: Math.round(price),
          currency: 'EUR',
          bookUrl: finalUrl,
          rating: typeof s.rating === 'number' ? s.rating : null,
          stars: typeof s.stars === 'number' ? s.stars : null,
          lat: opts.lat ?? undefined,
          lng: opts.lng ?? undefined,
          amenities: [
            lane,
            kind,
            ...(Array.isArray(s.amenities) ? s.amenities.map(String).slice(0, 10) : []),
            s.sourceHint ? `src:${s.sourceHint}` : '',
          ].filter(Boolean),
          supplier: finalSupplier,
          expediaPropertyId: null,
          photoUrl: null,
        });
        if (out.length >= 4) break;
      }
      out.sort((a, b) => (a.priceTotal ?? 9e9) - (b.priceTotal ?? 9e9));
      return {
        stays: out,
        error: out.length ? undefined : 'grounded_empty',
      };
    } catch (e) {
      return { stays: [], error: String(e).slice(0, 80) };
    }
  });
}
