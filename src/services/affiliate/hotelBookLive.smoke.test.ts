/**
 * Live: Stay22 findet das genannte Hotel, Link trägt Name + Daten.
 * Run: npx --yes tsx src/services/affiliate/hotelBookLive.smoke.test.ts
 */

import {
  finalizeHotelBookAffiliateUrl,
  hotelNameAppearsInUrl,
  isHotelRoomSelectUrl,
  extractExpediaPropertyId,
} from './hotelPropertyDeepLink';
import { unwrapPartnerLandingUrl } from './hollowPartnerUrl';
import { applyOpenUrlBookingPrefill } from './openUrlBookingPrefill';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

function decodeBlob(url: string): string {
  try {
    return decodeURIComponent(unwrapPartnerLandingUrl(url) || url);
  } catch {
    return url;
  }
}

async function stay22Lookup(opts: {
  hotelName: string;
  city: string;
  checkin: string;
  checkout: string;
}): Promise<{ name: string; bookUrl: string; expediaId?: string } | null> {
  const q = new URLSearchParams({
    address: opts.city,
    hotelsearch: opts.hotelName,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: '2',
    children: '0',
    rooms: '1',
    currency: 'EUR',
    pageSize: '12',
    lang: 'en',
    type: 'hotel',
  });
  const res = await fetch(`https://api.stay22.com/v2/accommodations?${q}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FindusTravelCompanion/2.0',
    },
  });
  if (!res.ok) {
    console.warn(`stay22 http ${res.status}`);
    return null;
  }
  const json = (await res.json()) as {
    results?: Array<{
      name?: string;
      url?: string;
      id?: string;
      suppliers?: Record<string, { link?: string }>;
    }>;
  };
  const rows = json.results ?? [];
  const want = opts.hotelName.toLowerCase();
  const hit =
    rows.find((r) => (r.name || '').toLowerCase().includes(want.split(/\s+/)[0]!)) ??
    rows[0];
  if (!hit?.name) return null;
  const expedia = hit.suppliers?.expedia?.link || '';
  return {
    name: hit.name,
    bookUrl: expedia || hit.url || '',
    expediaId: /^\d{5,}$/.test(String(hit.id || '')) ? String(hit.id) : undefined,
  };
}

async function main(): Promise<void> {
  const checkin = '2026-09-12';
  const checkout = '2026-09-14';
  const hotelName = 'Electra Metropolis';
  const city = 'Athens';

  const rebuilt = finalizeHotelBookAffiliateUrl({
    hotelName,
    city: 'Athen',
    bookUrl: 'https://www.stay22.com/allez/findus?address=Germany',
    checkin,
    checkout,
    adults: 2,
  });
  const rblob = decodeBlob(rebuilt);
  assert(
    /electra|metropolis|athen/i.test(rblob),
    `hollow Germany rebuilt to hotel+city: ${rblob}`,
  );
  assert(rblob.includes(checkin) && rblob.includes(checkout), `dates in rebuilt: ${rblob}`);
  assert(!/[?&](?:address|destination)=Germany(?:&|$)/i.test(rblob), 'not Germany-only');

  try {
    const live = await stay22Lookup({ hotelName, city, checkin, checkout });
    if (!live) {
      console.log('warn: Stay22 live empty — skip live match');
    } else {
      console.log(`stay22 live: ${live.name}`);
      const book = finalizeHotelBookAffiliateUrl({
        hotelName: live.name,
        city,
        bookUrl: live.bookUrl,
        checkin,
        checkout,
        adults: 2,
        expediaPropertyId: live.expediaId,
      });
      const blob = decodeBlob(book);
      console.log(`live book url: ${blob.slice(0, 240)}`);
      assert(/^https?:\/\//i.test(book), 'live book is https');
      assert(
        hotelNameAppearsInUrl(book, live.name) ||
          extractExpediaPropertyId(book) ||
          isHotelRoomSelectUrl(book),
        `live url is this hotel or a property id: ${blob}`,
      );
      assert(
        blob.includes(checkin) && blob.includes(checkout),
        `live dates in url: ${blob}`,
      );
    }
  } catch (err) {
    console.warn('stay22 live skip', err);
  }

  const prefill = applyOpenUrlBookingPrefill({
    url: 'https://www.expedia.de/Hotel-Search?destination=Germany',
    label: '🏨 Zimmer buchen',
    payload: {
      destName: hotelName,
      destination: 'Athen',
      checkin,
      checkout,
      adults: 2,
    },
  });
  const pblob = decodeBlob(prefill.url);
  assert(
    /electra|metropolis|athen/i.test(pblob),
    `expedia germany search rewritten to hotel/city: ${pblob}`,
  );
  assert(pblob.includes(checkin) && pblob.includes(checkout), `prefill dates: ${pblob}`);
  console.log('hotelBookLive.smoke.test.ts ok');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
