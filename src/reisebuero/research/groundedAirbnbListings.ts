/**
 * Airbnb listings via Gemini Google Search grounding.
 * Finds REAL room IDs + live total prices — never invent, never HTML-scrape Airbnb.
 */

import type { HotelLiveStay } from '../../services/concierge/hotelAvailabilityService';
import {
  buildAirbnbRoomsUrl,
  extractAirbnbRoomId,
  normalizeAirbnbListingUrl,
} from '../../services/affiliate/airbnbDeepLink';
import { groundedJsonLite, hasGroundedJsonKey } from './groundedJsonLite';

export type GroundedAirbnbQuery = {
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
  children?: number | null;
  max?: number;
};

type RawAirbnbStay = {
  name?: string;
  priceTotalEur?: number;
  roomId?: string | number;
  listingUrl?: string;
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

function parseJsonStays(raw: string): RawAirbnbStay[] {
  const t = (raw || '').trim();
  if (!t) return [];
  try {
    const p = JSON.parse(t) as unknown;
    if (Array.isArray(p)) return p as RawAirbnbStay[];
    if (p && typeof p === 'object' && Array.isArray((p as { stays?: unknown }).stays)) {
      return (p as { stays: RawAirbnbStay[] }).stays;
    }
  } catch {
    const m = t.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const p = JSON.parse(m[0]) as unknown;
        if (Array.isArray(p)) return p as RawAirbnbStay[];
      } catch {
        /* soft */
      }
    }
  }
  return [];
}

function mapRawToStay(
  s: RawAirbnbStay,
  opts: GroundedAirbnbQuery,
): HotelLiveStay | null {
  const name = String(s.name || '').trim();
  const price = Number(s.priceTotalEur);
  if (!name || !Number.isFinite(price) || price <= 0) return null;

  const roomId =
    extractAirbnbRoomId(String(s.roomId ?? '')) ||
    extractAirbnbRoomId(String(s.listingUrl || ''));
  if (!roomId) return null;

  const prefill = {
    city: opts.city,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults,
    children: opts.children ?? 0,
  };
  const bookUrl = s.listingUrl
    ? normalizeAirbnbListingUrl(String(s.listingUrl), prefill)
    : buildAirbnbRoomsUrl(roomId, prefill);

  if (!/\/rooms\/\d+/i.test(bookUrl)) return null;

  return {
    id: `airbnb-${roomId}`,
    name,
    priceTotal: Math.round(price),
    currency: 'EUR',
    bookUrl,
    rating: null,
    stars: null,
    amenities: ['airbnb', 'apartment'],
    supplier: 'airbnb',
    expediaPropertyId: null,
    photoUrl: null,
  };
}

/**
 * 2–3 echte Airbnb-Listings mit numerischer Room-ID + Gesamtpreis für das Fenster.
 * Ohne belegte Preise → [].
 */
export async function searchGroundedAirbnbListings(
  opts: GroundedAirbnbQuery,
): Promise<{ stays: HotelLiveStay[]; error?: string }> {
  if (!hasGroundedJsonKey()) {
    return { stays: [], error: 'no_gemini_key' };
  }
  const city = (opts.city || '').trim();
  if (!city || !opts.checkin || !opts.checkout) {
    return { stays: [], error: 'bad_query' };
  }
  const adults = Math.max(1, Math.min(16, Math.floor(opts.adults || 1)));
  const children =
    opts.children != null && opts.children > 0
      ? Math.min(16, Math.floor(opts.children))
      : 0;
  const max = Math.max(1, Math.min(4, opts.max ?? 3));

  return withGroundedSlot(async () => {
    const kids =
      children > 0
        ? `, ${children} child${children === 1 ? '' : 'ren'}`
        : '';
    const prompt = `Find ${max} REAL Airbnb listings in ${city} for ${adults} adult${adults === 1 ? '' : 's'}${kids}, check-in ${opts.checkin}, check-out ${opts.checkout}.

Use Google Search to discover concrete Airbnb.de or Airbnb.com /rooms/ pages that show a live total price for THIS exact date window and guest count.

Rules:
- ONLY include a stay if you found a numeric Airbnb room ID (e.g. 1359377017583012847) OR a full https://www.airbnb.de/rooms/{id} or airbnb.com/rooms/{id} URL AND a concrete total EUR price for this stay window.
- Never invent room IDs, URLs, or prices. Never guess.
- name = real listing title as shown.
- priceTotalEur = total for the WHOLE stay for the group (all nights), integer EUR.
- roomId = digits only when known.
- listingUrl = full /rooms/{id} URL when known (preferred).
- Sort cheapest first.
Return JSON: {"stays":[{"name":"…","priceTotalEur":587,"roomId":"1359377017583012847","listingUrl":"https://www.airbnb.de/rooms/1359377017583012847"}]}
If no priced listing with a real room ID is found, return {"stays":[]}.`;

    try {
      const raw = await groundedJsonLite({
        prompt,
        maxTokens: 1400,
        temperature: 0.1,
        enableGoogleSearch: true,
      });
      const parsed = parseJsonStays(raw);
      const out: HotelLiveStay[] = [];
      const seen = new Set<string>();
      for (const s of parsed) {
        const mapped = mapRawToStay(s, {
          ...opts,
          adults,
          children,
        });
        if (!mapped) continue;
        if (seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        out.push(mapped);
        if (out.length >= max) break;
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
